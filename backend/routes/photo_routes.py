import os
import uuid
from flask import Blueprint, request, jsonify, send_from_directory
from db import get_db
from auth import project_access_required, current_user

bp = Blueprint("photos", __name__, url_prefix="/api/projects")

UPLOAD_PHOTOS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "photos")
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


@bp.post("/<int:project_id>/photos")
@project_access_required
def upload_photo(project_id):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": "Unsupported image type"}), 400
    os.makedirs(UPLOAD_PHOTOS, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    f.save(os.path.join(UPLOAD_PHOTOS, stored))

    activity_id = request.form.get("activity_id") or None
    zone_id = request.form.get("zone_id") or None
    caption = request.form.get("caption") or None

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO photos (project_id, activity_id, zone_id, file_path, caption) VALUES (?, ?, ?, ?, ?)",
        (project_id, activity_id, zone_id, stored, caption),
    )
    if activity_id:
        activity = conn.execute("SELECT name FROM activities WHERE id = ?", (activity_id,)).fetchone()
        user = current_user()
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author)
               VALUES (?, 'progress', ?, ?, ?)""",
            (project_id, activity_id, f"Photo added to '{activity['name'] if activity else 'activity'}'" + (f": {caption}" if caption else "."),
             user["name"] if user else "site manager"),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM photos WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@bp.get("/photo-files/<path:filename>")
def get_photo_file(filename):
    return send_from_directory(UPLOAD_PHOTOS, filename)


@bp.get("/<int:project_id>/photos")
@project_access_required
def list_photos(project_id):
    conn = get_db()
    rows = conn.execute("SELECT * FROM photos WHERE project_id = ? ORDER BY created_at DESC", (project_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
