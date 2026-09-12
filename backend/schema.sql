-- Site Manager OS - SQLite schema

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    owner_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'manager',
    PRIMARY KEY (project_id, user_id)
);

-- An uploaded PDF drawing set (a single PDF file, possibly many pages/sheets)
CREATE TABLE IF NOT EXISTS drawing_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    discipline TEXT DEFAULT 'other', -- architectural | structural | civil | hydraulic | electrical | mechanical | landscape | fire | geotechnical | survey | other
    discipline_confidence TEXT DEFAULT 'low', -- low | medium | confirmed (same "AI guess - review" pattern as sheets)
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Each page of a drawing set becomes a "sheet"
CREATE TABLE IF NOT EXISTS sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    drawing_set_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    sheet_number TEXT,
    sheet_title TEXT,
    sheet_type TEXT DEFAULT 'plan', -- plan | elevation | section | detail | other
    ai_confidence TEXT DEFAULT 'low', -- low | medium | high | confirmed
    image_filename TEXT, -- rasterized PNG of this page, rendered server-side for the Plans viewer
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (drawing_set_id) REFERENCES drawing_sets(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Clickable work-face zones drawn on a sheet (normalized 0-1 rectangle coords)
CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    sheet_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sheet_id) REFERENCES sheets(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Programme activities (tasks)
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    trade_id INTEGER,
    predecessor_activity_id INTEGER,
    planned_start TEXT,
    planned_end TEXT,
    forecast_start TEXT,
    forecast_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    blocked_manual INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (trade_id) REFERENCES trades(id),
    FOREIGN KEY (predecessor_activity_id) REFERENCES activities(id)
);

-- Many-to-many: an activity can touch multiple zones, a zone can have multiple activities
CREATE TABLE IF NOT EXISTS activity_zones (
    activity_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    PRIMARY KEY (activity_id, zone_id),
    FOREIGN KEY (activity_id) REFERENCES activities(id),
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

-- Expected / actual attendance dates for a trade against an activity
CREATE TABLE IF NOT EXISTS attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    trade_id INTEGER NOT NULL,
    activity_id INTEGER,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_contacted', -- not_contacted | tentative | confirmed | on_site | complete
    checklist_json TEXT DEFAULT '{}',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (trade_id) REFERENCES trades(id),
    FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    activity_id INTEGER,
    zone_id INTEGER,
    file_path TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS diary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    entry_type TEXT NOT NULL DEFAULT 'note', -- progress | delay | decision | attendance | system | note
    activity_id INTEGER,
    zone_id INTEGER,
    text TEXT NOT NULL,
    author TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI proposals that require human review before being applied
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- forecast_shift | missing_prereq | readiness_flag | sheet_recognition
    activity_id INTEGER,
    sheet_id INTEGER,
    message TEXT NOT NULL,
    proposed_data_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | dismissed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheets_project ON sheets(project_id);
CREATE INDEX IF NOT EXISTS idx_zones_sheet ON zones(sheet_id);
CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id);
CREATE INDEX IF NOT EXISTS idx_attendances_trade ON attendances(trade_id);
CREATE INDEX IF NOT EXISTS idx_diary_project ON diary_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_project ON ai_suggestions(project_id, status);
