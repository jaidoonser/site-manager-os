import os
from datetime import date, timedelta
from io import BytesIO
from flask import Blueprint, request, jsonify, send_file
from db import get_db
from auth import project_access_required
from routes.activity_routes import _hydrate
from routes.diary_routes import _empty_diary_day
from routes.photo_routes import UPLOAD_PHOTOS

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


def _daily_data(conn, project_id, day):
    """Everything the daily report needs, both what happened automatically
    (diary feed, attendance, photos) and the manually-filled structured
    record for the day (weather, personnel, deliveries, etc.)."""
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
    diary_day_row = conn.execute(
        "SELECT * FROM diary_days WHERE project_id = ? AND date = ?", (project_id, day)
    ).fetchone()
    completed = conn.execute(
        "SELECT * FROM activities WHERE project_id = ? AND actual_end = ?", (project_id, day)
    ).fetchall()
    return {
        "date": day,
        "diary": [dict(d) for d in diary],
        "attendances": [dict(a) for a in attendances],
        "photos": [dict(p) for p in photos],
        "diary_day": dict(diary_day_row) if diary_day_row else _empty_diary_day(project_id, day),
        "completed_activities": [dict(a) for a in completed],
    }


@bp.get("/<int:project_id>/reports/daily")
@project_access_required
def daily(project_id):
    day = request.args.get("date", date.today().isoformat())
    conn = get_db()
    data = _daily_data(conn, project_id, day)
    conn.close()
    return jsonify(data)


@bp.get("/<int:project_id>/reports/weekly")
@project_access_required
def weekly(project_id):
    end_str = request.args.get("end", date.today().isoformat())
    try:
        end_date = date.fromisoformat(end_str)
    except ValueError:
        end_date = date.today()
    start_date = end_date - timedelta(days=6)
    start_str, end_str = start_date.isoformat(), end_date.isoformat()

    conn = get_db()
    rows = conn.execute("SELECT * FROM activities WHERE project_id = ?", (project_id,)).fetchall()
    activities = [_hydrate(conn, r) for r in rows]
    completed_this_week = [
        a for a in activities if a.get("actual_end") and start_str <= a["actual_end"] <= end_str
    ]
    started_this_week = [
        a for a in activities if a.get("actual_start") and start_str <= a["actual_start"] <= end_str
    ]

    diary_counts = {}
    diary_rows = conn.execute(
        """SELECT entry_type, COUNT(*) c FROM diary_entries
           WHERE project_id = ? AND date(created_at) BETWEEN ? AND ?
           GROUP BY entry_type""",
        (project_id, start_str, end_str),
    ).fetchall()
    for r in diary_rows:
        diary_counts[r["entry_type"]] = r["c"]

    safety_entries = conn.execute(
        """SELECT * FROM diary_entries WHERE project_id = ? AND entry_type = 'safety'
           AND date(created_at) BETWEEN ? AND ? ORDER BY created_at""",
        (project_id, start_str, end_str),
    ).fetchall()

    attendance_rows = conn.execute(
        """SELECT status, COUNT(*) c FROM attendances
           WHERE project_id = ? AND date BETWEEN ? AND ? GROUP BY status""",
        (project_id, start_str, end_str),
    ).fetchall()
    attendance_counts = {r["status"]: r["c"] for r in attendance_rows}

    photos_count = conn.execute(
        "SELECT COUNT(*) c FROM photos WHERE project_id = ? AND date(created_at) BETWEEN ? AND ?",
        (project_id, start_str, end_str),
    ).fetchone()["c"]

    conn.close()
    return jsonify({
        "from": start_str,
        "to": end_str,
        "completed_activities": completed_this_week,
        "started_activities": started_this_week,
        "diary_counts_by_type": diary_counts,
        "safety_entries": [dict(s) for s in safety_entries],
        "attendance_counts": attendance_counts,
        "photos_count": photos_count,
    })


# ---------- Printable / emailable daily report (PDF) ----------

PAGE_W, PAGE_H = 595.27, 841.89  # A4 points
MARGIN = 42


def _pdf_wrap(c, text, x, y, max_width, font="Helvetica", size=9.5, leading=13, bottom=MARGIN):
    """Draw `text` word-wrapped to max_width, starting a new page if it runs
    off the bottom. Returns the y position after the last line."""
    c.setFont(font, size)
    words = (text or "—").replace("\r", "").split("\n")
    for para in words:
        line = ""
        tokens = para.split(" ") if para else [""]
        for word in tokens:
            trial = (line + " " + word).strip()
            if c.stringWidth(trial, font, size) > max_width and line:
                c.drawString(x, y, line)
                y -= leading
                if y < bottom:
                    c.showPage()
                    c.setFont(font, size)
                    y = PAGE_H - MARGIN
                line = word
            else:
                line = trial
        c.drawString(x, y, line)
        y -= leading
        if y < bottom:
            c.showPage()
            c.setFont(font, size)
            y = PAGE_H - MARGIN
    return y


def _pdf_section(c, title, text, x, y, max_width):
    if y < MARGIN + 40:
        c.showPage()
        y = PAGE_H - MARGIN
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(x, y, title)
    y -= 15
    y = _pdf_wrap(c, text or "—", x, y, max_width)
    return y - 6


@bp.get("/<int:project_id>/reports/daily/pdf")
@project_access_required
def daily_pdf(project_id):
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib.utils import ImageReader

    day = request.args.get("date", date.today().isoformat())
    conn = get_db()
    project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    data = _daily_data(conn, project_id, day)
    conn.close()

    buf = BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    content_w = PAGE_W - 2 * MARGIN
    y = PAGE_H - MARGIN

    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, y, "Daily Site Report")
    y -= 22
    c.setFont("Helvetica", 11)
    c.drawString(MARGIN, y, f"{project['name'] if project else 'Project'} — {day}")
    y -= 10
    c.setStrokeColorRGB(0.8, 0.8, 0.8)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    y -= 20

    dd = data["diary_day"]
    weather = f"{dd.get('weather_conditions') or '—'}" + (f", {dd['weather_temp']}" if dd.get("weather_temp") else "")
    half_w = (content_w - 16) / 2

    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(MARGIN, y, "Weather")
    c.drawString(MARGIN + half_w + 16, y, "Personnel on site")
    y -= 15
    y1 = _pdf_wrap(c, weather, MARGIN, y, half_w)
    y2 = _pdf_wrap(c, dd.get("personnel_notes"), MARGIN + half_w + 16, y, half_w)
    y = min(y1, y2) - 6

    y = _pdf_section(c, "Plant & equipment on site", dd.get("plant_equipment"), MARGIN, y, content_w)
    y = _pdf_section(c, "Deliveries", dd.get("deliveries"), MARGIN, y, content_w)
    y = _pdf_section(c, "Visitors", dd.get("visitors"), MARGIN, y, content_w)
    y = _pdf_section(c, "Instructions / decisions", dd.get("instructions"), MARGIN, y, content_w)
    y = _pdf_section(c, "Safety observations / incidents", dd.get("safety_notes"), MARGIN, y, content_w)
    y = _pdf_section(c, "General notes", dd.get("general_notes"), MARGIN, y, content_w)

    if data["completed_activities"]:
        names = ", ".join(a["name"] for a in data["completed_activities"])
        y = _pdf_section(c, "Tasks completed today", names, MARGIN, y, content_w)

    # Attendance table
    if y < MARGIN + 60:
        c.showPage()
        y = PAGE_H - MARGIN
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(MARGIN, y, "Trade attendance")
    y -= 15
    if data["attendances"]:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(MARGIN, y, "Trade")
        c.drawString(MARGIN + 220, y, "Status")
        c.drawString(MARGIN + 340, y, "Notes")
        y -= 12
        c.setFont("Helvetica", 9)
        for a in data["attendances"]:
            if y < MARGIN + 20:
                c.showPage()
                y = PAGE_H - MARGIN
            c.drawString(MARGIN, y, a["trade_name"][:32])
            c.drawString(MARGIN + 220, y, a["status"].replace("_", " "))
            c.drawString(MARGIN + 340, y, (a.get("notes") or "—")[:40])
            y -= 13
    else:
        y = _pdf_wrap(c, "No attendance recorded.", MARGIN, y, content_w)
    y -= 10

    # Diary feed
    if y < MARGIN + 60:
        c.showPage()
        y = PAGE_H - MARGIN
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(MARGIN, y, "Site diary entries")
    y -= 15
    if data["diary"]:
        c.setFont("Helvetica", 9)
        for entry in data["diary"]:
            ts = (entry.get("created_at") or "")[11:16]
            label = f"[{entry['entry_type'].upper()} {ts}] {entry['text']}"
            y = _pdf_wrap(c, label, MARGIN, y, content_w, size=9, leading=12)
    else:
        y = _pdf_wrap(c, "No diary entries logged.", MARGIN, y, content_w)

    # Photos (thumbnail grid, up to 6)
    photos = data["photos"][:6]
    if photos:
        y -= 8
        if y < MARGIN + 130:
            c.showPage()
            y = PAGE_H - MARGIN
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(MARGIN, y, f"Photos ({len(data['photos'])})")
        y -= 8
        thumb_w = (content_w - 3 * 10) / 4
        thumb_h = thumb_w * 0.75
        x = MARGIN
        row_top = y - thumb_h
        for i, p in enumerate(photos):
            path = os.path.join(UPLOAD_PHOTOS, p["file_path"])
            if os.path.exists(path):
                try:
                    c.drawImage(ImageReader(path), x, row_top, width=thumb_w, height=thumb_h,
                                preserveAspectRatio=True, anchor="c")
                except Exception:
                    pass
            x += thumb_w + 10
            if (i + 1) % 4 == 0:
                x = MARGIN
                row_top -= thumb_h + 10
        y = row_top - 10

    c.setFont("Helvetica-Oblique", 7.5)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.drawString(MARGIN, MARGIN / 2, "Generated by Site Manager OS")
    c.save()
    buf.seek(0)
    return send_file(
        buf, mimetype="application/pdf", as_attachment=True,
        download_name=f"daily-report-{day}.pdf",
    )
