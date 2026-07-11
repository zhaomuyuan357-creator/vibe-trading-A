"""Product-mode guardrails for live trading surfaces.

Vibe-Trading defaults to research/reference use. Live-trading entry points must
be enabled explicitly so a packaged build cannot accidentally present execution
as the default workflow.
"""

from __future__ import annotations

import os
from typing import Final

PRODUCT_MODE_ENV: Final = "VIBE_TRADING_PRODUCT_MODE"
ENABLE_LIVE_TRADING_ENV: Final = "VIBE_TRADING_ENABLE_LIVE_TRADING"

RESEARCH_MODE: Final = "research"
LIVE_MODE: Final = "live"

_TRUE_VALUES: Final = {"1", "true", "yes", "on"}
_VALID_MODES: Final = {RESEARCH_MODE, LIVE_MODE}

INVESTMENT_REFERENCE_DISCLAIMER: Final = (
    "This build defaults to investment research/reference mode. Outputs are for "
    "analysis only, are not investment advice, do not guarantee returns, and "
    "must be reviewed by the user before any trading decision."
)


def _env_flag_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in _TRUE_VALUES


def product_mode() -> str:
    """Return the configured product mode, defaulting to research/reference."""

    raw = os.getenv(PRODUCT_MODE_ENV, RESEARCH_MODE).strip().lower()
    return raw if raw in _VALID_MODES else RESEARCH_MODE


def live_trading_enabled() -> bool:
    """Return whether privileged live-trading actions are explicitly enabled."""

    return product_mode() == LIVE_MODE and _env_flag_enabled(ENABLE_LIVE_TRADING_ENV)


def live_trading_disabled_detail() -> str:
    """User-facing refusal reason for live-only API actions."""

    return (
        "Live trading is disabled. Vibe-Trading defaults to investment "
        "research/reference mode. Set VIBE_TRADING_PRODUCT_MODE=live and "
        "VIBE_TRADING_ENABLE_LIVE_TRADING=1 only after reviewing broker, "
        "regulatory, and risk controls."
    )

