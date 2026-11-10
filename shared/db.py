"""The only code that talks to the database. Loads every named query from api/sql and
pipeline/sql, and runs them read-only; only the pipeline asks to write."""
import atexit
import os
import threading
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# A local CockroachDB on its default port, used when DATABASE_URL is not set.
DEFAULT_URL = "postgresql://root@127.0.0.1:26257/gamearena_analytics?sslmode=disable"

# Every "-- report: name" section in api/sql/*.sql (what the pages read) and pipeline/sql/*.sql
# (what the job reads and writes) becomes one named query.
ROOT = Path(__file__).resolve().parents[1]
SQL_FILES = sorted([*(ROOT / "api" / "sql").glob("*.sql"), *(ROOT / "pipeline" / "sql").glob("*.sql")])
QUERIES = {}
for sql_file in SQL_FILES:
    # Text before a file's first marker is its header and is dropped. In each section, the rest of
    # the marker line is the name and everything after it is the query.
    for section in sql_file.read_text(encoding="utf-8").split("-- report: ")[1:]:
        name, _, text = section.partition("\n")
        # Names must be unique across all files, or one query would quietly replace another.
        if name in QUERIES:
            raise ValueError(f"Duplicate SQL report: {name}")
        QUERIES[name] = text.strip()
# A report can include the conditions every impact report shares by writing {selected}
# (defined once in api/sql/impact.sql), so the filters cannot drift apart between reports.
QUERIES = {name: text.replace("{selected}", QUERIES["selected"]) for name, text in QUERIES.items()}


def database_url():
    # DATABASE_URL points the app and the pipeline at another database.
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


def connect(write=False):
    # Read-only and in UTC, so a report cannot change data or move a day boundary.
    # Only the pipeline asks for write=True, and it commits each batch itself.
    connection = psycopg.connect(database_url(), connect_timeout=5, row_factory=dict_row, autocommit=write)
    connection.read_only = not write
    connection.execute("SET TIME ZONE 'UTC'")
    # A page request gives up after 3 minutes. The pipeline's queries get a generous 30 minutes,
    # but never none, so a stuck query can't hold the run lock forever.
    connection.execute("SET statement_timeout = '1800s'" if write else "SET statement_timeout = '180s'")
    return connection


# The pages share a few open read-only connections instead of opening a new one for every
# query, so a busy page never floods the database with connections. Opened on first use, so
# tests and the pipeline never start it.
_pool = None
_pool_lock = threading.Lock()


def _prepare(connection):
    # Each pooled connection is set up once: UTC days, a 3-minute limit per query, read-only.
    connection.autocommit = True
    connection.execute("SET TIME ZONE 'UTC'")
    connection.execute("SET statement_timeout = '180s'")
    connection.autocommit = False
    connection.read_only = True


def pool():
    global _pool
    with _pool_lock:
        if _pool is None:
            # At most 5 connections per server process; a request waits up to 10 seconds for a
            # free one, and at most 20 wait at once, so a flood is turned away instead of queuing. A connection is checked before use, so a restarted database is no problem.
            _pool = ConnectionPool(database_url(), min_size=1, max_size=5, timeout=10, max_waiting=20,
                                   kwargs={"row_factory": dict_row, "connect_timeout": 5},
                                   configure=_prepare, check=ConnectionPool.check_connection, open=True)
            # Closed when the process ends, so its background threads stop cleanly.
            atexit.register(_pool.close)
    return _pool


def query(name, params=None):
    # One named query on a pooled read-only connection.
    with pool().connection() as connection:
        return connection.execute(QUERIES[name], params).fetchall()


def batch(requests):
    # {key: (report name, params)} in one transaction, so related queries see the same snapshot.
    with pool().connection() as connection:
        return {key: connection.execute(QUERIES[name], params).fetchall()
                for key, (name, params) in requests.items()}

