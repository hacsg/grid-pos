"""Regression tests for the Qashier-backed month-end forecast."""

from __future__ import annotations

import csv
import re
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.forecast import _event_kind, _forecast_outlet_remaining

BACKEND_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = BACKEND_ROOT / "data" / "qashier_daily_sales.csv"
MIGRATION_PATH = BACKEND_ROOT / "migrations" / "0028_import_qashier_daily_sales.sql"
BEDOK_MIGRATION_PATH = BACKEND_ROOT / "migrations" / "0029_hide_bedok_until_grid_migration.sql"

OUTLET_CUTOFFS = {
    "c3e5a387-4a1a-4ee9-9e80-3a335d816636": date(2026, 7, 9),
    "9d936497-511c-46a3-b262-806c37485a40": date(2026, 8, 17),
    "b29fc9ca-ade6-4869-bb36-0db319092343": date(2026, 9, 10),
}
TAMPINES_ID = "b29fc9ca-ade6-4869-bb36-0db319092343"
TAMPINES_SEPT_MIGRATION = BACKEND_ROOT / "migrations" / "0030_import_tampines_early_sept_qashier.sql"
TAMPINES_RECON_MIGRATION = BACKEND_ROOT / "migrations" / "0031_reconcile_tampines_september_total.sql"


def _history(start: date, weeks: int, weekday: float, weekend: float) -> dict[date, float]:
    return {
        start + timedelta(days=i): weekend if (start + timedelta(days=i)).weekday() >= 5 else weekday
        for i in range(weeks * 7)
    }


def test_qashier_source_data_is_complete_unique_and_pre_cutover() -> None:
    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    assert len(rows) == 1184
    assert sum(Decimal(row["net_sales"]) for row in rows) == Decimal("962502.18")
    assert sum(int(row["transaction_count"]) for row in rows) == 66123
    assert all("Bedok" not in row["outlet_name"] for row in rows)
    assert all(Decimal(row["net_sales"]) >= 0 for row in rows)
    assert all(int(row["transaction_count"]) >= 0 for row in rows)

    keys = {(row["outlet_id"], row["sales_date"], row["source"]) for row in rows}
    assert len(keys) == len(rows)
    assert set(row["outlet_id"] for row in rows) == set(OUTLET_CUTOFFS)
    assert all(
        date.fromisoformat(row["sales_date"]) < OUTLET_CUTOFFS[row["outlet_id"]]
        for row in rows
    )
    # Tampines stayed on Qashier through 2026-09-09 (Grid cutover 09-10). No
    # Qashier email existed for 09-04, so its value is a reconciliation row that
    # trues the pre-cutover total up to the owner's authoritative S$8,604.30.
    tampines_sept = {
        row["sales_date"]
        for row in rows
        if row["outlet_id"] == TAMPINES_ID and row["sales_date"].startswith("2026-09")
    }
    assert tampines_sept == {f"2026-09-0{d}" for d in (1, 2, 3, 4, 5, 6, 7, 8, 9)}
    tampines_sept_total = sum(
        Decimal(row["net_sales"])
        for row in rows
        if row["outlet_id"] == TAMPINES_ID and row["sales_date"].startswith("2026-09")
    )
    assert tampines_sept_total == Decimal("8604.30")
    # Explicit closure days are retained as zero-valued observations.
    assert sum(Decimal(row["net_sales"]) == 0 for row in rows) == 9


def test_sql_migration_embeds_every_source_row_and_integrity_guards() -> None:
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    tuples = re.findall(
        r"\('[0-9a-f-]{36}', '([0-9a-f-]{36})', '(\d{4}-\d{2}-\d{2})', "
        r"(\d+\.\d{2}), (\d+), 'qashier', '([0-9a-f]{64})'\)",
        sql,
    )
    assert len(tuples) == 1178
    assert len({(outlet_id, sales_date) for outlet_id, sales_date, *_ in tuples}) == 1178
    assert sum(Decimal(net_sales) for _, _, net_sales, _, _ in tuples) == Decimal("956371.38")
    assert sum(int(txns) for _, _, _, txns, _ in tuples) == 65694
    assert "row_count != 1178" in sql
    assert "net_sum != 956371.38" in sql
    assert "txn_sum != 65694" in sql
    assert "Found % Bedok rows" in sql
    assert "CHECK (net_sales >= 0)" in sql


def test_tampines_early_sept_migration_imports_five_days_with_guards() -> None:
    sql = TAMPINES_SEPT_MIGRATION.read_text(encoding="utf-8")
    tuples = re.findall(
        r"\('[0-9a-f-]{36}', '([0-9a-f-]{36})', '(\d{4}-\d{2}-\d{2})', "
        r"(\d+\.\d{2}), (\d+), 'qashier', '([0-9a-f]{64})'\)",
        sql,
    )
    assert len(tuples) == 5
    assert all(oid == TAMPINES_ID for oid, *_ in tuples)
    assert {d for _, d, *_ in tuples} == {f"2026-09-0{n}" for n in (5, 6, 7, 8, 9)}
    assert sum(Decimal(net) for _, _, net, _, _ in tuples) == Decimal("4856.50")
    assert sum(int(t) for _, _, _, t, _ in tuples) == 338
    assert "ON CONFLICT (outlet_id, sales_date, source) DO NOTHING" in sql
    assert "tamp_sept_rows != 5" in sql
    assert "tamp_sept_net != 4856.50" in sql
    assert "tamp_sept_txns != 338" in sql


def test_tampines_reconciliation_migration_trues_september_total() -> None:
    sql = TAMPINES_RECON_MIGRATION.read_text(encoding="utf-8")
    tuples = re.findall(
        r"\('[0-9a-f-]{36}', '([0-9a-f-]{36})', '(\d{4}-\d{2}-\d{2})', (\d+\.\d{2}), (\d+),",
        sql,
    )
    assert len(tuples) == 1
    oid, d, net, _ = tuples[0]
    assert oid == TAMPINES_ID
    assert d == "2026-09-04"
    assert Decimal(net) == Decimal("1274.30")
    assert "ON CONFLICT (outlet_id, sales_date, source) DO NOTHING" in sql
    assert "sept_net != 8604.30" in sql


def test_bedok_hide_migration_targets_only_the_known_bedok_id() -> None:
    sql = BEDOK_MIGRATION_PATH.read_text(encoding="utf-8")
    assert "2b029d9a-cc3c-4c29-8993-c1688a309a29" in sql
    assert "SET is_hidden = true" in sql
    assert "WHERE id = '2b029d9a-cc3c-4c29-8993-c1688a309a29'" in sql


def test_weekday_history_changes_remaining_forecast() -> None:
    current = date(2026, 9, 18)  # Friday; remaining month contains four weekend days.
    history = _history(date(2026, 6, 1), weeks=14, weekday=100.0, weekend=300.0)

    result = _forecast_outlet_remaining(history, {}, current)

    assert result.method == "historical_weekday_blend"
    assert result.remaining > 12 * 100.0


def test_completed_month_pace_is_blended_and_clamped() -> None:
    current = date(2026, 9, 15)
    history = _history(date(2026, 5, 4), weeks=16, weekday=100.0, weekend=100.0)
    completed = {date(2026, 9, day): 1000.0 for day in range(1, 15)}

    result = _forecast_outlet_remaining(history, completed, current)

    # Extreme 10x pace is clamped to 1.30 then blended at max 50% => 1.15.
    assert result.remaining == pytest.approx(15 * 100.0 * 1.15, rel=0.01)


def test_explicit_zero_is_a_sample_but_missing_dates_are_not_synthesized() -> None:
    # Eight reported Mondays, alternating a real closure (zero) and S$100.
    # The unreported dates between Mondays must not become extra zero samples.
    history = {
        date(2026, 8, 3) + timedelta(days=7 * i): (0.0 if i % 2 == 0 else 100.0)
        for i in range(8)
    }

    result = _forecast_outlet_remaining(history, {}, date(2026, 11, 29))

    assert result.sample_count == 8
    assert result.history_days == 8
    assert 0 < result.remaining < 100.0


def test_no_history_falls_back_to_completed_days_not_partial_today() -> None:
    current = date(2026, 9, 10)
    completed = {date(2026, 9, day): 100.0 for day in range(1, 10)}

    result = _forecast_outlet_remaining({}, completed, current)

    assert result.method == "run_rate_fallback"
    assert result.remaining == pytest.approx(20 * 100.0)


def test_public_holiday_and_eve_classification_uses_mom_dates() -> None:
    assert _event_kind(date(2026, 2, 16)) == "holiday_eve"
    assert _event_kind(date(2026, 2, 17)) == "public_holiday"
    assert _event_kind(date(2026, 6, 1)) == "public_holiday"  # observed Vesak Day
    assert _event_kind(date(2026, 9, 19)) is None
