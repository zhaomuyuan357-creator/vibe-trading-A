"""Tests for ChinaAEngine market rules.

Validates:
  - T+1 lock: can't sell shares bought today
  - No short selling
  - Price limit (涨跌停) enforcement
  - 100-share lot rounding
  - Commission structure (min ¥5, stamp tax sell-only, transfer fee)
  - Slippage
  - Price limit detection helper
"""

from __future__ import annotations

import pandas as pd
import pytest

from backtest.engines.china_a import (
    ChinaAEngine,
    _bar_date,
    _calc_pct_change,
    _price_limit,
)
from backtest.models import Position
from backtest.rules.ashare import AShareRuleBook


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_bar(
    close: float = 15.0,
    pre_close: float | None = None,
    pct_chg: float | None = None,
    trade_date: str | None = None,
    open_: float | None = None,
) -> pd.Series:
    """Build a minimal bar Series for testing."""
    d: dict = {"close": close, "open": open_ or close}
    if pre_close is not None:
        d["pre_close"] = pre_close
    if pct_chg is not None:
        d["pct_chg"] = pct_chg
    if trade_date is not None:
        d["trade_date"] = pd.Timestamp(trade_date)
    return pd.Series(d)


def _make_engine(**overrides) -> ChinaAEngine:
    config = {"initial_cash": 1_000_000}
    config.update(overrides)
    return ChinaAEngine(config)


# ---------------------------------------------------------------------------
# can_execute: no short selling
# ---------------------------------------------------------------------------


class TestNoShortSelling:
    def test_short_blocked(self) -> None:
        engine = _make_engine()
        bar = _make_bar()
        assert engine.can_execute("000001.SZ", -1, bar) is False

    def test_long_allowed(self) -> None:
        engine = _make_engine()
        bar = _make_bar()
        assert engine.can_execute("000001.SZ", 1, bar) is True

    def test_close_allowed_when_no_position(self) -> None:
        engine = _make_engine()
        bar = _make_bar()
        assert engine.can_execute("000001.SZ", 0, bar) is True


# ---------------------------------------------------------------------------
# can_execute: T+1
# ---------------------------------------------------------------------------


class TestTPlusOne:
    def test_sell_same_day_blocked(self) -> None:
        engine = _make_engine()
        # Simulate position bought today
        engine.positions["000001.SZ"] = Position(
            symbol="000001.SZ",
            direction=1,
            entry_price=15.0,
            entry_time=pd.Timestamp("2025-06-10"),
            size=100.0,
        )
        bar = _make_bar(trade_date="2025-06-10")
        assert engine.can_execute("000001.SZ", 0, bar) is False

    def test_sell_next_day_allowed(self) -> None:
        engine = _make_engine()
        engine.positions["000001.SZ"] = Position(
            symbol="000001.SZ",
            direction=1,
            entry_price=15.0,
            entry_time=pd.Timestamp("2025-06-10"),
            size=100.0,
        )
        bar = _make_bar(trade_date="2025-06-11")
        assert engine.can_execute("000001.SZ", 0, bar) is True

    def test_sell_allowed_when_no_position(self) -> None:
        engine = _make_engine()
        bar = _make_bar(trade_date="2025-06-10")
        assert engine.can_execute("000001.SZ", 0, bar) is True


# ---------------------------------------------------------------------------
# can_execute: price limits (涨跌停)
# ---------------------------------------------------------------------------


class TestPriceLimits:
    def test_limit_up_buy_blocked(self) -> None:
        """Mainboard +10% limit-up: can't buy."""
        engine = _make_engine()
        bar = _make_bar(close=16.5, pre_close=15.0)  # +10%
        assert engine.can_execute("000001.SZ", 1, bar) is False

    def test_limit_down_sell_blocked(self) -> None:
        """Mainboard -10% limit-down: can't sell."""
        engine = _make_engine()
        engine.positions["000001.SZ"] = Position(
            "000001.SZ", 1, 15.0, pd.Timestamp("2025-06-09"), 100.0,
        )
        bar = _make_bar(close=13.5, pre_close=15.0, trade_date="2025-06-10")
        assert engine.can_execute("000001.SZ", 0, bar) is False

    def test_within_limit_allowed(self) -> None:
        engine = _make_engine()
        bar = _make_bar(close=15.5, pre_close=15.0)  # +3.3%
        assert engine.can_execute("000001.SZ", 1, bar) is True

    def test_pct_chg_field_used(self) -> None:
        """pct_chg in percentage points (tushare format)."""
        engine = _make_engine()
        bar = _make_bar(pct_chg=10.0)  # 10% in tushare = +0.10
        assert engine.can_execute("000001.SZ", 1, bar) is False

    def test_chinext_20pct_limit(self) -> None:
        """ChiNext (300xxx) has ±20% limit."""
        engine = _make_engine()
        bar = _make_bar(close=18.0, pre_close=15.0)  # +20%
        assert engine.can_execute("300750.SZ", 1, bar) is False

    def test_chinext_within_limit(self) -> None:
        engine = _make_engine()
        bar = _make_bar(close=17.0, pre_close=15.0)  # +13.3%
        assert engine.can_execute("300750.SZ", 1, bar) is True

    def test_st_limit_uses_bar_metadata(self) -> None:
        engine = _make_engine()
        bar = _make_bar(close=15.75, pre_close=15.0)
        bar["is_st"] = True
        assert engine.can_execute("600001.SH", 1, bar) is False

    def test_ipo_unlimited_bar_does_not_block_at_static_limit(self) -> None:
        engine = _make_engine()
        bar = _make_bar(close=18.0, pre_close=15.0)
        bar["is_ipo_unlimited"] = True
        assert engine.can_execute("600001.SH", 1, bar) is True

    def test_suspended_bar_blocks_buy_and_sell(self) -> None:
        engine = _make_engine()
        engine.positions["000001.SZ"] = Position(
            "000001.SZ", 1, 15.0, pd.Timestamp("2025-06-09"), 100.0,
        )
        bar = _make_bar(close=15.0, pre_close=15.0, trade_date="2025-06-10")
        bar["is_suspended"] = True
        assert engine.can_execute("000001.SZ", 1, bar) is False
        assert engine.can_execute("000001.SZ", 0, bar) is False


# ---------------------------------------------------------------------------
# round_size: 100-share lots
# ---------------------------------------------------------------------------


class TestRoundSize:
    def test_exact_lots(self) -> None:
        engine = _make_engine()
        assert engine.round_size(300.0, 15.0) == 300

    def test_rounds_down(self) -> None:
        engine = _make_engine()
        assert engine.round_size(350.0, 15.0) == 300
        assert engine.round_size(199.0, 15.0) == 100
        assert engine.round_size(99.0, 15.0) == 0

    def test_zero_size(self) -> None:
        engine = _make_engine()
        assert engine.round_size(0.0, 15.0) == 0

    def test_negative_clamps_to_zero(self) -> None:
        engine = _make_engine()
        assert engine.round_size(-50.0, 15.0) == 0


# ---------------------------------------------------------------------------
# calc_commission: fee structure
# ---------------------------------------------------------------------------


class TestCommission:
    def test_minimum_commission(self) -> None:
        """Small trades hit the ¥5 minimum."""
        engine = _make_engine()
        # 100 shares × ¥3 = ¥300 notional → 0.025% = ¥0.075 → min ¥5
        comm = engine.calc_commission(100, 3.0, 1, is_open=True)
        assert comm >= 5.0

    def test_buy_no_stamp_tax(self) -> None:
        """Buy side: no stamp tax."""
        engine = _make_engine()
        comm_buy = engine.calc_commission(1000, 15.0, 1, is_open=True)
        comm_sell = engine.calc_commission(1000, 15.0, 1, is_open=False)
        # Sell has stamp tax, buy doesn't → sell > buy
        assert comm_sell > comm_buy

    def test_stamp_tax_sell_only(self) -> None:
        """Stamp tax: 0.05% on sell side only."""
        engine = _make_engine()
        size, price = 10000, 15.0
        notional = size * price  # 150,000
        comm_sell = engine.calc_commission(size, price, 1, is_open=False)
        # Stamp tax portion = 150000 × 0.0005 = ¥75
        stamp_portion = notional * engine.stamp_tax
        assert stamp_portion == pytest.approx(75.0, abs=0.01)
        # Sell commission includes stamp tax
        comm_buy = engine.calc_commission(size, price, 1, is_open=True)
        assert comm_sell - comm_buy == pytest.approx(stamp_portion, abs=0.1)

    def test_leverage_forced_one(self) -> None:
        """A-share engine forces leverage=1."""
        engine = _make_engine(leverage=10.0)
        assert engine.default_leverage == 1.0


# ---------------------------------------------------------------------------
# apply_slippage
# ---------------------------------------------------------------------------


class TestSlippage:
    def test_buy_slippage_increases_price(self) -> None:
        engine = _make_engine()
        assert engine.apply_slippage(100.0, 1) > 100.0

    def test_sell_slippage_decreases_price(self) -> None:
        engine = _make_engine()
        assert engine.apply_slippage(100.0, -1) < 100.0

    def test_custom_slippage_rate(self) -> None:
        engine = _make_engine(slippage=0.005)
        assert engine.apply_slippage(100.0, 1) == pytest.approx(100.5)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


class TestPriceLimit:
    @pytest.mark.parametrize(
        "symbol, expected",
        [
            ("000001.SZ", 0.10),   # Mainboard
            ("600519.SH", 0.10),
            ("300750.SZ", 0.20),   # ChiNext
            ("688001.SH", 0.20),   # STAR Market
            ("830799.BJ", 0.30),   # Beijing
        ],
    )
    def test_price_limits(self, symbol: str, expected: float) -> None:
        assert _price_limit(symbol) == expected


class TestAShareRuleBook:
    def test_resolves_2026_rule_set_defaults(self) -> None:
        rules = AShareRuleBook().resolve("600519.SH")
        assert rules.effective_from == pd.Timestamp("2026-07-06").date()
        assert rules.tick_size == 0.01
        assert rules.buy_lot_size == 100
        assert rules.t_plus_one is True
        assert rules.allow_short is False

    def test_profile_detects_star_chinext_and_beijing(self) -> None:
        book = AShareRuleBook()
        assert book.profile("688001.SH").board == "star"
        assert book.profile("300750.SZ").board == "chinext"
        assert book.profile("830799.BJ").board == "beijing"

    def test_limit_prices_round_to_tick(self) -> None:
        lower, upper = AShareRuleBook().limit_prices("600519.SH", 10.03)
        assert lower == pytest.approx(9.03)
        assert upper == pytest.approx(11.03)

    def test_stamp_tax_switches_by_trade_date(self) -> None:
        book = AShareRuleBook()
        assert book.stamp_tax_sell_rate("2023-08-25") == pytest.approx(0.001)
        assert book.stamp_tax_sell_rate("2023-08-28") == pytest.approx(0.0005)

    @pytest.mark.parametrize(
        "timestamp, phase",
        [
            ("2026-07-06 09:20:00", "opening_call_auction"),
            ("2026-07-06 10:00:00", "continuous_auction"),
            ("2026-07-06 14:58:00", "closing_call_auction"),
            ("2026-07-06 15:10:00", "after_hours_fixed_price"),
            ("2026-07-06 12:00:00", None),
        ],
    )
    def test_trading_phase_classification(self, timestamp: str, phase: str | None) -> None:
        assert AShareRuleBook().trading_phase(timestamp) == phase

    def test_can_exclude_after_hours_from_regular_trading_time(self) -> None:
        book = AShareRuleBook()
        assert book.is_trading_time("2026-07-06 15:10:00") is True
        assert book.is_trading_time("2026-07-06 15:10:00", include_after_hours=False) is False


class TestCalcPctChange:
    def test_from_pct_chg_field(self) -> None:
        bar = _make_bar(pct_chg=5.0)
        assert _calc_pct_change(bar) == pytest.approx(0.05)

    def test_from_close_and_pre_close(self) -> None:
        bar = _make_bar(close=16.5, pre_close=15.0)
        assert _calc_pct_change(bar) == pytest.approx(0.1)

    def test_none_when_no_data(self) -> None:
        bar = pd.Series({"close": 15.0})
        assert _calc_pct_change(bar) is None


class TestBarDate:
    def test_from_trade_date_col(self) -> None:
        bar = _make_bar(trade_date="2025-06-10")
        assert _bar_date(bar) == pd.Timestamp("2025-06-10").date()

    def test_from_index_name(self) -> None:
        bar = pd.Series({"close": 15.0}, name=pd.Timestamp("2025-06-10"))
        assert _bar_date(bar) == pd.Timestamp("2025-06-10").date()

    def test_none_when_no_date(self) -> None:
        bar = pd.Series({"close": 15.0})
        assert _bar_date(bar) is None
