"""Whitelist-based product login routes for the Web UI.

This module is intentionally self-contained so the product account layer can
grow independently from the existing local API key guard.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field


DEFAULT_ADMIN_EMAIL = "admin@example.com"
DEFAULT_ADMIN_CODE = "change-me-access-code"
TOKEN_PREFIX = "vta_"


class AuthUser(BaseModel):
    """Authenticated product user."""

    id: str
    email: str
    display_name: str = ""
    role: str = "user"
    status: str = "active"


class LoginRequest(BaseModel):
    """Whitelist login request."""

    email: str = Field(..., min_length=3, max_length=254)
    access_code: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    """Login response returned to the browser."""

    token: str
    token_type: str = "bearer"
    expires_at: str
    user: AuthUser


class WhitelistEntry(BaseModel):
    """Whitelist row visible to admins."""

    id: str
    email: str
    role: str
    status: str = "active"
    note: str = ""
    created_at: str


class UpsertWhitelistRequest(BaseModel):
    """Create or update a whitelisted user."""

    email: str = Field(..., min_length=3, max_length=254)
    role: str = Field("user", pattern="^(user|admin)$")
    note: str = Field("", max_length=500)


class UpdateWhitelistStatusRequest(BaseModel):
    """Enable or disable a whitelisted user without deleting audit history."""

    status: str = Field(..., pattern="^(active|disabled)$")


class AuthService:
    """Small SQLite-backed auth service for whitelist-gated beta access."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._seed_defaults()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'user',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    last_login_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS whitelist (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    role TEXT NOT NULL DEFAULT 'user',
                    status TEXT NOT NULL DEFAULT 'active',
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                )
                """
            )
            _ensure_column(conn, "whitelist", "status", "TEXT NOT NULL DEFAULT 'active'")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    revoked_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON sessions(user_id)")

    def _seed_defaults(self) -> None:
        admin_email = _normalise_email(os.getenv("VIBE_TRADING_ADMIN_EMAIL") or DEFAULT_ADMIN_EMAIL)
        whitelist_raw = os.getenv("VIBE_TRADING_AUTH_WHITELIST", "")
        emails = {admin_email}
        emails.update(_normalise_email(item) for item in whitelist_raw.split(",") if item.strip())
        for email in sorted(emails):
            self.upsert_whitelist(email=email, role="admin" if email == admin_email else "user", note="seeded")

    def upsert_whitelist(self, *, email: str, role: str = "user", note: str = "") -> WhitelistEntry:
        now = _now()
        normalised = _normalise_email(email)
        with self.connect() as conn:
            existing = conn.execute("SELECT id FROM whitelist WHERE email = ?", (normalised,)).fetchone()
            row_id = existing["id"] if existing else secrets.token_hex(16)
            conn.execute(
                """
                INSERT INTO whitelist (id, email, role, note, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET role = excluded.role, note = excluded.note
                """,
                (row_id, normalised, role, note, now),
            )
            row = conn.execute("SELECT * FROM whitelist WHERE email = ?", (normalised,)).fetchone()
        return _whitelist_from_row(row)

    def list_whitelist(self) -> list[WhitelistEntry]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM whitelist ORDER BY created_at DESC").fetchall()
        return [_whitelist_from_row(row) for row in rows]

    def login(self, *, email: str, access_code: str) -> LoginResponse:
        normalised = _normalise_email(email)
        expected = os.getenv("VIBE_TRADING_AUTH_ACCESS_CODE") or DEFAULT_ADMIN_CODE
        if not hmac.compare_digest(access_code.strip(), expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="访问码不正确")

        with self.connect() as conn:
            allowed = conn.execute("SELECT * FROM whitelist WHERE email = ?", (normalised,)).fetchone()
            if not allowed:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该账号不在内测白名单中")
            if (allowed["status"] or "active") != "active":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该账号已被暂停访问")

            user = conn.execute("SELECT * FROM users WHERE email = ?", (normalised,)).fetchone()
            now = _now()
            if not user:
                user_id = secrets.token_hex(16)
                conn.execute(
                    """
                    INSERT INTO users (id, email, display_name, role, status, created_at, last_login_at)
                    VALUES (?, ?, ?, ?, 'active', ?, ?)
                    """,
                    (user_id, normalised, normalised.split("@")[0], allowed["role"], now, now),
                )
            else:
                user_id = user["id"]
                conn.execute(
                    "UPDATE users SET role = ?, status = 'active', last_login_at = ? WHERE id = ?",
                    (allowed["role"], now, user_id),
                )

            expires = datetime.now(timezone.utc) + timedelta(days=14)
            token = TOKEN_PREFIX + secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (_hash_token(token), user_id, now, expires.isoformat()),
            )
            user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

        return LoginResponse(token=token, expires_at=expires.isoformat(), user=_user_from_row(user_row))

    def current_user(self, token: str) -> AuthUser:
        token_hash = _hash_token(token)
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT u.* FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
                """,
                (token_hash, _now()),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")
        return _user_from_row(row)

    def set_whitelist_status(self, *, email: str, status_value: str) -> WhitelistEntry:
        normalised = _normalise_email(email)
        if status_value not in {"active", "disabled"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="白名单状态不正确")
        with self.connect() as conn:
            existing = conn.execute("SELECT * FROM whitelist WHERE email = ?", (normalised,)).fetchone()
            if not existing:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="白名单用户不存在")
            conn.execute("UPDATE whitelist SET status = ? WHERE email = ?", (status_value, normalised))
            user = conn.execute("SELECT id FROM users WHERE email = ?", (normalised,)).fetchone()
            if user:
                conn.execute("UPDATE users SET status = ? WHERE id = ?", (status_value, user["id"]))
                if status_value == "disabled":
                    conn.execute(
                        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                        (_now(), user["id"]),
                    )
            row = conn.execute("SELECT * FROM whitelist WHERE email = ?", (normalised,)).fetchone()
        return _whitelist_from_row(row)

    def logout(self, token: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", (_now(), _hash_token(token)))


_service: AuthService | None = None


def configure_auth_service(db_path: Path) -> AuthService:
    """Create or return the process-wide auth service."""

    global _service
    if _service is None:
        _service = AuthService(db_path)
    return _service


def get_auth_service() -> AuthService:
    if _service is None:
        raise RuntimeError("auth service has not been configured")
    return _service


def token_from_authorization(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def get_current_user(authorization: str | None = Header(default=None)) -> AuthUser:
    token = token_from_authorization(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    return get_auth_service().current_user(token)


def try_get_current_user(authorization: str | None) -> AuthUser | None:
    token = token_from_authorization(authorization)
    if not token or not token.startswith(TOKEN_PREFIX):
        return None
    try:
        return get_auth_service().current_user(token)
    except HTTPException:
        return None


def require_admin_user(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def register_auth_routes(app: FastAPI, db_path: Path) -> None:
    """Mount product auth routes onto the main API app."""

    service = configure_auth_service(db_path)

    @app.post("/auth/login", response_model=LoginResponse)
    async def login(payload: LoginRequest):
        return service.login(email=str(payload.email), access_code=payload.access_code)

    @app.get("/auth/me", response_model=AuthUser)
    async def me(user: AuthUser = Depends(get_current_user)):
        return user

    @app.post("/auth/logout")
    async def logout(authorization: str | None = Header(default=None)):
        token = token_from_authorization(authorization)
        if token:
            service.logout(token)
        return {"status": "ok"}

    @app.get("/auth/whitelist", response_model=list[WhitelistEntry])
    async def list_whitelist(_admin: AuthUser = Depends(require_admin_user)):
        return service.list_whitelist()

    @app.post("/auth/whitelist", response_model=WhitelistEntry)
    async def upsert_whitelist(payload: UpsertWhitelistRequest, _admin: AuthUser = Depends(require_admin_user)):
        return service.upsert_whitelist(email=str(payload.email), role=payload.role, note=payload.note)

    @app.patch("/auth/whitelist/{email}/status", response_model=WhitelistEntry)
    async def update_whitelist_status(
        email: str,
        payload: UpdateWhitelistStatusRequest,
        _admin: AuthUser = Depends(require_admin_user),
    ):
        return service.set_whitelist_status(email=email, status_value=payload.status)


def _normalise_email(email: str) -> str:
    value = email.strip().lower()
    if "@" not in value or value.startswith("@") or value.endswith("@"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱格式不正确")
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _user_from_row(row: sqlite3.Row) -> AuthUser:
    return AuthUser(
        id=row["id"],
        email=row["email"],
        display_name=row["display_name"] or "",
        role=row["role"] or "user",
        status=row["status"] or "active",
    )


def _whitelist_from_row(row: sqlite3.Row) -> WhitelistEntry:
    return WhitelistEntry(
        id=row["id"],
        email=row["email"],
        role=row["role"],
        status=row["status"] or "active",
        note=row["note"] or "",
        created_at=row["created_at"],
    )
