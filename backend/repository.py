import os
from pathlib import Path
from threading import Lock

import psycopg
from django.core.cache import cache
from psycopg.rows import dict_row

from logic.measurements import combine_inventory, combine_measurements, monthly_measurements
from logic.summary import date_window

SQL = Path(__file__).resolve().parents[1] / "database" / "dashboard"
measurement_lock = Lock()
# Requests can select a report, but cannot supply SQL or arbitrary file paths.
QUERIES = {name: (SQL / f"{name}.sql").read_text() for name in (
    "range", "overview", "trend", "failures", "coverage", "metrics", "inventory",
    "investigation", "payload", "readiness"
)}


def query(name, params=None):
    """Run a fixed SQL file in a read-only transaction, with bound date values."""
    url = os.environ.get("DATABASE_URL", "postgresql://root@127.0.0.1:26257/gamearena_analytics?sslmode=disable")
    with psycopg.connect(url, connect_timeout=5, row_factory=dict_row) as connection:
        connection.read_only = True
        connection.execute("SET TIME ZONE 'UTC'")
        connection.execute("SET statement_timeout = '180s'")
        return connection.execute(QUERIES[name], params).fetchall()


def read(name, window, refresh=False, timeout=300):
    """Refresh replaces the cached summary, so changing dates cannot bring back older results."""
    key = f"{name}:{window['start'].isoformat()}:{window['end'].isoformat()}"
    rows = None if refresh else cache.get(key)
    if rows is None:
        rows = query(name, window)
        cache.set(key, rows, timeout=timeout)
    return rows


def available_range(refresh=False):
    """Reuse the known data bounds while serving reports for different dates."""
    dates = None if refresh else cache.get("available_range")
    if dates is None:
        dates = query("range")[0]
        cache.set("available_range", dates, timeout=300)
    return dates


def performance_report(window, refresh=False):
    """Cache daily aggregates for an hour instead of rescanning samples on every date click."""
    dates = available_range()
    if not dates["start"] or not dates["end"]:
        return {"metrics": [], "inventory": [], "monthly": []}
    # An empty date range should not trigger a full measurement calculation.
    if window["end"].date() <= dates["start"] or window["start"].date() > dates["end"]:
        return {"metrics": [], "inventory": [], "monthly": []}
    whole_period = date_window(str(dates["start"]), str(dates["end"]))
    # Rapid date clicks wait for one calculation instead of launching duplicate sample scans.
    with measurement_lock:
        daily_metrics = read("metrics", whole_period, refresh, timeout=3600)
        daily_fields = read("inventory", whole_period, refresh, timeout=3600)
    return {
        "metrics": combine_measurements(daily_metrics, window),
        "inventory": combine_inventory(daily_fields, window),
        "monthly": monthly_measurements(daily_metrics, window),
    }
