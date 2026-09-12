import json
from flask import Blueprint, request, jsonify
from db import get_db
from auth import project_access_required

bp = Blueprint("trades", __name__, url_prefix="/api/projects")


@bp.get("/<int:project_id>/trades")
@project_access_required
def list_trades(project_id):
    conn = get_db()
    trades = conn.execute("SELECT * FROM trades WHERE project_id = ? ORDER BY name", (project_id,)).fetchall()
    result = []
    for t in trades:
        t = dict(t)
        next_att = conn.execute(
            """SELECT * FROM attendances WHERE trade_id = ? AND date >= date('now')
               ORDER BY date ASC LIMIT 1""",
            (t["id"],),
        ).fetchone()
        last_att = conn.execute(
            """SELECT * FROM attendances WHERE trade_id = ? AND date < date('now')
               ORDER BY date DESC LIMIT 1""",
            (t["id"],),
        ).fetchone()
        upcoming = conn.execute(
            """SELECT date FROM attendances WHERE trade_id = ? AND date >= date('now') ORDER BY date""",
            (t["id"],),
        ).fetchall()
        t["next_attendance"] = dict(next_att) if next_att else None
        t["last_attendance"] = dict(last_att) if last_att else None
        t["upcoming_dates"] = [r["date"] for r in upcoming]
        result.append(t)
    conn.close()
    return jsonify(result)


@bp.post("/<int:project_id>/trades")
@project_access_required
def create_trade(project_id):
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Trade name is required"}), 400
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO trades (project_id, name, contact_name, contact_phone, contact_email, notes)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (project_id, name, data.get("contact_name"), data.get("contact_phone"), data.get("contact_email"), data.get("notes")),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM trades WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@bp.get("/<int:project_id>/trades/<int:trade_id>")
@project_access_required
def get_trade(project_id, trade_id):
    conn = get_db()
    trade = conn.execute("SELECT * FROM trades WHERE id = ? AND project_id = ?", (trade_id, project_id)).fetchone()
    if not trade:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    attendances = conn.execute(
        """SELECT at.*, a.name as activity_name FROM attendances at
           LEFT JOIN activities a ON a.id = at.activity_id
           WHERE at.trade_id = ? ORDER BY at.date""",
        (trade_id,),
    ).fetchall()
    activities = conn.execute(
        "SELECT * FROM activities WHERE trade_id = ? ORDER BY forecast_start", (trade_id,)
    ).fetchall()
    conn.close()
    result = dict(trade)
    result["attendances"] = [dict(a) for a in attendances]
    result["activities"] = [dict(a) for a in activities]
    return jsonify(result)


@bp.put("/<int:project_id>/trades/<int:trade_id>")
@project_access_required
def update_trade(project_id, trade_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    fields = {k: data[k] for k in ("name", "contact_name", "contact_phone", "contact_email", "notes") if k in data}
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE trades SET {set_clause} WHERE id = ? AND project_id = ?", list(fields.values()) + [trade_id, project_id])
        conn.commit()
    row = conn.execute("SELECT * FROM trades WHERE id = ?", (trade_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))


# ---------- Attendances ----------

@bp.post("/<int:project_id>/trades/<int:trade_id>/attendances")
@project_access_required
def create_attendance(project_id, trade_id):
    data = request.get_json(force=True) or {}
    date_val = data.get("date")
    if not date_val:
        return jsonify({"error": "date is required"}), 400
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO attendances (project_id, trade_id, activity_id, date, status, checklist_json, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (project_id, trade_id, data.get("activity_id"), date_val, data.get("status", "not_contacted"),
         json.dumps(data.get("checklist", {})), data.get("notes")),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM attendances WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@bp.put("/<int:project_id>/attendances/<int:attendance_id>")
@project_access_required
def update_attendance(project_id, attendance_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    att = conn.execute("SELECT * FROM attendances WHERE id = ? AND project_id = ?", (attendance_id, project_id)).fetchone()
    if not att:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    fields = {}
    for f in ("date", "status", "notes"):
        if f in data:
            fields[f] = data[f]
    if "checklist" in data:
        fields["checklist_json"] = json.dumps(data["checklist"])
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE attendances SET {set_clause} WHERE id = ?", list(fields.values()) + [attendance_id])
        if "status" in data:
            conn.execute(
                """INSERT INTO diary_entries (project_id, entry_type, text, author)
                   VALUES (?, 'attendance', ?, 'Site manager')""",
                (project_id, f"Attendance for {att['date']} updated to '{data['status']}'."),
            )
        conn.commit()
    row = conn.execute("SELECT * FROM attendances WHERE id = ?", (attendance_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))
