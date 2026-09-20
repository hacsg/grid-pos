"""Historical, weekday-aware month-end sales forecasting.

Qashier rows are analytics-only observations.  Current-month Grid orders remain
the authoritative earned amount; historical data is used only to estimate the
remaining days of the month.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from statistics import median
from typing import NamedTuple
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.historical_daily_sale import HistoricalDailySale
from app.models.order import Order, OrderStatus
from app.models.outlet import Outlet
from app.utils.timezone import sgt_day_bounds_utc

SGT = ZoneInfo("Asia/Singapore")
UTC = ZoneInfo("UTC")
HISTORY_HORIZON_DAYS = 540
RECENCY_HALF_LIFE_DAYS = 120.0
MIN_HISTORY_SAMPLES = 7

# Singapore Ministry of Manpower gazetted public-holiday dates.  Observed
# Mondays explicitly identified by MOM are included because shops experience
# them as public holidays too.  Keep this list current as MOM publishes each
# year's dates: https://www.mom.gov.sg/employment-practices/public-holidays
_PUBLIC_HOLIDAYS = {
    # 2025 (including Polling Day, which was a public holiday)
    date(2025, 1, 1), date(2025, 1, 29), date(2025, 1, 30),
    date(2025, 3, 31), date(2025, 4, 18), date(2025, 5, 1),
    date(2025, 5, 3), date(2025, 5, 12), date(2025, 6, 7),
    date(2025, 8, 9), date(2025, 10, 20), date(2025, 12, 25),
    # 2026
    date(2026, 1, 1), date(2026, 2, 17), date(2026, 2, 18),
    date(2026, 3, 21), date(2026, 4, 3), date(2026, 5, 1),
    date(2026, 5, 27), date(2026, 5, 31), date(2026, 6, 1),
    date(2026, 8, 9), date(2026, 8, 10), date(2026, 11, 8),
    date(2026, 11, 9), date(2026, 12, 25),
}
_HOLIDAY_EVES = {holiday - timedelta(days=1) for holiday in _PUBLIC_HOLIDAYS}


class OutletForecastBreakdown(NamedTuple):
    outlet_id: UUID
    outlet_name: str
    projected_total: float
    earned_so_far: float
    remaining: float
    method: str
    history_days: int
    pace_variance_pct: float | None = None


class ForecastResult(NamedTuple):
    projected_total: float
    earned_so_far: float
    remaining: float
    method: str
    history_days: int
    sample_count: int
    outlets: list[OutletForecastBreakdown]
    pace_variance_pct: float | None = None


class OutletForecast(NamedTuple):
    remaining: float
    method: str
    history_days: int
    sample_count: int
    pace_actual: float = 0.0
    pace_expected: float = 0.0


def _event_kind(value: date) -> str | None:
    """Classify a date for the conservative holiday adjustment."""
    if value in _PUBLIC_HOLIDAYS:
        return "public_holiday"
    if value in _HOLIDAY_EVES:
        return "holiday_eve"
    return None


def _weighted_mean(samples: list[tuple[date, float]], target_date: date) -> float | None:
    weighted_sum = 0.0
    weight_sum = 0.0
    for sample_date, value in samples:
        if sample_date >= target_date:
            continue
        age_days = (target_date - sample_date).days
        weight = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
        weighted_sum += weight * value
        weight_sum += weight
    return weighted_sum / weight_sum if weight_sum else None


def _weekday_baseline(history: dict[date, float], target_date: date) -> float | None:
    samples = [
        (sample_date, value)
        for sample_date, value in history.items()
        if sample_date.weekday() == target_date.weekday()
    ]
    baseline = _weighted_mean(samples, target_date)
    if baseline is not None:
        return baseline
    return _weighted_mean(list(history.items()), target_date)


def _holiday_multiplier(history: dict[date, float], target_date: date) -> float:
    """Learn a shrunk outlet-specific holiday/eve lift from historical ratios."""
    kind = _event_kind(target_date)
    if kind is None:
        return 1.0

    ratios: list[float] = []
    for sample_date, value in history.items():
        if _event_kind(sample_date) != kind:
            continue
        ordinary_same_weekday = {
            d: v
            for d, v in history.items()
            if d != sample_date and d.weekday() == sample_date.weekday() and _event_kind(d) is None
        }
        baseline = _weighted_mean(list(ordinary_same_weekday.items()), sample_date)
        if baseline and baseline > 0:
            ratios.append(value / baseline)

    if len(ratios) < 2:
        return 1.0
    raw = max(0.75, min(1.35, median(ratios)))
    shrinkage = len(ratios) / (len(ratios) + 8.0)
    return 1.0 + (raw - 1.0) * shrinkage


def _expected_for_date(history: dict[date, float], target_date: date) -> float | None:
    baseline = _weekday_baseline(history, target_date)
    if baseline is None:
        return None
    return max(0.0, baseline * _holiday_multiplier(history, target_date))


def _forecast_outlet_remaining(
    history: dict[date, float],
    completed_actuals: dict[date, float],
    current_date: date,
) -> OutletForecast:
    """Forecast one outlet's dates after ``current_date``.

    ``history`` contains only training observations. ``completed_actuals``
    contains Grid totals for fully completed current-month operating dates;
    the partial current date is intentionally absent.
    """
    history = {
        sample_date: float(value)
        for sample_date, value in history.items()
        if current_date - timedelta(days=HISTORY_HORIZON_DAYS) <= sample_date < current_date
    }
    history_days = len(history)
    _, days_in_month = monthrange(current_date.year, current_date.month)
    future_dates = [
        current_date + timedelta(days=offset)
        for offset in range(1, days_in_month - current_date.day + 1)
    ]

    if history_days < MIN_HISTORY_SAMPLES:
        if not completed_actuals:
            remaining = 0.0
        else:
            average = sum(completed_actuals.values()) / len(completed_actuals)
            remaining = max(0.0, average * len(future_dates))
        return OutletForecast(remaining, "run_rate_fallback", history_days, history_days)

    actual_total = 0.0
    expected_total = 0.0
    comparable_days = 0
    for completed_date, actual in sorted(completed_actuals.items()):
        expected = _expected_for_date(history, completed_date)
        if expected is None:
            continue
        actual_total += actual
        expected_total += expected
        comparable_days += 1

    pace_ratio = actual_total / expected_total if expected_total > 0 else 1.0
    pace_ratio = max(0.70, min(1.30, pace_ratio))
    pace_weight = min(0.50, comparable_days / 28.0)
    blended_pace = 1.0 + pace_weight * (pace_ratio - 1.0)

    remaining = 0.0
    for future_date in future_dates:
        expected = _expected_for_date(history, future_date)
        if expected is not None:
            remaining += expected * blended_pace

    return OutletForecast(
        max(0.0, remaining),
        "historical_weekday_blend",
        history_days,
        history_days,
        pace_actual=round(actual_total, 2),
        pace_expected=round(expected_total, 2),
    )


def _sgt_date(created_at: datetime) -> date:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return created_at.astimezone(SGT).date()


async def calculate_month_end_prediction(
    db: AsyncSession,
    outlet_id: UUID | None,
    current_date: date,
) -> ForecastResult:
    """Return actual Grid sales plus a history-based estimate of future dates."""
    month_start = current_date.replace(day=1)
    month_start_utc = sgt_day_bounds_utc(month_start)[0]
    today_end_utc = sgt_day_bounds_utc(current_date)[1]
    horizon_start = current_date - timedelta(days=HISTORY_HORIZON_DAYS)
    horizon_start_utc = sgt_day_bounds_utc(horizon_start)[0]

    if outlet_id is not None:
        outlet_ids = [outlet_id]
    else:
        visible_rows = await db.execute(select(Outlet.id).where(Outlet.is_hidden == False))
        outlet_ids = [row[0] for row in visible_rows.all()]

    if not outlet_ids:
        return ForecastResult(0.0, 0.0, 0.0, "run_rate_fallback", 0, 0, [])

    outlet_name_rows = (await db.execute(
        select(Outlet.id, Outlet.name).where(Outlet.id.in_(outlet_ids))
    )).all()
    outlet_names = {oid: name for oid, name in outlet_name_rows}

    current_stmt = select(Order).where(
        Order.status == OrderStatus.paid,
        Order.created_at >= month_start_utc,
        Order.created_at < today_end_utc,
        Order.outlet_id.in_(outlet_ids),
    )
    current_orders = (await db.execute(current_stmt)).scalars().all()

    historical_rows = (await db.execute(
        select(
            HistoricalDailySale.outlet_id,
            HistoricalDailySale.sales_date,
            HistoricalDailySale.net_sales,
        ).where(
            HistoricalDailySale.sales_date >= horizon_start,
            HistoricalDailySale.sales_date < current_date,
            HistoricalDailySale.outlet_id.in_(outlet_ids),
        )
    )).all()

    # Imported daily totals that fall inside the CURRENT month but before today
    # (e.g. an outlet still on Qashier for the first days of its cutover month).
    # These count as real month-to-date sales for those days.
    current_month_hist = (await db.execute(
        select(
            HistoricalDailySale.outlet_id,
            HistoricalDailySale.sales_date,
            HistoricalDailySale.net_sales,
        ).where(
            HistoricalDailySale.sales_date >= month_start,
            HistoricalDailySale.sales_date < current_date,
            HistoricalDailySale.outlet_id.in_(outlet_ids),
        )
    )).all()

    prior_grid_rows = (await db.execute(
        select(Order.outlet_id, Order.created_at, Order.total).where(
            Order.status == OrderStatus.paid,
            Order.created_at >= horizon_start_utc,
            Order.created_at < month_start_utc,
            Order.outlet_id.in_(outlet_ids),
        )
    )).all()

    histories: dict[UUID, dict[date, float]] = {oid: {} for oid in outlet_ids}
    for oid, sales_date, net_sales in historical_rows:
        histories[oid][sales_date] = float(net_sales)

    # Grid is authoritative if a transition day ever overlaps a source report.
    prior_grid_daily: dict[tuple[UUID, date], float] = {}
    for oid, created_at, total in prior_grid_rows:
        key = (oid, _sgt_date(created_at))
        prior_grid_daily[key] = prior_grid_daily.get(key, 0.0) + float(total or 0)
    for (oid, sales_date), total in prior_grid_daily.items():
        histories[oid][sales_date] = total

    # Build each outlet's completed-day map for THIS month (before today).
    # Grid orders win over an imported same-day value; imported Qashier days
    # fill days the outlet had not yet cut over to Grid.
    current_daily: dict[tuple[UUID, date], float] = {}
    for oid, sales_date, net_sales in current_month_hist:
        current_daily[(oid, sales_date)] = float(net_sales)
    grid_daily_this_month: dict[tuple[UUID, date], float] = {}
    today_partial: dict[UUID, float] = {}
    for order in current_orders:
        order_date = _sgt_date(order.created_at)
        amount = float(order.total or 0)
        if order_date >= current_date:
            today_partial[order.outlet_id] = today_partial.get(order.outlet_id, 0.0) + amount
            continue
        grid_daily_this_month[(order.outlet_id, order_date)] = (
            grid_daily_this_month.get((order.outlet_id, order_date), 0.0) + amount
        )
    # Grid wins for a day it genuinely traded, but a tiny cert-test order must
    # not wipe out a real imported day. Take the larger of the two when a day
    # has both an imported total and Grid orders.
    for key, total in grid_daily_this_month.items():
        current_daily[key] = max(current_daily.get(key, 0.0), total)

    total_remaining = 0.0
    total_earned = 0.0
    group_pace_actual = 0.0
    group_pace_expected = 0.0
    max_history_days = 0
    total_samples = 0
    used_historical_method = False
    outlet_breakdowns: list[OutletForecastBreakdown] = []

    def _variance_pct(actual: float, expected: float) -> float | None:
        # Actual vs model-expected sales on completed days so far this month.
        # Positive => ahead of the historical trend; negative => behind.
        if expected <= 0:
            return None
        return round((actual - expected) / expected * 100, 1)

    prior_grid_outlets = {oid for oid, _, _ in prior_grid_rows}
    for oid in outlet_ids:
        outlet_current_dates = [d for (order_oid, d) in current_daily if order_oid == oid]
        if oid in prior_grid_outlets:
            active_start = month_start
        elif outlet_current_dates:
            active_start = min(outlet_current_dates)
        else:
            active_start = current_date

        completed_actuals: dict[date, float] = {}
        cursor = active_start
        while cursor < current_date:
            if (oid, cursor) in current_daily:
                completed_actuals[cursor] = current_daily[(oid, cursor)]
            cursor += timedelta(days=1)

        outlet_result = _forecast_outlet_remaining(
            histories[oid], completed_actuals, current_date
        )
        total_remaining += outlet_result.remaining
        max_history_days = max(max_history_days, outlet_result.history_days)
        total_samples += outlet_result.sample_count
        used_historical_method |= outlet_result.method == "historical_weekday_blend"

        # Per-outlet earned = completed days this month (Grid where it traded,
        # imported Qashier for pre-cutover days) plus today's partial Grid sales.
        outlet_earned = round(
            sum(completed_actuals.values()) + today_partial.get(oid, 0.0),
            2,
        )
        total_earned += outlet_earned
        group_pace_actual += outlet_result.pace_actual
        group_pace_expected += outlet_result.pace_expected
        outlet_projected = round(max(outlet_earned, outlet_earned + outlet_result.remaining), 2)
        outlet_breakdowns.append(OutletForecastBreakdown(
            outlet_id=oid,
            outlet_name=outlet_names.get(oid, "Unknown"),
            projected_total=outlet_projected,
            earned_so_far=outlet_earned,
            remaining=round(max(0.0, outlet_projected - outlet_earned), 2),
            method=outlet_result.method,
            history_days=outlet_result.history_days,
            pace_variance_pct=_variance_pct(outlet_result.pace_actual, outlet_result.pace_expected),
        ))

    outlet_breakdowns.sort(key=lambda item: item.outlet_name)

    earned = round(total_earned, 2)
    projected = max(earned, earned + total_remaining)
    method = "historical_weekday_blend" if used_historical_method else "run_rate_fallback"
    group_variance = _variance_pct(group_pace_actual, group_pace_expected)
    return ForecastResult(
        round(projected, 2),
        round(earned, 2),
        round(max(0.0, projected - earned), 2),
        method,
        max_history_days,
        total_samples,
        outlet_breakdowns,
        group_variance,
    )
