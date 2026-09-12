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
        ("sheets", "image_status", "TEXT DEFAULT 'pending'"),
    ]
    for table, column, coltype in additions:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
            if table == "sheets" and column == "image_status":
                # Backfill: rows from before this column existed already have
                # their image rendered (or don't) - don't mark them 'pending'
                # and have the UI wait forever for a background render that
                # will never run for them.
                conn.execute("UPDATE sheets SET image_status = 'done' WHERE image_filename IS NOT NULL")
                conn.execute("UPDATE sheets SET image_status = 'failed' WHERE image_filename IS NULL")

    # New tables added after a database already existed: CREATE TABLE IF NOT
    # EXISTS (unlike ALTER TABLE ADD COLUMN above) is always safe to re-run.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS diary_days (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            weather_conditions TEXT,
            weather_temp TEXT,
            personnel_notes TEXT,
            plant_equipment TEXT,
            deliveries TEXT,
            visitors TEXT,
            instructions TEXT,
            safety_notes TEXT,
            general_notes TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(project_id, date),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_diary_days_project_date ON diary_days(project_id, date)")
    conn.commit()


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]
