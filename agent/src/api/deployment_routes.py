"""Deployment readiness checks for the Web UI admin console."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from src.api.auth_routes import DEFAULT_ADMIN_CODE, DEFAULT_ADMIN_EMAIL


AuthDep = Callable[..., Awaitable[Any] | Any]


class DeploymentCheckItem(BaseModel):
    id: str
    title: str
    status: str
    detail: str
    recommendation: str = ""


class DeploymentSummary(BaseModel):
    ready_for_public_deploy: bool
    blocking_items: int
    warning_items: int
    message: str


class DeploymentReadinessResponse(BaseModel):
    status: str
    admin_email: str
    passed: int
    warning: int
    failed: int
    summary: DeploymentSummary
    checks: list[DeploymentCheckItem]


def _env_value(name: str) -> str:
    return os.getenv(name, "").strip()


def _mask(value: str) -> str:
    if not value:
        return "未配置"
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def _check_item(
    *,
    item_id: str,
    title: str,
    ok: bool,
    detail: str,
    recommendation: str = "",
    warning: bool = False,
) -> DeploymentCheckItem:
    status = "warning" if warning else "passed" if ok else "failed"
    return DeploymentCheckItem(
        id=item_id,
        title=title,
        status=status,
        detail=detail,
        recommendation=recommendation,
    )


def build_deployment_readiness() -> DeploymentReadinessResponse:
    admin_email = _env_value("VIBE_TRADING_ADMIN_EMAIL") or DEFAULT_ADMIN_EMAIL
    access_code = _env_value("VIBE_TRADING_AUTH_ACCESS_CODE") or DEFAULT_ADMIN_CODE
    api_auth_key = _env_value("API_AUTH_KEY")
    whitelist = _env_value("VIBE_TRADING_AUTH_WHITELIST")
    allowed_origins = _env_value("CORS_ALLOW_ORIGINS") or _env_value("ALLOWED_ORIGINS")
    host = _env_value("HOST") or _env_value("UVICORN_HOST")
    port = _env_value("PORT") or _env_value("UVICORN_PORT") or "8899"

    agent_dir = Path(__file__).resolve().parents[2]
    data_dir = agent_dir / "data"
    auth_db = data_dir / "auth.db"
    single_stock_db = data_dir / "single_stock.db"
    uploads_dir = agent_dir / "uploads"
    sessions_dir = agent_dir / "sessions"
    runs_dir = agent_dir / "runs"

    checks = [
        _check_item(
            item_id="admin_email",
            title="管理员邮箱",
            ok=admin_email != DEFAULT_ADMIN_EMAIL,
            detail=f"当前管理员邮箱：{admin_email}",
            recommendation="上线前请设置 VIBE_TRADING_ADMIN_EMAIL，不要继续使用开源示例邮箱。",
            warning=admin_email == DEFAULT_ADMIN_EMAIL,
        ),
        _check_item(
            item_id="access_code",
            title="登录访问码",
            ok=access_code != DEFAULT_ADMIN_CODE,
            detail="当前仍使用默认访问码。" if access_code == DEFAULT_ADMIN_CODE else f"已配置访问码：{_mask(access_code)}",
            recommendation="上线前建议设置 VIBE_TRADING_AUTH_ACCESS_CODE，不要继续使用默认访问码。",
            warning=access_code == DEFAULT_ADMIN_CODE,
        ),
        _check_item(
            item_id="api_auth_key",
            title="远程 API 密钥",
            ok=bool(api_auth_key),
            detail=f"API_AUTH_KEY：{_mask(api_auth_key)}",
            recommendation="公网部署建议配置 API_AUTH_KEY，防止非浏览器客户端绕过前端访问。",
            warning=not bool(api_auth_key),
        ),
        _check_item(
            item_id="whitelist",
            title="白名单配置",
            ok=bool(whitelist),
            detail="已通过环境变量预置白名单。" if whitelist else "未通过环境变量预置白名单，仍可在后台页面手动维护。",
            recommendation="小范围内测可以先后台维护；正式灰度建议把首批账号写入 VIBE_TRADING_AUTH_WHITELIST。",
            warning=not bool(whitelist),
        ),
        _check_item(
            item_id="auth_db",
            title="用户数据库",
            ok=auth_db.exists(),
            detail=f"路径：{auth_db}",
            recommendation="部署时建议将 data 目录挂载到持久化磁盘，后续可迁移到 PostgreSQL。",
            warning=not auth_db.exists(),
        ),
        _check_item(
            item_id="single_stock_db",
            title="单票分析数据库",
            ok=single_stock_db.exists(),
            detail=f"路径：{single_stock_db}",
            recommendation="该库保存用户单票分析记录，部署时需要持久化。",
            warning=not single_stock_db.exists(),
        ),
        _check_item(
            item_id="workspace_dirs",
            title="工作区目录",
            ok=uploads_dir.exists() and sessions_dir.exists() and runs_dir.exists(),
            detail=f"uploads={uploads_dir.exists()}；sessions={sessions_dir.exists()}；runs={runs_dir.exists()}",
            recommendation="这些目录保存用户上传、对话和回测结果，部署时都要持久化。",
            warning=not (uploads_dir.exists() and sessions_dir.exists() and runs_dir.exists()),
        ),
        _check_item(
            item_id="data_source",
            title="用户级 A 股数据源",
            ok=True,
            detail="系统不内置共享的 Tushare Token；每个登录用户需要在设置页配置自己的数据源凭证。",
            recommendation="上线后请引导用户在「设置 / 行情与数据源」中填写自己的 Tushare Token。管理员 Token 不会作为所有用户的固定密钥。",
            warning=True,
        ),
        _check_item(
            item_id="cors",
            title="公网访问域名",
            ok=bool(allowed_origins),
            detail=f"允许来源：{allowed_origins or '未配置'}",
            recommendation="正式部署时应配置 CORS_ALLOW_ORIGINS 为你的前端域名。",
            warning=not bool(allowed_origins),
        ),
        _check_item(
            item_id="bind_address",
            title="服务监听地址",
            ok=host not in {"0.0.0.0", "::"},
            detail=f"后端端口：{port}；监听地址：{host or '默认'}",
            recommendation="如果监听 0.0.0.0，请务必放在反向代理和 HTTPS 后面，并启用 API_AUTH_KEY。",
            warning=host in {"0.0.0.0", "::"},
        ),
    ]

    passed = sum(1 for item in checks if item.status == "passed")
    warning_count = sum(1 for item in checks if item.status == "warning")
    failed = sum(1 for item in checks if item.status == "failed")
    overall = "failed" if failed else "warning" if warning_count else "ready"
    summary = DeploymentSummary(
        ready_for_public_deploy=failed == 0 and warning_count == 0,
        blocking_items=failed,
        warning_items=warning_count,
        message=(
            "关键配置已满足公网部署要求。"
            if overall == "ready"
            else "存在必须修复的阻塞项，请先处理失败项。"
            if overall == "failed"
            else "可以继续本地或小范围内测，公网部署前建议补齐注意项。"
        ),
    )
    return DeploymentReadinessResponse(
        status=overall,
        admin_email=admin_email,
        passed=passed,
        warning=warning_count,
        failed=failed,
        summary=summary,
        checks=checks,
    )


def register_deployment_routes(app: FastAPI, require_auth: AuthDep | None = None) -> None:
    if require_auth is None:
        import sys as _sys

        host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        if host is None:  # pragma: no cover
            raise RuntimeError("register_deployment_routes: api_server module not in sys.modules")
        require_auth = host.require_auth

    @app.get("/deployment/readiness", response_model=DeploymentReadinessResponse, dependencies=[Depends(require_auth)])
    async def deployment_readiness():
        return build_deployment_readiness()
