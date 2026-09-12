"""Status computation + lightweight 'AI assist' heuristics.

Implements the five-state model from the product spec:
  COMPLETE / ACTIVE / READY / NOT_READY / BLOCKED

And the AI behaviour rules from section 6 of the product doc:
  - AI proposes, warns and summarises.
  - AI never silently overwrites the baseline or commits people to dates.
  - Every AI-generated suggestion is reviewable (ai_suggestions table).
"""
from datetime import date, datetime, timedelta
import json

STATUS_COMPLETE = "complete"
STATUS_ACTIVE = "active"
STATUS_READY = "ready"
STATUS_NOT_READY = "not_ready"
STATUS_BLOCKED = "blocked"


def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def compute_status(activity, predecessor=None, today=None):
    """Compute the live status of an activity dict.

    activity: dict with keys actual_start, actual_end, forecast_start,
              forecast_end, blocked_manual, blocked_reason
    predecessor: dict of the predecessor activity, or None
    """
    today = today or date.today()

    if activity.get("actual_end"):
        return STATUS_COMPLETE
    if activity.get("actual_start"):
        return STATUS_ACTIVE

    predecessor_complete = True
    if predecessor is not None:
        predecessor_complete = bool(predecessor.get("actual_end"))

    forecast_start = _parse_date(activity.get("forecast_start")) or _parse_date(
        activity.get("planned_start")
    )

    if activity.get("blocked_manual"):
        return STATUS_BLOCKED

    if not predecessor_complete:
        # Waiting on a predecessor. It's only "blocked" (urgent) once the
        # forecast date has arrived or passed and we still can't start.
        if forecast_start and forecast_start <= today:
            return STATUS_BLOCKED
        return STATUS_NOT_READY

    # Predecessor clear (or none). Ready to go regardless of date - a site
    # manager may pull work forward - but flagged not-ready if the forecast
    # date is comfortably in the future AND nothing has happened yet.
    return STATUS_READY


STATUS_LABELS = {
    STATUS_COMPLETE: "Complete",
    STATUS_ACTIVE: "Active",
    STATUS_READY: "Ready",
    STATUS_NOT_READY: "Not Ready",
    STATUS_BLOCKED: "Blocked",
}

STATUS_COLORS = {
    STATUS_COMPLETE: "#1e8e5a",
    STATUS_ACTIVE: "#2f6fed",
    STATUS_READY: "#e2a336",
    STATUS_NOT_READY: "#8b93a7",
    STATUS_BLOCKED: "#d64545",
}


def enrich_activity(activity, predecessor=None, today=None):
    status = compute_status(activity, predecessor, today)
    activity = dict(activity)
    activity["status"] = status
    activity["status_label"] = STATUS_LABELS[status]
    activity["status_color"] = STATUS_COLORS[status]
    return activity


def generate_forecast_shift_suggestions(conn, project_id, changed_activity_id):
    """When an activity's actual dates change, look at any activities that
    name it as a predecessor and, if their current forecast start no longer
    makes sense, create a *pending* AI suggestion proposing a new forecast
    date. Nothing is applied automatically - a human has to accept it.
    """
    changed = conn.execute(
        "SELECT * FROM activities WHERE id = ?", (changed_activity_id,)
    ).fetchone()
    if not changed:
        return []

    dependents = conn.execute(
        "SELECT * FROM activities WHERE predecessor_activity_id = ?",
        (changed_activity_id,),
    ).fetchall()

    created = []
    changed_end = _parse_date(changed["actual_end"]) or _parse_date(changed["forecast_end"])
    if not changed_end:
        return created

    for dep in dependents:
        dep = dict(dep)
        current_forecast_start = _parse_date(dep.get("forecast_start"))
        # Predecessor should finish at least 1 day before dependent starts.
        min_start = changed_end + timedelta(days=1)
        if current_forecast_start and current_forecast_start >= min_start:
            continue  # existing forecast is already consistent, no action needed
        if dep.get("actual_start"):
            continue  # already under way, don't propose a start-date shift

        # Preserve original duration if we have planned dates, else default 1 day.
        planned_start = _parse_date(dep.get("planned_start"))
        planned_end = _parse_date(dep.get("planned_end"))
        duration = (planned_end - planned_start).days if planned_start and planned_end else 1
        duration = max(duration, 0)
        new_start = min_start
        new_end = new_start + timedelta(days=duration)

        # Avoid duplicate pending suggestions for the same activity/type.
        existing = conn.execute(
            """SELECT id FROM ai_suggestions WHERE activity_id = ? AND type = 'forecast_shift'
               AND status = 'pending'""",
            (dep["id"],),
        ).fetchone()
        message = (
            f"'{changed['name']}' now finishes {changed_end.isoformat()}, "
            f"so '{dep['name']}' can no longer start {current_forecast_start.isoformat() if current_forecast_start else '(unset)'}. "
            f"Suggest moving forecast to {new_start.isoformat()} – {new_end.isoformat()}."
        )
        proposed = json.dumps({
            "forecast_start": new_start.isoformat(),
            "forecast_end": new_end.isoformat(),
        })
        if existing:
            conn.execute(
                "UPDATE ai_suggestions SET message = ?, proposed_data_json = ?, created_at = datetime('now') WHERE id = ?",
                (message, proposed, existing["id"]),
            )
            created.append(existing["id"])
        else:
            cur = conn.execute(
                """INSERT INTO ai_suggestions (project_id, type, activity_id, message, proposed_data_json)
                   VALUES (?, 'forecast_shift', ?, ?, ?)""",
                (project_id, dep["id"], message, proposed),
            )
            created.append(cur.lastrowid)
    conn.commit()
    return created


def generate_missing_prereq_suggestions(conn, project_id, today=None):
    """Flag activities whose forecast start is within the next 10 days but
    which have no trade assigned, or no upcoming confirmed attendance, or an
    unresolved predecessor. Mirrors the 'proactive prompts' in section 5 of
    the product doc.
    """
    today = today or date.today()
    horizon = today + timedelta(days=10)
    activities = conn.execute(
        "SELECT * FROM activities WHERE project_id = ?", (project_id,)
    ).fetchall()
    created = []
    for a in activities:
        a = dict(a)
        if a.get("actual_start") or a.get("actual_end"):
            continue
        fstart = _parse_date(a.get("forecast_start")) or _parse_date(a.get("planned_start"))
        if not fstart or fstart > horizon or fstart < today - timedelta(days=1):
            continue

        reasons = []
        if not a.get("trade_id"):
            reasons.append("no trade assigned")
        else:
            att = conn.execute(
                """SELECT * FROM attendances WHERE trade_id = ? AND activity_id = ?
                   ORDER BY date DESC LIMIT 1""",
                (a["trade_id"], a["id"]),
            ).fetchone()
            if not att or att["status"] in ("not_contacted", "tentative"):
                reasons.append("attendance not confirmed")

        if a.get("predecessor_activity_id"):
            pred = conn.execute(
                "SELECT * FROM activities WHERE id = ?", (a["predecessor_activity_id"],)
            ).fetchone()
            if pred and not pred["actual_end"]:
                reasons.append(f"predecessor '{pred['name']}' not yet complete")

        if not reasons:
            continue

        days_out = (fstart - today).days
        when = "today" if days_out == 0 else f"in {days_out} day{'s' if days_out != 1 else ''}"
        message = f"'{a['name']}' is due to start {when} ({fstart.isoformat()}) – {', '.join(reasons)}."

        existing = conn.execute(
            """SELECT id FROM ai_suggestions WHERE activity_id = ? AND type = 'missing_prereq'
               AND status = 'pending'""",
            (a["id"],),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE ai_suggestions SET message = ?, created_at = datetime('now') WHERE id = ?",
                (message, existing["id"]),
            )
            created.append(existing["id"])
        else:
            cur = conn.execute(
                """INSERT INTO ai_suggestions (project_id, type, activity_id, message)
                   VALUES (?, 'missing_prereq', ?, ?)""",
                (project_id, a["id"], message),
            )
            created.append(cur.lastrowid)
    conn.commit()
    return created
