"""Tests for programmatic trading risk controls."""

from __future__ import annotations

import pytest

from backtest.rules.programmatic import (
    ProgrammaticOrderEvent,
    ProgrammaticRiskLimits,
    ProgrammaticRiskRuleBook,
)


def _event(**overrides) -> ProgrammaticOrderEvent:
    data = {
        "timestamp": "2026-07-06 10:00:00",
        "strategy_id": "strat_a",
        "account_id": "acct_1",
        "symbol": "600519.SH",
        "side": "buy",
        "quantity": 100,
        "price": 100.0,
        "order_type": "limit",
        "event_type": "order",
    }
    data.update(overrides)
    return ProgrammaticOrderEvent(**data)


def test_allows_clean_order_under_limits() -> None:
    book = ProgrammaticRiskRuleBook(
        ProgrammaticRiskLimits(max_orders_per_second=2, max_orders_per_minute=5)
    )
    assert book.evaluate_order(_event(), []) == []


def test_blocks_missing_audit_fields() -> None:
    breaches = ProgrammaticRiskRuleBook().evaluate_order(_event(strategy_id=""), [])
    assert [b.code for b in breaches] == ["audit_fields_missing"]
    assert "strategy_id" in breaches[0].observed


def test_accepts_notional_order_without_quantity() -> None:
    event = _event(quantity=0, price=None, notional=10_000.0)
    assert ProgrammaticRiskRuleBook().audit_breaches(event) == []


def test_blocks_per_second_order_rate() -> None:
    book = ProgrammaticRiskRuleBook(ProgrammaticRiskLimits(max_orders_per_second=2))
    history = [
        _event(timestamp="2026-07-06 09:59:59.300"),
        _event(timestamp="2026-07-06 09:59:59.800"),
    ]
    breaches = book.evaluate_order(_event(timestamp="2026-07-06 10:00:00.000"), history)
    assert any(b.code == "orders_per_second" for b in breaches)


def test_blocks_per_minute_order_rate() -> None:
    book = ProgrammaticRiskRuleBook(
        ProgrammaticRiskLimits(max_orders_per_second=100, max_orders_per_minute=3)
    )
    history = [
        _event(timestamp="2026-07-06 09:59:10"),
        _event(timestamp="2026-07-06 09:59:20"),
        _event(timestamp="2026-07-06 09:59:30"),
    ]
    breaches = book.evaluate_order(_event(timestamp="2026-07-06 10:00:00"), history)
    assert any(b.code == "orders_per_minute" for b in breaches)


def test_flags_high_cancel_ratio_after_minimum_sample() -> None:
    book = ProgrammaticRiskRuleBook(
        ProgrammaticRiskLimits(max_cancel_ratio=0.50, min_orders_for_cancel_ratio=4)
    )
    history = [_event(timestamp=f"2026-07-06 10:00:0{i}") for i in range(4)]
    history.extend(
        _event(timestamp=f"2026-07-06 10:01:0{i}", event_type="cancel")
        for i in range(3)
    )
    breaches = book.evaluate_order(_event(timestamp="2026-07-06 10:02:00"), history)
    breach = next(b for b in breaches if b.code == "cancel_ratio")
    assert breach.severity == "pause"
    assert breach.observed == pytest.approx(0.75)


def test_blocks_single_order_notional() -> None:
    book = ProgrammaticRiskRuleBook(ProgrammaticRiskLimits(max_single_order_notional=5_000))
    breaches = book.evaluate_order(_event(quantity=100, price=100.0), [])
    assert any(b.code == "single_order_notional" for b in breaches)


def test_pauses_strategy_daily_notional() -> None:
    book = ProgrammaticRiskRuleBook(
        ProgrammaticRiskLimits(max_single_order_notional=10_000, max_strategy_daily_notional=15_000)
    )
    history = [_event(timestamp="2026-07-06 09:40:00", quantity=100, price=100.0)]
    breaches = book.evaluate_order(_event(quantity=60, price=100.0), history)
    breach = next(b for b in breaches if b.code == "strategy_daily_notional")
    assert breach.severity == "pause"
    assert breach.observed == pytest.approx(16_000)


def test_daily_notional_is_strategy_and_day_scoped() -> None:
    book = ProgrammaticRiskRuleBook(
        ProgrammaticRiskLimits(max_single_order_notional=10_000, max_strategy_daily_notional=15_000)
    )
    history = [
        _event(timestamp="2026-07-05 09:40:00", quantity=100, price=100.0),
        _event(timestamp="2026-07-06 09:40:00", strategy_id="other", quantity=100, price=100.0),
    ]
    assert book.evaluate_order(_event(quantity=60, price=100.0), history) == []
