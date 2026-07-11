"""Tests for product-mode live-trading guardrails."""

from __future__ import annotations

from src.live import mode


def test_product_mode_defaults_to_research(monkeypatch) -> None:
    monkeypatch.delenv(mode.PRODUCT_MODE_ENV, raising=False)
    monkeypatch.delenv(mode.ENABLE_LIVE_TRADING_ENV, raising=False)

    assert mode.product_mode() == "research"
    assert mode.live_trading_enabled() is False


def test_invalid_product_mode_falls_back_to_research(monkeypatch) -> None:
    monkeypatch.setenv(mode.PRODUCT_MODE_ENV, "paper")
    monkeypatch.setenv(mode.ENABLE_LIVE_TRADING_ENV, "1")

    assert mode.product_mode() == "research"
    assert mode.live_trading_enabled() is False


def test_live_trading_requires_live_mode_and_enable_flag(monkeypatch) -> None:
    monkeypatch.setenv(mode.PRODUCT_MODE_ENV, "live")
    monkeypatch.setenv(mode.ENABLE_LIVE_TRADING_ENV, "1")

    assert mode.product_mode() == "live"
    assert mode.live_trading_enabled() is True

