"""Versioned China A-share trading rule book.

This module keeps exchange and board mechanics separate from execution so
backtests and future live pre-trade guards can share one source of truth. The
defaults model ordinary A-share cash-equity rules around the 2026-07-06
exchange-rule revision while preserving legacy behaviour when point-in-time
metadata is unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import pandas as pd


MAIN_BOARD_LIMIT = 0.10
RISK_WARNING_LIMIT = 0.05
CHINEXT_STAR_LIMIT = 0.20
BEIJING_LIMIT = 0.30
DEFAULT_BUY_LOT_SIZE = 100
DEFAULT_TICK_SIZE = 0.01
STAMP_TAX_SELL_FROM_2023_08_28 = 0.0005
STAMP_TAX_SELL_BEFORE_2023_08_28 = 0.001

OPEN_AUCTION_START = time(9, 15)
OPEN_AUCTION_END = time(9, 25)
AM_CONTINUOUS_START = time(9, 30)
AM_CONTINUOUS_END = time(11, 30)
PM_CONTINUOUS_START = time(13, 0)
PM_CONTINUOUS_END = time(14, 57)
CLOSE_AUCTION_START = time(14, 57)
CLOSE_AUCTION_END = time(15, 0)
AFTER_HOURS_FIXED_START = time(15, 5)
AFTER_HOURS_FIXED_END = time(15, 30)


@dataclass(frozen=True)
class AShareSecurityProfile:
    """Point-in-time security metadata used to resolve A-share rules."""

    symbol: str
    board: str
    exchange: str
    is_risk_warning: bool = False
    is_delisting_period: bool = False
    is_ipo_unlimited: bool = False
    is_suspended: bool = False
    security_type: str = "stock"


@dataclass(frozen=True)
class AShareRuleSet:
    """Resolved trading rules for one security on one trading date."""

    price_limit: float | None
    buy_lot_size: int = DEFAULT_BUY_LOT_SIZE
    tick_size: float = DEFAULT_TICK_SIZE
    t_plus_one: bool = True
    allow_short: bool = False
    stamp_tax_sell: float = 0.0005
    transfer_fee: float = 0.00001
    commission_rate: float = 0.00025
    commission_min: float = 5.0
    can_buy: bool = True
    can_sell: bool = True
    supports_after_hours_fixed_price: bool = True
    effective_from: date = date(2026, 7, 6)
    source: str = "A-share cash equity rules, 2026 exchange-rule revision baseline"


class AShareRuleBook:
    """Resolve A-share trading rules from symbol, bar metadata, and date."""

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}

    def resolve(self, symbol: str, bar: pd.Series | None = None) -> AShareRuleSet:
        profile = self.profile(symbol, bar)
        return AShareRuleSet(
            price_limit=self.price_limit_for_profile(profile),
            can_buy=not profile.is_suspended,
            can_sell=not profile.is_suspended,
            stamp_tax_sell=float(self.config.get("stamp_tax", 0.0005)),
            transfer_fee=float(self.config.get("transfer_fee", 0.00001)),
            commission_rate=float(self.config.get("commission_rate", 0.00025)),
            commission_min=float(self.config.get("commission_min", 5.0)),
        )

    def profile(self, symbol: str, bar: pd.Series | None = None) -> AShareSecurityProfile:
        code, suffix = _split_symbol(symbol)
        return AShareSecurityProfile(
            symbol=symbol,
            board=_infer_board(code, suffix),
            exchange=_exchange_from_suffix(suffix),
            is_risk_warning=_bar_bool(bar, "is_st", "is_risk_warning", "risk_warning", "st"),
            is_delisting_period=_bar_bool(bar, "is_delisting", "delisting", "is_delisting_period"),
            is_ipo_unlimited=_bar_bool(bar, "is_ipo_unlimited", "ipo_unlimited", "no_price_limit"),
            is_suspended=_bar_bool(bar, "is_suspended", "suspended", "is_pause", "paused"),
            security_type=str(_bar_value(bar, "security_type", default="stock") or "stock"),
        )

    def price_limit_for_profile(self, profile: AShareSecurityProfile) -> float | None:
        if profile.is_suspended or profile.is_ipo_unlimited:
            return None
        if profile.is_risk_warning:
            return RISK_WARNING_LIMIT
        if profile.board in {"chinext", "star"}:
            return CHINEXT_STAR_LIMIT
        if profile.board == "beijing":
            return BEIJING_LIMIT
        return MAIN_BOARD_LIMIT

    def can_execute(
        self,
        symbol: str,
        direction: int,
        bar: pd.Series,
        *,
        position_entry_time: Any = None,
    ) -> bool:
        rules = self.resolve(symbol, bar)
        if direction == -1 and not rules.allow_short:
            return False
        if direction == 1 and not rules.can_buy:
            return False
        if direction == 0 and not rules.can_sell:
            return False
        if direction == 0 and rules.t_plus_one and _same_trade_date(position_entry_time, bar):
            return False

        pct_chg = calc_pct_change(bar)
        if pct_chg is not None and rules.price_limit is not None:
            if direction == 1 and pct_chg >= rules.price_limit - 0.001:
                return False
            if direction == 0 and pct_chg <= -rules.price_limit + 0.001:
                return False
        return True

    def round_buy_size(self, raw_size: float) -> float:
        return max(int(raw_size / DEFAULT_BUY_LOT_SIZE) * DEFAULT_BUY_LOT_SIZE, 0)

    def calc_fee(self, size: float, price: float, *, is_open: bool) -> float:
        rules = self.resolve("")
        return self.calc_fee_at(size, price, is_open=is_open, trade_date=None, rules=rules)

    def calc_fee_at(
        self,
        size: float,
        price: float,
        *,
        is_open: bool,
        trade_date: date | pd.Timestamp | str | None = None,
        rules: AShareRuleSet | None = None,
    ) -> float:
        rules = rules or self.resolve("")
        notional = size * price
        fee = max(notional * rules.commission_rate, rules.commission_min)
        fee += notional * rules.transfer_fee
        if not is_open:
            fee += notional * self.stamp_tax_sell_rate(trade_date, default=rules.stamp_tax_sell)
        return fee

    def stamp_tax_sell_rate(
        self,
        trade_date: date | pd.Timestamp | str | None,
        *,
        default: float = STAMP_TAX_SELL_FROM_2023_08_28,
    ) -> float:
        if trade_date is None:
            return default
        d = _coerce_date(trade_date)
        if d is None:
            return default
        if d >= date(2023, 8, 28):
            return STAMP_TAX_SELL_FROM_2023_08_28
        return STAMP_TAX_SELL_BEFORE_2023_08_28

    def limit_prices(self, symbol: str, pre_close: float, bar: pd.Series | None = None) -> tuple[float, float] | None:
        rules = self.resolve(symbol, bar)
        if rules.price_limit is None or pre_close <= 0:
            return None
        lower = round_to_tick(pre_close * (1 - rules.price_limit), rules.tick_size)
        upper = round_to_tick(pre_close * (1 + rules.price_limit), rules.tick_size)
        return lower, upper

    def trading_phase(self, timestamp: pd.Timestamp | str) -> str | None:
        ts = pd.Timestamp(timestamp)
        t = ts.time()
        if OPEN_AUCTION_START <= t <= OPEN_AUCTION_END:
            return "opening_call_auction"
        if AM_CONTINUOUS_START <= t <= AM_CONTINUOUS_END:
            return "continuous_auction"
        if PM_CONTINUOUS_START <= t < PM_CONTINUOUS_END:
            return "continuous_auction"
        if CLOSE_AUCTION_START <= t <= CLOSE_AUCTION_END:
            return "closing_call_auction"
        if AFTER_HOURS_FIXED_START <= t <= AFTER_HOURS_FIXED_END:
            return "after_hours_fixed_price"
        return None

    def is_trading_time(self, timestamp: pd.Timestamp | str, *, include_after_hours: bool = True) -> bool:
        phase = self.trading_phase(timestamp)
        if phase is None:
            return False
        if phase == "after_hours_fixed_price" and not include_after_hours:
            return False
        return True


def bar_date(bar: pd.Series):
    """Extract date from bar, handling common loader column names."""
    for col in ("trade_date", "date"):
        if col in bar.index:
            val = bar[col]
            if hasattr(val, "date"):
                return val.date()
            try:
                return pd.Timestamp(val).date()
            except Exception:
                pass
    if hasattr(bar, "name") and hasattr(bar.name, "date"):
        return bar.name.date()
    return None


def calc_pct_change(bar: pd.Series):
    """Calculate price change fraction from pct_chg or close/pre_close."""
    if "pct_chg" in bar.index:
        val = bar["pct_chg"]
        if pd.notna(val):
            return float(val) / 100.0

    close = bar.get("close")
    pre_close = bar.get("pre_close")
    if close is not None and pre_close is not None and pre_close > 0:
        return (float(close) - float(pre_close)) / float(pre_close)
    return None


def price_limit(symbol: str, bar: pd.Series | None = None) -> float | None:
    return AShareRuleBook().resolve(symbol, bar).price_limit


def round_to_tick(price: float, tick_size: float = DEFAULT_TICK_SIZE) -> float:
    tick = Decimal(str(tick_size))
    value = Decimal(str(price))
    return float((value / tick).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * tick)


def _split_symbol(symbol: str) -> tuple[str, str]:
    if "." in symbol:
        code, suffix = symbol.split(".", 1)
        return code.upper(), suffix.upper()
    return symbol.upper(), ""


def _exchange_from_suffix(suffix: str) -> str:
    return {"SH": "sse", "SZ": "szse", "BJ": "bse"}.get(suffix.upper(), "unknown")


def _infer_board(code: str, suffix: str) -> str:
    if suffix.upper() == "BJ" or (len(code) == 6 and code.startswith(("8", "4"))):
        return "beijing"
    if code.startswith("688"):
        return "star"
    if code.startswith("300"):
        return "chinext"
    return "main"


def _bar_bool(bar: pd.Series | None, *names: str) -> bool:
    val = _bar_value(bar, *names, default=False)
    if isinstance(val, str):
        return val.strip().lower() in {"1", "true", "yes", "y", "st", "*st", "suspended"}
    try:
        return bool(val)
    except Exception:
        return False


def _bar_value(bar: pd.Series | None, *names: str, default: Any = None) -> Any:
    if bar is None:
        return default
    for name in names:
        if name in bar.index and pd.notna(bar[name]):
            return bar[name]
    return default


def _coerce_date(value: date | pd.Timestamp | str | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, pd.Timestamp):
        return value
    try:
        return pd.Timestamp(value).date()
    except Exception:
        return None


def _same_trade_date(entry_time: Any, bar: pd.Series) -> bool:
    if entry_time is None:
        return False
    current = bar_date(bar)
    entry = entry_time.date() if hasattr(entry_time, "date") else None
    return current is not None and entry is not None and current == entry
