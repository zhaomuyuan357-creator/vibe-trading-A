"""Runtime policy for server-owned secrets in public deployments."""

from __future__ import annotations

import os
from typing import Iterable


ALLOW_SERVER_SHARED_SECRETS_ENV = "VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS"

_TRUE_VALUES = {"1", "true", "yes", "on"}

# Secrets that can create direct cost, unlock private data, or access accounts if
# accidentally inherited by a public web deployment. Users should configure their
# own credentials in the product UI instead of relying on these server globals.
SERVER_SHARED_SECRET_ENV_NAMES: tuple[str, ...] = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "DASHSCOPE_API_KEY",
    "ZHIPU_API_KEY",
    "MOONSHOT_API_KEY",
    "MINIMAX_API_KEY",
    "MIMO_API_KEY",
    "ZAI_API_KEY",
    "TUSHARE_TOKEN",
    "FINNHUB_API_KEY",
    "ALPHAVANTAGE_API_KEY",
    "TIINGO_API_KEY",
    "FMP_API_KEY",
    "FRED_API_KEY",
    "VIBE_TRADING_IWENCAI_KEY",
    "TWITTER_BEARER_TOKEN",
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "DISCORD_BOT_TOKEN",
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
)


def server_shared_secrets_allowed() -> bool:
    """Return whether server-level shared secrets may be used by the API."""
    return os.getenv(ALLOW_SERVER_SHARED_SECRETS_ENV, "").strip().lower() in _TRUE_VALUES


def scrub_server_shared_secrets(env_names: Iterable[str] = SERVER_SHARED_SECRET_ENV_NAMES) -> list[str]:
    """Remove shared secrets from ``os.environ`` unless explicitly allowed.

    Public deployments should default to user-supplied credentials only. This
    protects the operator from accidentally paying for other users' model or
    data-source usage when the process environment contains private keys.
    """
    if server_shared_secrets_allowed():
        return []
    removed: list[str] = []
    for name in env_names:
        if name in os.environ:
            os.environ.pop(name, None)
            removed.append(name)
    # Also remove OpenAI-compatible aliases that many SDKs read implicitly.
    for name in ("OPENAI_API_BASE", "OPENAI_BASE_URL"):
        if name in os.environ:
            os.environ.pop(name, None)
            removed.append(name)
    return removed
