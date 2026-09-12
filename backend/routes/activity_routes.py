import os
import uuid
from flask import Blueprint, request, jsonify
from db import get_db
from auth import project_access_required, current_user
from status_engine import enrich_activity, generate_forecast_shift_suggestions, generate_missing_prereq_suggestions
from xlsx_parse import parse_programme

bp = Blueprint("activities", __name__, url_prefix="/api/projects")

UPLOAD_PROGRAMMES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")


def _get_predecessor(conn, activity):
    if not activity.get("predecessor_activity_id"):
        return None
    row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity["predecessor_activity_id"],)).fetchone()
    return dict(row) if row else None


def _hydrate(conn, activity_row):
    a = dict(activity_row)
    pred = _get_predecessor(conn, a)
    a = enrich_activity(a, pred)
    trade = None
    if a.get("trade_id"):
        t = conn.execute("SELECT id, name FROM trades WHERE id = ?", (a["trade_id"],)).fetchone()
        trade = dict(t) if t else None
    a["trade"] = trade
    zones = conn.execute(
        """SELECT z.id, z.name, z.sheet_id FROM zones z
           JOIN activity_zones az ON az.zone_id = z.id WHERE az.activity_id = ?""",
        (a["id"],),
    ).fetchall()
    a["zones"] = [dict(z) for z in zones]
    if pred:
        a["predecessor_name"] = pred["name"]
    return a


@bp.get("/<int:project_id>/activities")
@project_access_required
def list_activities(project_id):
    conn = get_db()
    rows = conn.execute("SELECT * FROM activities WHERE project_id = ? ORDER BY forecast_start, planned_start", (project_id,)).fetchall()
    result = [_hydrate(conn, r) for r in rows]
    conn.close()
    return jsonify(result)


@bp.post("/<int:project_id>/activities")
@project_access_required
def create_activity(project_id):
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Activity name is required"}), 400
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO activities (project_id, name, trade_id, predecessor_activity_id, planned_start,
           planned_end, forecast_start, forecast_end, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (project_id, name, data.get("trade_id"), data.get("predecessor_activity_id"),
         data.get("planned_start"), data.get("planned_end"),
         data.get("forecast_start") or data.get("planned_start"),
         data.get("forecast_end") or data.get("planned_end"), data.get("notes")),
    )
    conn.commit()
    activity_id = cur.lastrowid
    for zone_id in data.get("zone_ids", []):
        conn.execute("INSERT OR IGNORE INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (activity_id, zone_id))
    conn.commit()
    row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
    result = _hydrate(conn, row)
    conn.close()
    return jsonify(result), 201


@bp.get("/<int:project_id>/activities/<int:activity_id>")
@project_access_required
def get_activity(project_id, activity_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM activities WHERE id = ? AND project_id = ?", (activity_id, project_id)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    result = _hydrate(conn, row)
    photos = conn.execute("SELECT * FROM photos WHERE activity_id = ? ORDER BY created_at DESC", (activity_id,)).fetchall()
    result["photos"] = [dict(p) for p in photos]
    diary = conn.execute("SELECT * FROM diary_entries WHERE activity_id = ? ORDER BY created_at DESC", (activity_id,)).fetchall()
    result["diary"] = [dict(d) for d in diary]
    dependents = conn.execute("SELECT id, name FROM activities WHERE predecessor_activity_id = ?", (activity_id,)).fetchall()
    result["dependents"] = [dict(d) for d in dependents]
    conn.close()
    return jsonify(result)


EDITABLE_FIELDS = [
    "name", "trade_id", "predecessor_activity_id", "planned_start", "planned_end",
    "forecast_start", "forecast_end", "actual_start", "actual_end",
    "progress_percent", "blocked_manual", "blocked_reason", "notes",
]


@bp.put("/<int:project_id>/activities/<int:activity_id>")
@project_access_required
def update_activity(project_id, activity_id):
    data = request.get_json(force=True) or {}
    delay_reason = (data.get("delay_reason") or "").strip()
    user = current_user()
    conn = get_db()
    existing = conn.execute("SELECT * FROM activities WHERE id = ? AND project_id = ?", (activity_id, project_id)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    existing = dict(existing)

    fields = {k: data[k] for k in EDITABLE_FIELDS if k in data}
    changed_dates = False
    changed_date_summaries = []
    DATE_FIELD_LABELS = {
        "forecast_start": "Forecast start", "forecast_end": "Forecast end",
        "actual_start": "Actual start", "actual_end": "Actual end",
    }
    for k, new_val in fields.items():
        old_val = existing.get(k)
        if str(old_val) != str(new_val):
            conn.execute(
                """INSERT INTO change_log (project_id, entity_type, entity_id, field, old_value, new_value, changed_by)
                   VALUES (?, 'activity', ?, ?, ?, ?, ?)""",
                (project_id, activity_id, k, str(old_val) if old_val is not None else None,
                 str(new_val) if new_val is not None else None, user["name"] if user else "system"),
            )
            if k in DATE_FIELD_LABELS:
                changed_dates = True
                changed_date_summaries.append(f"{DATE_FIELD_LABELS[k]}: {old_val or '—'} → {new_val or '—'}")

    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE activities SET {set_clause} WHERE id = ?", list(fields.values()) + [activity_id])
        conn.commit()

    # Progress / status diary trail
    if "progress_percent" in fields:
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author)
               VALUES (?, 'progress', ?, ?, ?)""",
            (project_id, activity_id, f"Progress on '{existing['name']}' updated to {fields['progress_percent']}%.",
             user["name"] if user else "system"),
        )
    if "actual_end" in fields and fields["actual_end"]:
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author)
               VALUES (?, 'progress', ?, ?, ?)""",
            (project_id, activity_id, f"'{existing['name']}' marked complete ({fields['actual_end']}).",
             user["name"] if user else "system"),
        )
    if "blocked_manual" in fields and fields["blocked_manual"]:
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author)
               VALUES (?, 'delay', ?, ?, ?)""",
            (project_id, activity_id, f"'{existing['name']}' flagged as blocked: {fields.get('blocked_reason') or 'no reason given'}.",
             user["name"] if user else "system"),
        )
    if changed_dates and delay_reason:
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author)
               VALUES (?, 'delay', ?, ?, ?)""",
            (project_id, activity_id,
             f"Dates changed on '{existing['name']}' ({'; '.join(changed_date_summaries)}). Reason: {delay_reason}",
             user["name"] if user else "system"),
        )
    conn.commit()

    if "zone_ids" in data:
        conn.execute("DELETE FROM activity_zones WHERE activity_id = ?", (activity_id,))
        for zone_id in data["zone_ids"]:
            conn.execute("INSERT OR IGNORE INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (activity_id, zone_id))
        conn.commit()

    if changed_dates:
        generate_forecast_shift_suggestions(conn, project_id, activity_id)

    row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
    result = _hydrate(conn, row)
    conn.close()
    return jsonify(result)


@bp.post("/<int:project_id>/activities/<int:activity_id>/zones")
@project_access_required
def link_zone(project_id, activity_id):
    data = request.get_json(force=True) or {}
    zone_id = data.get("zone_id")
    if not zone_id:
        return jsonify({"error": "zone_id is required"}), 400
    conn = get_db()
    conn.execute("INSERT OR IGNORE INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (activity_id, zone_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@bp.delete("/<int:project_id>/activities/<int:activity_id>/zones/<int:zone_id>")
@project_access_required
def unlink_zone(project_id, activity_id, zone_id):
    conn = get_db()
    conn.execute("DELETE FROM activity_zones WHERE activity_id = ? AND zone_id = ?", (activity_id, zone_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- Programme import ----------

@bp.post("/<int:project_id>/programme/import")
@project_access_required
def import_programme(project_id):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    is_csv = f.filename.lower().endswith(".csv")
    if not (is_csv or f.filename.lower().endswith((".xlsx", ".xlsm"))):
        return jsonify({"error": "Please upload an .xlsx or .csv programme file"}), 400

    os.makedirs(UPLOAD_PROGRAMMES, exist_ok=True)
    tmp_path = os.path.join(UPLOAD_PROGRAMMES, f"import_{uuid.uuid4().hex}{'.csv' if is_csv else '.xlsx'}")
    f.save(tmp_path)

    try:
        parsed = parse_programme(tmp_path, is_csv=is_csv)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    if not parsed:
        return jsonify({"error": "No recognisable activities found. We looked through every sheet and the first 30 rows of each for a header row with a task/activity name column plus a start, finish or duration column — check those are present somewhere in the file."}), 400

    conn = get_db()
    existing_trades = {r["name"].lower(): r["id"] for r in conn.execute("SELECT id, name FROM trades WHERE project_id = ?", (project_id,)).fetchall()}

    row_to_activity_id = {}
    for item in parsed:
        trade_id = None
        if item.get("trade"):
            key = item["trade"].lower()
            if key in existing_trades:
                trade_id = existing_trades[key]
            else:
                cur = conn.execute("INSERT INTO trades (project_id, name) VALUES (?, ?)", (project_id, item["trade"]))
                trade_id = cur.lastrowid
                existing_trades[key] = trade_id
        cur = conn.execute(
            """INSERT INTO activities (project_id, name, trade_id, planned_start, planned_end, forecast_start, forecast_end)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (project_id, item["name"], trade_id, item["planned_start"], item["planned_end"],
             item["planned_start"], item["planned_end"]),
        )
        row_to_activity_id[item["row_index"]] = cur.lastrowid

    for item in parsed:
        pred_idx = item.get("predecessor_row_index")
        if pred_idx is not None and pred_idx in row_to_activity_id:
            conn.execute(
                "UPDATE activities SET predecessor_activity_id = ? WHERE id = ?",
                (row_to_activity_id[pred_idx], row_to_activity_id[item["row_index"]]),
            )
    conn.execute(
        """INSERT INTO diary_entries (project_id, entry_type, text, author) VALUES (?, 'system', ?, 'AI assistant')""",
        (project_id, f"Imported programme '{f.filename}' – {len(parsed)} activities created."),
    )
    conn.commit()
    generate_missing_prereq_suggestions(conn, project_id)
    conn.close()
    return jsonify({"imported": len(parsed)}), 201


# ---------- AI suggestions ----------

@bp.get("/<int:project_id>/ai-suggestions")
@project_access_required
def list_suggestions(project_id):
    status = request.args.get("status", "pending")
    conn = get_db()
    if status == "all":
        rows = conn.execute("SELECT * FROM ai_suggestions WHERE project_id = ? ORDER BY created_at DESC", (project_id,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM ai_suggestions WHERE project_id = ? AND status = ? ORDER BY created_at DESC", (project_id, status)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.post("/<int:project_id>/ai-suggestions/refresh")
@project_access_required
def refresh_suggestions(project_id):
    conn = get_db()
    ids = generate_missing_prereq_suggestions(conn, project_id)
    conn.close()
    return jsonify({"created_or_updated": len(ids)})


@bp.post("/<int:project_id>/ai-suggestions/<int:suggestion_id>/accept")
@project_access_required
def accept_suggestion(project_id, suggestion_id):
    import json
    conn = get_db()
    s = conn.execute("SELECT * FROM ai_suggestions WHERE id = ? AND project_id = ?", (suggestion_id, project_id)).fetchone()
    if not s:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    s = dict(s)
    if s["type"] == "forecast_shift" and s["proposed_data_json"]:
        proposed = json.loads(s["proposed_data_json"])
        set_clause = ", ".join(f"{k} = ?" for k in proposed)
        conn.execute(f"UPDATE activities SET {set_clause} WHERE id = ?", list(proposed.values()) + [s["activity_id"]])
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author)
               VALUES (?, 'system', ?, ?, 'AI assistant (accepted)')""",
            (project_id, s["activity_id"], f"Forecast date updated after review: {s['message']}"),
        )
    conn.execute("UPDATE ai_suggestions SET status = 'accepted', resolved_at = datetime('now') WHERE id = ?", (suggestion_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@bp.post("/<int:project_id>/ai-suggestions/<int:suggestion_id>/dismiss")
@project_access_required
def dismiss_suggestion(project_id, suggestion_id):
    conn = get_db()
    conn.execute("UPDATE ai_suggestions SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ? AND project_id = ?", (suggestion_id, project_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})
