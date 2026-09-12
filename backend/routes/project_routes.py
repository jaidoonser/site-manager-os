import os
import uuid
import threading
from flask import Blueprint, request, jsonify, send_from_directory, current_app
from db import get_db
from auth import login_required, project_access_required, current_user
from pdf_parse import parse_drawing_set, render_sheet_image, guess_discipline, get_page_count

bp = Blueprint("projects", __name__, url_prefix="/api/projects")

UPLOAD_DRAWINGS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "drawings")
UPLOAD_PHOTOS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "photos")


# ---------- Projects ----------

@bp.get("")
@login_required
def list_projects():
    user = current_user()
    conn = get_db()
    rows = conn.execute(
        """SELECT p.* FROM projects p WHERE p.owner_user_id = ?
           UNION
           SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = ?
           ORDER BY created_at DESC""",
        (user["id"], user["id"]),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.post("")
@login_required
def create_project():
    user = current_user()
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Project name is required"}), 400
    address = (data.get("address") or "").strip()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO projects (name, address, owner_user_id) VALUES (?, ?, ?)",
        (name, address, user["id"]),
    )
    conn.commit()
    project_id = cur.lastrowid
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@bp.get("/<int:project_id>")
@project_access_required
def get_project(project_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(dict(row))


# ---------- Drawing sets & sheets ----------

@bp.get("/<int:project_id>/drawings")
@project_access_required
def list_drawings(project_id):
    conn = get_db()
    sets = conn.execute(
        "SELECT * FROM drawing_sets WHERE project_id = ? ORDER BY uploaded_at DESC", (project_id,)
    ).fetchall()
    result = []
    for s in sets:
        sheets = conn.execute(
            "SELECT * FROM sheets WHERE drawing_set_id = ? ORDER BY page_number", (s["id"],)
        ).fetchall()
        d = dict(s)
        d["sheets"] = [dict(x) for x in sheets]
        result.append(d)
    conn.close()
    return jsonify(result)


@bp.post("/<int:project_id>/drawings")
@project_access_required
def upload_drawing(project_id):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF drawing sets are supported"}), 400

    os.makedirs(UPLOAD_DRAWINGS, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.pdf"
    path = os.path.join(UPLOAD_DRAWINGS, stored_name)
    f.save(path)

    try:
        pages = parse_drawing_set(path)
    except Exception:
        # Whatever went wrong, still index every actual page of the PDF -
        # a parsing hiccup should never silently drop pages from the set.
        page_count = get_page_count(path) or 1
        pages = [{"page_number": i + 1, "sheet_number": f"SHEET-{i + 1}", "sheet_title": f.filename,
                   "sheet_type": "plan", "ai_confidence": "low", "_text": ""} for i in range(page_count)]

    # Discipline: use what the user picked in the upload dialog if given,
    # otherwise guess it (same reviewable-AI pattern as sheet recognition).
    discipline = (request.form.get("discipline") or "").strip().lower()
    if discipline:
        discipline_confidence = "confirmed"
    else:
        sample_text = " ".join((p.get("_text") or "") for p in pages[:3])
        sheet_numbers = [p.get("sheet_number") for p in pages]
        discipline, discipline_confidence = guess_discipline(f.filename, sample_text, sheet_numbers)

    conn = get_db()
    cur = conn.execute(
        """INSERT INTO drawing_sets (project_id, original_filename, stored_filename, page_count, discipline, discipline_confidence)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (project_id, f.filename, stored_name, len(pages), discipline, discipline_confidence),
    )
    drawing_set_id = cur.lastrowid
    sheet_ids = []
    # Sheet rows go in immediately with image_status='pending' - the actual
    # rasterization (render_sheet_image, one poppler subprocess per page)
    # happens afterwards in a background thread. A large real-world drawing
    # set can take well over a minute to rasterize page-by-page; doing that
    # synchronously inside this request risks the platform's request
    # timeout killing the connection before the upload ever finishes, which
    # looks to the user like the upload silently did nothing.
    for p in pages:
        c2 = conn.execute(
            """INSERT INTO sheets (project_id, drawing_set_id, page_number, sheet_number, sheet_title, sheet_type, ai_confidence, image_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (project_id, drawing_set_id, p["page_number"], p["sheet_number"], p["sheet_title"], p["sheet_type"], p["ai_confidence"]),
        )
        sheet_ids.append(c2.lastrowid)
    conn.execute(
        """INSERT INTO diary_entries (project_id, entry_type, text, author) VALUES (?, 'system', ?, 'AI assistant')""",
        (project_id, f"Uploaded drawing set '{f.filename}' – indexed {len(pages)} sheet(s) as {discipline}, please review AI-suggested sheet names."),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM drawing_sets WHERE id = ?", (drawing_set_id,)).fetchone()
    sheets = conn.execute("SELECT * FROM sheets WHERE drawing_set_id = ? ORDER BY page_number", (drawing_set_id,)).fetchall()
    conn.close()
    result = dict(row)
    result["sheets"] = [dict(s) for s in sheets]

    page_numbers_by_sheet_id = {sid: p["page_number"] for sid, p in zip(sheet_ids, pages)}
    threading.Thread(
        target=_render_sheets_in_background,
        args=(path, stored_name, page_numbers_by_sheet_id),
        daemon=True,
    ).start()

    return jsonify(result), 201


def _render_sheets_in_background(pdf_path, stored_name, page_numbers_by_sheet_id):
    """Rasterize each sheet's page to a PNG one at a time, updating its row
    as soon as it's done. Runs on its own thread with its own DB connection
    (sqlite3 connections aren't safe to share across threads) so the upload
    request itself never has to wait on this."""
    conn = get_db()
    for sheet_id, page_number in page_numbers_by_sheet_id.items():
        try:
            out_prefix = os.path.join(UPLOAD_DRAWINGS, f"{os.path.splitext(stored_name)[0]}_p{page_number}")
            image_path = render_sheet_image(pdf_path, page_number, out_prefix)
            image_filename = os.path.basename(image_path)
            conn.execute(
                "UPDATE sheets SET image_filename = ?, image_status = 'done' WHERE id = ?",
                (image_filename, sheet_id),
            )
        except Exception:
            conn.execute("UPDATE sheets SET image_status = 'failed' WHERE id = ?", (sheet_id,))
        conn.commit()  # commit after every page so the frontend can pick up progress incrementally
    conn.close()


@bp.get("/<int:project_id>/sheets/<int:sheet_id>")
@project_access_required
def get_sheet(project_id, sheet_id):
    conn = get_db()
    sheet = conn.execute("SELECT * FROM sheets WHERE id = ? AND project_id = ?", (sheet_id, project_id)).fetchone()
    if not sheet:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    drawing_set = conn.execute("SELECT * FROM drawing_sets WHERE id = ?", (sheet["drawing_set_id"],)).fetchone()
    conn.close()
    result = dict(sheet)
    result["drawing_set"] = dict(drawing_set)
    return jsonify(result)


@bp.put("/<int:project_id>/sheets/<int:sheet_id>")
@project_access_required
def update_sheet(project_id, sheet_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    sheet = conn.execute("SELECT * FROM sheets WHERE id = ? AND project_id = ?", (sheet_id, project_id)).fetchone()
    if not sheet:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    fields = {}
    for f in ("sheet_number", "sheet_title", "sheet_type"):
        if f in data:
            fields[f] = data[f]
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values())
        # Confirming/editing a sheet clears the "needs review" AI flag
        set_clause += ", ai_confidence = 'confirmed'"
        conn.execute(f"UPDATE sheets SET {set_clause} WHERE id = ?", values + [sheet_id])
        conn.commit()
    row = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))


@bp.put("/<int:project_id>/drawing-sets/<int:drawing_set_id>")
@project_access_required
def update_drawing_set(project_id, drawing_set_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    ds = conn.execute(
        "SELECT * FROM drawing_sets WHERE id = ? AND project_id = ?", (drawing_set_id, project_id)
    ).fetchone()
    if not ds:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    fields = {}
    if "discipline" in data:
        fields["discipline"] = (data["discipline"] or "other").strip().lower()
        fields["discipline_confidence"] = "confirmed"
    if "original_filename" in data and data["original_filename"]:
        fields["original_filename"] = data["original_filename"].strip()
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE drawing_sets SET {set_clause} WHERE id = ?", list(fields.values()) + [drawing_set_id])
        conn.commit()
    row = conn.execute("SELECT * FROM drawing_sets WHERE id = ?", (drawing_set_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))


@bp.get("/drawing-files/<path:filename>")
def get_drawing_file(filename):
    return send_from_directory(UPLOAD_DRAWINGS, filename)


# ---------- Zones (work faces) ----------

def _zone_status(conn, zone_id):
    from status_engine import compute_status
    from datetime import date
    activities = conn.execute(
        """SELECT a.* FROM activities a
           JOIN activity_zones az ON az.activity_id = a.id
           WHERE az.zone_id = ?""",
        (zone_id,),
    ).fetchall()
    if not activities:
        return "unassigned", "#c7cdd9"
    priority = {"blocked": 0, "active": 1, "ready": 2, "not_ready": 3, "complete": 4}
    best = None
    for a in activities:
        a = dict(a)
        pred = None
        if a.get("predecessor_activity_id"):
            pred = conn.execute("SELECT * FROM activities WHERE id = ?", (a["predecessor_activity_id"],)).fetchone()
            pred = dict(pred) if pred else None
        status = compute_status(a, pred)
        if best is None or priority[status] < priority[best]:
            best = status
    from status_engine import STATUS_COLORS, STATUS_LABELS
    return best, STATUS_COLORS[best]


@bp.get("/<int:project_id>/sheets/<int:sheet_id>/zones")
@project_access_required
def list_zones(project_id, sheet_id):
    conn = get_db()
    zones = conn.execute("SELECT * FROM zones WHERE sheet_id = ? AND project_id = ?", (sheet_id, project_id)).fetchall()
    result = []
    for z in zones:
        z = dict(z)
        status, color = _zone_status(conn, z["id"])
        z["status"] = status
        z["status_color"] = color
        activities = conn.execute(
            """SELECT a.id, a.name FROM activities a JOIN activity_zones az ON az.activity_id = a.id
               WHERE az.zone_id = ?""",
            (z["id"],),
        ).fetchall()
        z["activities"] = [dict(a) for a in activities]
        result.append(z)
    conn.close()
    return jsonify(result)


@bp.post("/<int:project_id>/sheets/<int:sheet_id>/zones")
@project_access_required
def create_zone(project_id, sheet_id):
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Zone name is required"}), 400
    for f in ("x", "y", "w", "h"):
        if f not in data:
            return jsonify({"error": f"Missing {f}"}), 400
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO zones (project_id, sheet_id, name, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (project_id, sheet_id, name, data["x"], data["y"], data["w"], data["h"]),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM zones WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    result = dict(row)
    result["status"] = "unassigned"
    result["status_color"] = "#c7cdd9"
    result["activities"] = []
    return jsonify(result), 201


@bp.put("/<int:project_id>/zones/<int:zone_id>")
@project_access_required
def update_zone(project_id, zone_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    zone = conn.execute("SELECT * FROM zones WHERE id = ? AND project_id = ?", (zone_id, project_id)).fetchone()
    if not zone:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    fields = {k: data[k] for k in ("name", "x", "y", "w", "h") if k in data}
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE zones SET {set_clause} WHERE id = ?", list(fields.values()) + [zone_id])
        conn.commit()
    row = conn.execute("SELECT * FROM zones WHERE id = ?", (zone_id,)).fetchone()
    status, color = _zone_status(conn, zone_id)
    conn.close()
    result = dict(row)
    result["status"] = status
    result["status_color"] = color
    return jsonify(result)


@bp.delete("/<int:project_id>/zones/<int:zone_id>")
@project_access_required
def delete_zone(project_id, zone_id):
    conn = get_db()
    conn.execute("DELETE FROM activity_zones WHERE zone_id = ?", (zone_id,))
    conn.execute("DELETE FROM zones WHERE id = ? AND project_id = ?", (zone_id, project_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})
