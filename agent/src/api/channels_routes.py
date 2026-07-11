"""IM channel HTTP routes.

Mounted by ``agent/api_server.py`` via ``register_channels_routes(app, ...)``.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from src.config.paths import get_config_path


# ---------------------------------------------------------------------------
# Pydantic models (defined locally -- NO shared modules, per maintainer rule)
# ---------------------------------------------------------------------------

class ChannelPairingCommandRequest(BaseModel):
    """Pairing command payload for IM channel sender pairing."""

    channel: str
    command: str


class ChannelConfigItem(BaseModel):
    """Editable channel config item surfaced to the settings UI."""

    name: str
    display_name: str
    configured: bool
    enabled: bool
    available: bool
    config: dict[str, Any]
    install_hint: str = ""
    error: str = ""


class ChannelConfigResponse(BaseModel):
    """Current editable channel config state."""

    config_path: str
    channels: dict[str, ChannelConfigItem]


class UpdateChannelConfigRequest(BaseModel):
    """Create or update one channel config section."""

    enabled: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Lifecycle helpers (module-level, access host state via sys.modules)
# ---------------------------------------------------------------------------


async def _start_channel_runtime():
    """Start the IM channel runtime."""
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
    runtime = host._get_channel_runtime()
    await runtime.start(start_manager=True)
    return runtime


async def _stop_channel_runtime() -> None:
    """Stop the IM channel runtime if it was initialized."""
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
    if host._channel_runtime is None:
        return
    await host._channel_runtime.stop()


_SECRET_KEYS = {
    "access_token",
    "app_password",
    "app_secret",
    "app_token",
    "bot_token",
    "client_secret",
    "claw_token",
    "imap_password",
    "password",
    "secret",
    "smtp_password",
    "token",
    "token_issue_secret",
    "verification_token",
}
_MASK = "********"


def _load_agent_config_payload() -> tuple[dict[str, Any], Any]:
    path = get_config_path()
    if not path.exists():
        return {}, path
    if path.suffix.lower() != ".json":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Channel settings editor only supports JSON config files: {path}",
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid config JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Agent config must be a JSON object")
    return payload, path


def _write_agent_config_payload(payload: dict[str, Any], path: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _redact_config(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (_MASK if key.lower() in _SECRET_KEYS and str(child or "").strip() else _redact_config(child))
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [_redact_config(item) for item in value]
    return value


def _preserve_masked_secrets(new_value: Any, old_value: Any) -> Any:
    if isinstance(new_value, dict):
        old_map = old_value if isinstance(old_value, dict) else {}
        merged: dict[str, Any] = {}
        for key, child in new_value.items():
            if key.lower() in _SECRET_KEYS and child == _MASK:
                merged[key] = old_map.get(key, "")
            else:
                merged[key] = _preserve_masked_secrets(child, old_map.get(key))
        return merged
    if isinstance(new_value, list):
        old_list = old_value if isinstance(old_value, list) else []
        return [
            _preserve_masked_secrets(child, old_list[index] if index < len(old_list) else None)
            for index, child in enumerate(new_value)
        ]
    return new_value


def _channel_default_config(name: str) -> dict[str, Any]:
    try:
        from src.channels.registry import load_channel_class

        cls = load_channel_class(name)
        default_config = getattr(cls, "default_config", None)
        if callable(default_config):
            value = default_config()
            return value if isinstance(value, dict) else {"enabled": False}
    except Exception:
        pass
    return {"enabled": False}


def _build_channel_config_response() -> ChannelConfigResponse:
    from src.channels.registry import inspect_channels

    payload, path = _load_agent_config_payload()
    raw_channels = payload.get("channels")
    channels_config = raw_channels if isinstance(raw_channels, dict) else {}
    status_items = inspect_channels(channels_config)
    channels: dict[str, ChannelConfigItem] = {}
    for name, item in sorted(status_items.items()):
        current = channels_config.get(name)
        configured = isinstance(current, dict)
        config = dict(current) if configured else _channel_default_config(name)
        if "enabled" not in config:
            config["enabled"] = bool(item.get("enabled", False))
        channels[name] = ChannelConfigItem(
            name=name,
            display_name=str(item.get("display_name") or name),
            configured=configured,
            enabled=bool(config.get("enabled", False)),
            available=bool(item.get("available", False)),
            config=_redact_config(config),
            install_hint=str(item.get("install_hint") or ""),
            error=str(item.get("error") or ""),
        )
    return ChannelConfigResponse(config_path=str(path), channels=channels)


async def _reset_channel_runtime_after_config_change() -> None:
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
    if host is None:
        return
    if host._channel_runtime is not None:
        await host._channel_runtime.stop()
    host._channel_runtime = None
    host._channel_bus = None
    host._channel_manager = None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

AuthDep = Callable[..., Awaitable[Any] | Any]


def register_channels_routes(
    app: FastAPI,
    require_auth: AuthDep | None = None,
) -> None:
    """Mount the channel routes onto ``app``.

    Resolves ``require_auth`` from the host ``api_server`` module via
    ``sys.modules`` when not passed explicitly.
    """
    # Resolve host dependencies via sys.modules fallback
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")

    if host is None:
        raise RuntimeError(
            "register_channels_routes: api_server module not in sys.modules; "
            "ensure api_server is imported before calling this function"
        )

    if require_auth is None:
        require_auth = host.require_auth

    # Late-access closure for monkeypatch compatibility
    def _get_channel_runtime():
        """Late-access _get_channel_runtime for test monkeypatch compat."""
        h = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        return h._get_channel_runtime()

    # --- Routes ---

    @app.get("/channels/status", dependencies=[Depends(require_auth)])
    async def channels_status():
        """Return IM channel runtime and adapter status."""
        runtime = _get_channel_runtime()
        return runtime.status()

    @app.get("/channels/config", response_model=ChannelConfigResponse, dependencies=[Depends(require_auth)])
    async def channels_config():
        """Return editable channel configuration for the settings UI."""
        return _build_channel_config_response()

    @app.put("/channels/config/{channel_name}", response_model=ChannelConfigResponse, dependencies=[Depends(require_auth)])
    async def update_channel_config(channel_name: str, payload: UpdateChannelConfigRequest):
        """Save one channel config section and reset runtime so changes take effect."""
        channel = channel_name.strip().lower()
        if not channel:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Channel name is required")

        agent_payload, path = _load_agent_config_payload()
        channels = agent_payload.get("channels")
        if not isinstance(channels, dict):
            channels = {}
            agent_payload["channels"] = channels

        old_config = channels.get(channel) if isinstance(channels.get(channel), dict) else {}
        new_config = _preserve_masked_secrets(dict(payload.config), old_config)
        new_config["enabled"] = bool(payload.enabled)
        channels[channel] = new_config
        _write_agent_config_payload(agent_payload, path)
        await _reset_channel_runtime_after_config_change()
        return _build_channel_config_response()

    @app.post("/channels/start", dependencies=[Depends(require_auth)])
    async def channels_start():
        """Start configured IM channel adapters."""
        runtime = await _start_channel_runtime()
        return {"status": "started", **runtime.status()}

    @app.post("/channels/stop", dependencies=[Depends(require_auth)])
    async def channels_stop():
        """Stop configured IM channel adapters."""
        runtime = _get_channel_runtime()
        await runtime.stop()
        return {"status": "stopped", **runtime.status()}

    @app.post("/channels/pairing/command", dependencies=[Depends(require_auth)])
    async def channels_pairing_command(payload: ChannelPairingCommandRequest):
        """Run a pairing command against the shared pairing store."""
        from src.channels.pairing import handle_pairing_command

        return {
            "channel": payload.channel,
            "reply": handle_pairing_command(payload.channel, payload.command),
        }
