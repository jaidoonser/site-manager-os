"""SQLite connection helpers for Site Manager OS."""
import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "site_manager.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(reset=False):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = get_db()
    with open(SCHEMA_PATH, "r") as f:
        conn.executescript(f.read())
    conn.commit()
    _migrate(conn)
    conn.close()


def _migrate(conn):
    """Lightweight ALTER-TABLE migrations for columns added after a database
    already existed. schema.sql's CREATE TABLE IF NOT EXISTS only applies to
    brand-new tables, so a database created by an older version of this app
    needs these added by hand. Safe to run every startup - each check is a
    no-op once the column exists."""
    additions = [
        ("drawing_sets", "discipline", "TEXT DEFAULT 'other'"),
        ("drawing_sets", "discipline_confidence", "TEXT DEFAULT 'low'"),
    ]
    for table, column, coltype in additions:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
    conn.commit()


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]
