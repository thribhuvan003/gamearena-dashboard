import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

DEFAULT_URL = "postgresql://root@127.0.0.1:26257/gamearena_analytics?sslmode=disable"

# Every "-- report: name" section in database/*.sql becomes one named query.
QUERIES = {}
for sql_file in sorted(Path(__file__).resolve().parent.glob("*.sql")):
    for section in sql_file.read_text(encoding="utf-8").split("-- report: ")[1:]:
        name, _, text = section.partition("\n")
        if name in QUERIES:
            raise ValueError(f"Duplicate SQL report: {name}")
        QUERIES[name] = text.strip()


def database_url():
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


def connect(write=False):
    # Read-only and in UTC, so a report cannot change data or move a day boundary.
    # Only the processor asks for write=True, and it commits each batch itself.
    connection = psycopg.connect(database_url(), connect_timeout=5, row_factory=dict_row, autocommit=write)
    connection.read_only = not write
    connection.execute("SET TIME ZONE 'UTC'")
    # A page request gives up after 3 minutes. The processor's queries have no limit.
    connection.execute("SET statement_timeout = '0'" if write else "SET statement_timeout = '180s'")
    return connection


def query(name, params=None):
    with connect() as connection:
        return connection.execute(QUERIES[name], params).fetchall()


def batch(requests):
    # {key: (report name, params)} in one transaction, so related queries see the same snapshot.
    with connect() as connection:
        return {key: connection.execute(QUERIES[name], params).fetchall()
                for key, (name, params) in requests.items()}

