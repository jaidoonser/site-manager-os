from flask import Blueprint, request, jsonify
from db import get_db
from auth import project_access_required, current_user

bp = Blueprint("diary", __name__, url_prefix="/api/projects")


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
