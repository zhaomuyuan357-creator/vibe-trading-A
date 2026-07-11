"""A-share (China mainland) backtest engine."""

from __future__ import annotations

import pandas as pd

from backtest.engines.base import BaseEngine
from backtest.rules.ashare import AShareRuleBook, bar_date, calc_pct_change, price_limit


class ChinaAEngine(BaseEngine):
    """A-share market engine backed by a versioned rule book.

    Config keys:
      - commission_rate: default 0.00025
      - commission_min: default 5.0 RMB
      - stamp_tax: default 0.0005, sell-only
      - transfer_fee: default 0.00001
      - slippage: default 0.001
    """

    def __init__(self, config: dict):
        config = {**config, "leverage": 1.0}
        super().__init__(config)
        self.commission_rate: float = config.get("commission_rate", 0.00025)
        self.commission_min: float = config.get("commission_min", 5.0)
        self.stamp_tax: float = config.get("stamp_tax", 0.0005)
        self.transfer_fee: float = config.get("transfer_fee", 0.00001)
        self.slippage_rate: float = config.get("slippage", 0.001)
        self.rule_book = AShareRuleBook(config)

    def can_execute(self, symbol: str, direction: int, bar: pd.Series) -> bool:
        """Return whether A-share market rules allow this trade."""
        pos = self.positions.get(symbol)
        entry_time = pos.entry_time if pos is not None else None
        return self.rule_book.can_execute(symbol, direction, bar, position_entry_time=entry_time)

    def round_size(self, raw_size: float, price: float) -> float:
        """Round buys down to 100-share board lots."""
        return self.rule_book.round_buy_size(raw_size)

    def calc_commission(self, size: float, price: float, _direction: int, is_open: bool) -> float:
        """A-share fee structure: commission + transfer fee + sell stamp tax."""
        return self.rule_book.calc_fee(size, price, is_open=is_open)

    def apply_slippage(self, price: float, direction: int) -> float:
        """A-share slippage model."""
        return price * (1 + direction * self.slippage_rate)


def _bar_date(bar: pd.Series):
    """Compatibility wrapper for existing tests/imports."""
    return bar_date(bar)


def _calc_pct_change(bar: pd.Series):
    """Compatibility wrapper for existing tests/imports."""
    return calc_pct_change(bar)


def _price_limit(symbol: str) -> float | None:
    """Compatibility wrapper for existing tests/imports."""
    return price_limit(symbol)
