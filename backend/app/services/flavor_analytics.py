"""Flavour analytics computed live from order-item modifier snapshots.

Grid stores each selected modifier on an order item as
``{"modifier_name": "<Group>: <Option>", "price_adjustment": ...}`` — the
group prefix lets us split gelato flavours from add-ons (cones, drink mods)
without joining the modifier tables, which also keeps deleted/rotated-out
flavours analysable.

Prod data contains duplicate modifier groups ("Gelato Flavors" and
"Gelato Flavors.") whose options differ only by a trailing dot ("Rocher" vs
"Rocher."), so names are normalised and merged case-insensitively.

Ports the Gusta flavour-analysis concept: performance matrix with
hero/rising/stable/rotate-out classification, Pareto concentration,
day-of-week heatmap, trend sparklines, and monthly ranking trends.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.schemas.flavor_analytics import (
    FlavorAnalysisResponse,
    FlavorDowRow,
    FlavorItem,
    FlavorOutletQty,
    FlavorRankingItem,
    FlavorRankingsResponse,
    FlavorTrendPoint,
    ParetoPoint,
)
from app.services.analytics import _to_sgt
from app.services.gto import SGT, sgt_day_bounds_utc

Granularity = Literal["daily", "weekly", "monthly"]

# Group-name prefixes that mark a modifier as a flavour.
_FLAVOR_GROUP_TOKENS = ("flavor", "flavour")


def parse_modifier_name(raw: str) -> tuple[str, bool]:
    """Return (display name, is_flavor) for a stored modifier_name.

    Splits the "<Group>: <Option>" prefix and normalises dot/whitespace
    variants so "Gelato Flavors.: Rocher." merges with "Gelato Flavors: Rocher".
    Unprefixed names are treated as add-ons.
    """
    raw = (raw or "").strip()
    group, sep, option = raw.partition(":")
    if sep:
        name = option.strip()
        is_flavor = any(token in group.lower() for token in _FLAVOR_GROUP_TOKENS)
    else:
        name = raw
        is_flavor = False
    name = " ".join(name.rstrip(". ").split())
    return name, is_flavor


class _FlavorAgg:
    def __init__(self, display_name: str) -> None:
        self.display_name = display_name
        self.total = 0
        self.by_date: dict[date, int] = defaultdict(int)
        self.by_outlet: dict[UUID, int] = defaultdict(int)
        self.by_dow = [0] * 7  # Monday..Sunday


def _trend_bucket_key(day: date, granularity: Granularity) -> date:
    if granularity == "daily":
        return day
    if granularity == "weekly":
        return day - timedelta(days=day.weekday())
    return day.replace(day=1)


def _trend_bucket_label(bucket: date, granularity: Granularity) -> str:
    if granularity == "daily":
        return bucket.strftime("%b %d").replace(" 0", " ")
    if granularity == "weekly":
        return f"W{bucket.isocalendar().week}"
    return bucket.strftime("%b %Y")


def _classify(total: int, trend_pct: float, top_25: int, bottom_25: int) -> str:
    """Gusta's quartile + momentum classification."""
    is_top = total >= top_25
    is_bottom = total <= bottom_25
    if is_top and trend_pct >= -10:
        return "hero"
    if trend_pct > 15 and not is_top:
        return "rising"
    if is_bottom and trend_pct < -10:
        return "rotate_out"
    return "stable"


async def _fetch_modifier_rows(
    db: AsyncSession,
    from_date: date | None,
    to_date: date | None,
    outlet_id: UUID | None,
):
    """(modifiers json, quantity, created_at, outlet_id) for paid orders in range."""
    stmt = (
        select(OrderItem.modifiers, OrderItem.quantity, Order.created_at, Order.outlet_id)
        .join(Order, OrderItem.order_id == Order.id)
        .where(Order.status == OrderStatus.paid)
    )
    if from_date is not None:
        stmt = stmt.where(Order.created_at >= sgt_day_bounds_utc(from_date)[0])
    if to_date is not None:
        stmt = stmt.where(Order.created_at < sgt_day_bounds_utc(to_date)[1])
    if outlet_id is not None:
        stmt = stmt.where(Order.outlet_id == outlet_id)
    return (await db.execute(stmt)).all()


def _aggregate_modifiers(rows) -> tuple[dict[str, _FlavorAgg], dict[str, _FlavorAgg]]:
    """Bucket modifier quantities into (flavours, addons) keyed by casefolded name."""
    flavors: dict[str, _FlavorAgg] = {}
    addons: dict[str, _FlavorAgg] = {}
    for modifiers, quantity, created_at, outlet_id in rows:
        day = _to_sgt(created_at).date()
        for mod in modifiers or []:
            name, is_flavor = parse_modifier_name(mod.get("modifier_name", ""))
            if not name:
                continue
            store = flavors if is_flavor else addons
            agg = store.get(name.casefold())
            if agg is None:
                agg = store[name.casefold()] = _FlavorAgg(name)
            qty = int(quantity or 1)
            agg.total += qty
            agg.by_date[day] += qty
            agg.by_outlet[outlet_id] += qty
            agg.by_dow[day.weekday()] += qty
    return flavors, addons


def _build_items(
    aggs: dict[str, _FlavorAgg],
    *,
    range_end: date,
    active_days: int,
    outlet_names: dict[UUID, str],
    granularity: Granularity,
) -> list[FlavorItem]:
    """Rank, classify, and shape aggregates into response items."""
    ordered = sorted(aggs.values(), key=lambda a: a.total, reverse=True)
    grand_total = sum(a.total for a in ordered)
    outlet_totals: dict[UUID, int] = defaultdict(int)
    for a in ordered:
        for oid, qty in a.by_outlet.items():
            outlet_totals[oid] += qty

    # Quartile thresholds over the sorted totals.
    n = len(ordered)
    top_25 = ordered[max(n // 4, 0)].total if n else 0
    bottom_25 = ordered[max(3 * n // 4, 0)].total if n else 0

    recent_start = range_end - timedelta(days=13)
    previous_start = range_end - timedelta(days=27)

    items: list[FlavorItem] = []
    for rank, agg in enumerate(ordered, 1):
        recent = sum(q for d, q in agg.by_date.items() if d >= recent_start)
        previous = sum(q for d, q in agg.by_date.items() if previous_start <= d < recent_start)
        trend_pct = round((recent - previous) / max(previous, 1) * 100, 1)

        buckets: dict[date, int] = defaultdict(int)
        for d, q in agg.by_date.items():
            buckets[_trend_bucket_key(d, granularity)] += q

        days_sold = len(agg.by_date)
        items.append(
            FlavorItem(
                name=agg.display_name,
                total_qty=agg.total,
                share_pct=round(agg.total / grand_total * 100, 1) if grand_total else 0.0,
                rank=rank,
                trend_pct=trend_pct,
                classification=_classify(agg.total, trend_pct, top_25, bottom_25),
                days_sold=days_sold,
                active_days=active_days,
                consistency_pct=round(days_sold / active_days * 100, 1) if active_days else 0.0,
                trend=[
                    FlavorTrendPoint(bucket=_trend_bucket_label(b, granularity), qty=q)
                    for b, q in sorted(buckets.items())
                ],
                by_outlet=[
                    FlavorOutletQty(
                        outlet_id=str(oid),
                        outlet_name=outlet_names.get(oid, "Unknown"),
                        qty=qty,
                        share_pct=round(qty / outlet_totals[oid] * 100, 1) if outlet_totals[oid] else 0.0,
                    )
                    for oid, qty in sorted(agg.by_outlet.items(), key=lambda kv: kv[1], reverse=True)
                ],
            )
        )
    return items


async def get_flavor_analysis(
    db: AsyncSession,
    *,
    outlet_id: UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    granularity: Granularity = "weekly",
) -> FlavorAnalysisResponse:
    rows = await _fetch_modifier_rows(db, from_date, to_date, outlet_id)
    flavors_agg, addons_agg = _aggregate_modifiers(rows)

    all_dates = {d for agg in (*flavors_agg.values(), *addons_agg.values()) for d in agg.by_date}
    active_days = len(all_dates)
    today = datetime.now(SGT).date()
    range_end = to_date or (max(all_dates) if all_dates else today)

    outlet_rows = (await db.execute(select(Outlet.id, Outlet.name))).all()
    outlet_names = {r.id: r.name for r in outlet_rows}

    build = lambda aggs: _build_items(  # noqa: E731
        aggs,
        range_end=range_end,
        active_days=active_days,
        outlet_names=outlet_names,
        granularity=granularity,
    )
    flavors = build(flavors_agg)
    addons = build(addons_agg)

    # Pareto over flavours only, on a single percentage axis.
    flavor_total = sum(f.total_qty for f in flavors)
    pareto: list[ParetoPoint] = []
    cumulative = 0
    for f in flavors:
        cumulative += f.total_qty
        pareto.append(
            ParetoPoint(
                name=f.name,
                quantity=f.total_qty,
                share_pct=round(f.total_qty / flavor_total * 100, 1) if flavor_total else 0.0,
                cumulative_pct=round(cumulative / flavor_total * 100, 1) if flavor_total else 0.0,
            )
        )

    day_of_week = [
        FlavorDowRow(name=agg.display_name, quantities=list(agg.by_dow))
        for agg in sorted(flavors_agg.values(), key=lambda a: a.total, reverse=True)[:10]
    ]

    date_from = from_date or (min(all_dates) if all_dates else today)
    return FlavorAnalysisResponse(
        date_from=date_from.isoformat(),
        date_to=range_end.isoformat(),
        active_days=active_days,
        flavors=flavors,
        addons=addons,
        pareto=pareto,
        day_of_week=day_of_week,
    )


# ---------------------------------------------------------------------------
# Monthly ranking trends
# ---------------------------------------------------------------------------


def build_rankings(month_strs: list[str], qty_by_flavor_month: dict[str, dict[str, int]]) -> list[FlavorRankingItem]:
    """Rank flavours within each month and classify their trajectory (Gusta rules)."""
    month_ranks: dict[str, dict[str, int | None]] = {}
    for month in month_strs:
        month_data = sorted(
            ((flavor, qty_map.get(month, 0)) for flavor, qty_map in qty_by_flavor_month.items()),
            key=lambda x: (-x[1], x[0]),
        )
        ranks: dict[str, int | None] = {}
        rank = 1
        for flavor, qty in month_data:
            if qty > 0:
                ranks[flavor] = rank
                rank += 1
            else:
                ranks[flavor] = None
        month_ranks[month] = ranks

    total_flavors = len(qty_by_flavor_month)
    items: list[FlavorRankingItem] = []
    for flavor, qty_map in qty_by_flavor_month.items():
        monthly_rank = [month_ranks[m].get(flavor) for m in month_strs]
        monthly_qty = [qty_map.get(m, 0) for m in month_strs]
        valid = [r for r in monthly_rank if r is not None]
        avg_rank = sum(valid) / len(valid) if valid else float(total_flavors)

        first, last = (monthly_rank[0], monthly_rank[-1]) if monthly_rank else (None, None)
        rank_change = (first - last) if first is not None and last is not None else None

        # Momentum outranks a poor average: a flavour that just climbed several
        # ranks reads "rising", not "at risk" (deliberate change vs Gusta).
        if avg_rank <= 0.3 * total_flavors:
            classification = "consistent_top"
        elif rank_change is not None and rank_change >= 2:
            classification = "rising"
        elif rank_change is not None and rank_change <= -2:
            classification = "dropping"
        elif avg_rank >= 0.7 * total_flavors:
            classification = "consistent_bottom"
        else:
            classification = "stable"

        items.append(
            FlavorRankingItem(
                name=flavor,
                monthly_rank=monthly_rank,
                monthly_qty=monthly_qty,
                rank_change=rank_change,
                avg_rank=round(avg_rank, 2),
                classification=classification,
            )
        )
    items.sort(key=lambda x: x.avg_rank)
    return items


async def get_flavor_rankings(
    db: AsyncSession,
    *,
    outlet_id: UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> FlavorRankingsResponse:
    """Monthly flavour rankings over the range (all recorded history by default)."""
    rows = await _fetch_modifier_rows(db, from_date, to_date, outlet_id)

    months: set[date] = set()
    qty_by_flavor_month: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    display: dict[str, str] = {}
    for modifiers, quantity, created_at, _outlet in rows:
        day = _to_sgt(created_at).date()
        month = day.replace(day=1)
        for mod in modifiers or []:
            name, is_flavor = parse_modifier_name(mod.get("modifier_name", ""))
            if not name or not is_flavor:
                continue
            months.add(month)
            display.setdefault(name.casefold(), name)
            qty_by_flavor_month[name.casefold()][month.strftime("%Y-%m")] += int(quantity or 1)

    month_strs = [m.strftime("%Y-%m") for m in sorted(months)]
    named = {display[key]: qty_map for key, qty_map in qty_by_flavor_month.items()}
    return FlavorRankingsResponse(months=month_strs, flavors=build_rankings(month_strs, named))
