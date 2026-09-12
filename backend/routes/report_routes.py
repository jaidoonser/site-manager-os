from datetime import date, timedelta
from flask import Blueprint, request, jsonify
from db import get_db
from auth import project_access_required
from routes.activity_routes import _hydrate

bp = Blueprint("reports", __name__, url_prefix="/api/projects")


@bp.get("/<int:project_id>/reports/summary")
@project_access_required
def summary(project_id):
    conn = get_db()
    rows = conn.execute("SELECT * FROM activities WHERE project_id = ?", (project_id,)).fetchall()
    activities = [_hydrate(conn, r) for r in rows]

    stats = {"complete": 0, "active": 0, "ready": 0, "not_ready": 0, "blocked": 0}
    for a in activities:
        stats[a["status"]] = stats.get(a["status"], 0) + 1

    today = date.today()
    week_ahead = today + timedelta(days=7)

    confirmations_due = conn.execute(
        """SELECT at.*, t.name as trade_name FROM attendances at
           JOIN trades t ON t.id = at.trade_id
           WHERE at.project_id = ? AND at.date BETWEEN ? AND ?
           AND at.status IN ('not_contacted', 'tentative')
           ORDER BY at.date""",
        (project_id, today.isoformat(), week_ahead.isoformat()),
    ).fetchall()

    late_items = [
        a for a in activities
        if a["status"] in ("blocked", "not_ready")
        and a.get("forecast_start") and a["forecast_start"] <= today.isoformat()
        and not a.get("actual_start")
    ]

    suggestions_count = conn.execute(
        "SELECT COUNT(*) c FROM ai_suggestions WHERE project_id = ? AND status = 'pending'", (project_id,)
    ).fetchone()["c"]

    conn.close()
    return jsonify({
        "stats": stats,
        "active": [a for a in activities if a["status"] == "active"],
        "blocked": [a for a in activities if a["status"] == "blocked"],
        "ready": [a for a in activities if a["status"] == "ready"],
        "confirmations_due": [dict(c) for c in confirmations_due],
        "late_items": late_items,
        "ai_suggestions_pending": suggestions_count,
        "today": today.isoformat(),
    })


@bp.get("/<int:project_id>/reports/lookahead")
@project_access_required
def lookahead(project_id):
    range_key = request.args.get("range", "2week")
    days = {"today": 1, "2week": 14, "6week": 42}.get(range_key, 14)
    today = date.today()
    horizon = today + timedelta(days=days)

    conn = get_db()
    rows = conn.execute("SELECT * FROM activities WHERE project_id = ?", (project_id,)).fetchall()
    activities = [_hydrate(conn, r) for r in rows]
    conn.close()

    def in_window(a):
        fs = a.get("forecast_start")
        if not fs:
            return False
        return today.isoformat() <= fs <= horizon.isoformat() and a["status"] != "complete"

    windowed = [a for a in activities if in_window(a)]
    windowed.sort(key=lambda a: a.get("forecast_start") or "")
    return jsonify({"range": range_key, "from": today.isoformat(), "to": horizon.isoformat(), "activities": windowed})


@bp.get("/<int:project_id>/reports/daily")
@project_access_required
def daily(project_id):
    day = request.args.get("date", date.today().isoformat())
    conn = get_db()
    diary = conn.execute(
        "SELECT * FROM diary_entries WHERE project_id = ? AND date(created_at) = ? ORDER BY created_at",
        (project_id, day),
    ).fetchall()
    attendances = conn.execute(
        """SELECT at.*, t.name as trade_name FROM attendances at JOIN trades t ON t.id = at.trade_id
           WHERE at.project_id = ? AND at.date = ?""",
        (project_id, day),
    ).fetchall()
    photos = conn.execute(
        "SELECT * FROM photos WHERE project_id = ? AND date(created_at) = ?", (project_id, day)
    ).fetchall()
    conn.close()
    return jsonify({
        "date": day,
        "diary": [dict(d) for d in diary],
        "attendances": [dict(a) for a in attendances],
        "photos": [dict(p) for p in photos],
    })
