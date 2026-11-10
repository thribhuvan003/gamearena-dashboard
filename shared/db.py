"""The only code that talks to the database. Loads every named query from api/sql and
pipeline/sql, and runs them read-only; only the pipeline asks to write."""
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

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
    # A page request gives up after 3 minutes. The pipeline's queries have no limit.
    connection.execute("SET statement_timeout = '0'" if write else "SET statement_timeout = '180s'")
    return connection


def query(name, params=None):
    # One named query on its own read-only connection.
    with connect() as connection:
        return connection.execute(QUERIES[name], params).fetchall()


def batch(requests):
    # {key: (report name, params)} in one transaction, so related queries see the same snapshot.
    with connect() as connection:
        return {key: connection.execute(QUERIES[name], params).fetchall()
                for key, (name, params) in requests.items()}

