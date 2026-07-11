"""Programmatic trading risk controls.

The module is intentionally pure and broker-agnostic.  It can be used by
backtests, paper-trading runners, or live pre-trade guards without coupling to
any broker adapter.  Defaults are conservative implementation baselines for
China A-share programmatic-trading governance: rate limits, cancellation ratio,
per-strategy notional caps, and audit-field completeness.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable

import pandas as pd


REQUIRED_AUDIT_FIELDS = frozenset(
    {
        "strategy_id",
        "account_id",
        "symbol",
        "side",
        "order_type",
        "timestamp",
    }
)


@dataclass(frozen=True)
class ProgrammaticRiskLimits:
    """Configurable limits for one account/strategy control plane."""

    max_orders_per_second: int = 20
    max_orders_per_minute: int = 300
    max_cancel_ratio: float = 0.80
    min_orders_for_cancel_ratio: int = 20
    max_single_order_notional: float = 1_000_000.0
    max_strategy_daily_notional: float = 10_000_000.0
    required_audit_fields: frozenset[str] = field(default_factory=lambda: REQUIRED_AUDIT_FIELDS)


@dataclass(frozen=True)
class ProgrammaticOrderEvent:
    """Normalized order/cancel event used by the risk control checks."""

    timestamp: datetime | pd.Timestamp | str
    strategy_id: str
    account_id: str
    symbol: str
    side: str = "buy"
    quantity: float = 0.0
    price: float | None = None
    order_type: str = "limit"
    event_type: str = "order"
    notional: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def ts(self) -> pd.Timestamp:
        return pd.Timestamp(self.timestamp)

    @property
    def effective_notional(self) -> float:
        if self.notional is not None:
            return float(self.notional)
        if self.price is None:
            return 0.0
        return abs(float(self.quantity) * float(self.price))


@dataclass(frozen=True)
class ProgrammaticRiskBreach:
    """One deterministic risk-control breach."""

    code: str
    message: str
    observed: float | int | str
    limit: float | int | str
    severity: str = "deny"


class ProgrammaticRiskRuleBook:
    """Evaluate programmatic trading limits over normalized events."""

    def __init__(self, limits: ProgrammaticRiskLimits | None = None):
        self.limits = limits or ProgrammaticRiskLimits()

    def evaluate_order(
        self,
        event: ProgrammaticOrderEvent,
        history: Iterable[ProgrammaticOrderEvent] = (),
    ) -> list[ProgrammaticRiskBreach]:
        """Return all breaches for an order candidate."""
        breaches: list[ProgrammaticRiskBreach] = []
        breaches.extend(self.audit_breaches(event))
        breaches.extend(self.rate_breaches(event, history))
        breaches.extend(self.cancel_ratio_breaches(history))
        breaches.extend(self.notional_breaches(event, history))
        return breaches

    def audit_breaches(self, event: ProgrammaticOrderEvent) -> list[ProgrammaticRiskBreach]:
        payload = {
            "strategy_id": event.strategy_id,
            "account_id": event.account_id,
            "symbol": event.symbol,
            "side": event.side,
            "order_type": event.order_type,
            "timestamp": event.timestamp,
        }
        missing = sorted(k for k in self.limits.required_audit_fields if not payload.get(k))
        if event.quantity <= 0 and event.notional is None:
            missing.append("quantity_or_notional")
        if not missing:
            return []
        return [
            ProgrammaticRiskBreach(
                code="audit_fields_missing",
                message="required programmatic trading audit fields are missing",
                observed=",".join(missing),
                limit="all_required_fields_present",
            )
        ]

    def rate_breaches(
        self,
        event: ProgrammaticOrderEvent,
        history: Iterable[ProgrammaticOrderEvent],
    ) -> list[ProgrammaticRiskBreach]:
        order_events = [
            e for e in history
            if e.event_type == "order"
            and e.strategy_id == event.strategy_id
            and e.account_id == event.account_id
        ]
        ts = event.ts
        one_second = _count_since(order_events, ts - timedelta(seconds=1), ts)
        one_minute = _count_since(order_events, ts - timedelta(minutes=1), ts)
        breaches: list[ProgrammaticRiskBreach] = []
        if one_second + 1 > self.limits.max_orders_per_second:
            breaches.append(
                ProgrammaticRiskBreach(
                    code="orders_per_second",
                    message="strategy order rate exceeds per-second limit",
                    observed=one_second + 1,
                    limit=self.limits.max_orders_per_second,
                )
            )
        if one_minute + 1 > self.limits.max_orders_per_minute:
            breaches.append(
                ProgrammaticRiskBreach(
                    code="orders_per_minute",
                    message="strategy order rate exceeds per-minute limit",
                    observed=one_minute + 1,
                    limit=self.limits.max_orders_per_minute,
                )
            )
        return breaches

    def cancel_ratio_breaches(self, history: Iterable[ProgrammaticOrderEvent]) -> list[ProgrammaticRiskBreach]:
        events = list(history)
        order_count = sum(1 for e in events if e.event_type == "order")
        cancel_count = sum(1 for e in events if e.event_type == "cancel")
        if order_count < self.limits.min_orders_for_cancel_ratio:
            return []
        ratio = cancel_count / order_count if order_count else 0.0
        if ratio <= self.limits.max_cancel_ratio:
            return []
        return [
            ProgrammaticRiskBreach(
                code="cancel_ratio",
                message="strategy cancellation ratio exceeds configured limit",
                observed=round(ratio, 4),
                limit=self.limits.max_cancel_ratio,
                severity="pause",
            )
        ]

    def notional_breaches(
        self,
        event: ProgrammaticOrderEvent,
        history: Iterable[ProgrammaticOrderEvent],
    ) -> list[ProgrammaticRiskBreach]:
        breaches: list[ProgrammaticRiskBreach] = []
        order_notional = event.effective_notional
        if order_notional > self.limits.max_single_order_notional:
            breaches.append(
                ProgrammaticRiskBreach(
                    code="single_order_notional",
                    message="single order notional exceeds configured limit",
                    observed=round(order_notional, 2),
                    limit=self.limits.max_single_order_notional,
                )
            )

        event_day = event.ts.date()
        day_notional = sum(
            e.effective_notional
            for e in history
            if e.event_type == "order"
            and e.strategy_id == event.strategy_id
            and e.account_id == event.account_id
            and e.ts.date() == event_day
        )
        projected = day_notional + order_notional
        if projected > self.limits.max_strategy_daily_notional:
            breaches.append(
                ProgrammaticRiskBreach(
                    code="strategy_daily_notional",
                    message="strategy daily notional exceeds configured limit",
                    observed=round(projected, 2),
                    limit=self.limits.max_strategy_daily_notional,
                    severity="pause",
                )
            )
        return breaches


def _count_since(events: Iterable[ProgrammaticOrderEvent], start: pd.Timestamp, end: pd.Timestamp) -> int:
    return sum(1 for event in events if start < event.ts <= end)
