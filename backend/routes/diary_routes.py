from flask import Blueprint, request, jsonify
from db import get_db
from auth import project_access_required, current_user

bp = Blueprint("diary", __name__, url_prefix="/api/projects")

DIARY_DAY_FIELDS = [
    "weather_conditions", "weather_temp", "personnel_notes", "plant_equipment",
    "deliveries", "visitors", "instructions", "safety_notes", "general_notes",
]


@bp.get("/<int:project_id>/diary")
@project_access_required
def list_diary(project_id):
    limit = int(request.args.get("limit", 100))
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM diary_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
        (project_id, limit),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.post("/<int:project_id>/diary")
@project_access_required
def create_diary_entry(project_id):
    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    user = current_user()
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO diary_entries (project_id, entry_type, activity_id, zone_id, text, author)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (project_id, data.get("entry_type", "note"), data.get("activity_id"), data.get("zone_id"),
         text, user["name"] if user else "Site manager"),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM diary_entries WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


# ---------- Structured daily diary record (weather, personnel, deliveries, etc.) ----------
# One row per project per calendar date - the fields a paper site diary
# traditionally carries. Distinct from the free-form diary_entries feed above.

def _empty_diary_day(project_id, date):
    return {"project_id": project_id, "date": date, **{f: "" for f in DIARY_DAY_FIELDS}}


@bp.get("/<int:project_id>/diary/day/<date>")
@project_access_required
def get_diary_day(project_id, date):
    conn = get_db()
    row = conn.execute("SELECT * FROM diary_days WHERE project_id = ? AND date = ?", (project_id, date)).fetchone()
    conn.close()
    return jsonify(dict(row) if row else _empty_diary_day(project_id, date))


@bp.put("/<int:project_id>/diary/day/<date>")
@project_access_required
def update_diary_day(project_id, date):
    data = request.get_json(force=True) or {}
    fields = {k: (data.get(k) or "") for k in DIARY_DAY_FIELDS}
    conn = get_db()
    existing = conn.execute("SELECT * FROM diary_days WHERE project_id = ? AND date = ?", (project_id, date)).fetchone()

    if existing:
        set_clause = ", ".join(f"{k} = ?" for k in fields) + ", updated_at = datetime('now')"
        conn.execute(f"UPDATE diary_days SET {set_clause} WHERE id = ?", list(fields.values()) + [existing["id"]])
    else:
        cols = ["project_id", "date"] + list(fields.keys())
        placeholders = ", ".join("?" for _ in cols)
        conn.execute(f"INSERT INTO diary_days ({', '.join(cols)}) VALUES ({placeholders})",
                     [project_id, date] + list(fields.values()))

    # Safety observations matter enough to also surface in the main
    # chronological diary feed, not just sit in the day's structured record -
    # so log it there too, but only when the note is new/changed (not on
    # every unrelated save of the same day).
    old_safety = existing["safety_notes"] if existing else None
    new_safety = fields["safety_notes"]
    if new_safety and new_safety != old_safety:
        user = current_user()
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, text, author)
               VALUES (?, 'safety', ?, ?)""",
            (project_id, f"Safety / incident note ({date}): {new_safety}", user["name"] if user else "Site manager"),
        )

    conn.commit()
    row = conn.execute("SELECT * FROM diary_days WHERE project_id = ? AND date = ?", (project_id, date)).fetchone()
    conn.close()
    return jsonify(dict(row))
