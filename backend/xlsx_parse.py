"""Programme (schedule) import: Excel (.xlsx) or CSV.

Expected loose column headings (case-insensitive, order-independent):
    Task / Activity / Name
    Trade
    Planned Start / Start
    Planned End / End / Finish
    Duration (days)          -- used if end date is missing
    Predecessor              -- name OR row number of another activity in the same file

This mirrors the doc's MVP requirement: "Excel/CSV schedule with task,
dates, duration, predecessor and trade."
"""
import csv
import io
from datetime import datetime, timedelta
import openpyxl

COLUMN_ALIASES = {
    "name": ["task", "activity", "name", "task name", "activity name"],
    "trade": ["trade", "subcontractor", "contractor"],
    "planned_start": ["planned start", "start", "start date"],
    "planned_end": ["planned end", "end", "finish", "end date", "finish date"],
    "duration": ["duration", "duration (days)", "days"],
    "predecessor": ["predecessor", "predecessors", "depends on"],
}


def _normalize_header(h):
    return str(h).strip().lower() if h is not None else ""


def _map_columns(headers):
    norm = [_normalize_header(h) for h in headers]
    mapping = {}
    for field, aliases in COLUMN_ALIASES.items():
        for idx, h in enumerate(norm):
            if h in aliases:
                mapping[field] = idx
                break
    return mapping


def _parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _rows_from_xlsx(file_path):
    wb = openpyxl.load_workbook(file_path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    return rows


def _rows_from_csv(file_path):
    with open(file_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        return [tuple(row) for row in reader]


def parse_programme(file_path, is_csv=False):
    rows = _rows_from_csv(file_path) if is_csv else _rows_from_xlsx(file_path)
    if not rows:
        return []
    headers = rows[0]
    mapping = _map_columns(headers)
    data_rows = rows[1:]

    activities = []
    name_to_index = {}
    for i, row in enumerate(data_rows):
        def get(field):
            idx = mapping.get(field)
            if idx is None or idx >= len(row):
                return None
            return row[idx]

        name = get("name")
        if not name or not str(name).strip():
            continue
        name = str(name).strip()
        planned_start = _parse_date(get("planned_start"))
        planned_end = _parse_date(get("planned_end"))
        duration = get("duration")
        if planned_start and not planned_end and duration:
            try:
                planned_end = (
                    datetime.strptime(planned_start, "%Y-%m-%d") + timedelta(days=int(float(duration)))
                ).date().isoformat()
            except (ValueError, TypeError):
                pass

        activity = {
            "row_index": i,
            "name": name,
            "trade": (str(get("trade")).strip() if get("trade") else None),
            "planned_start": planned_start,
            "planned_end": planned_end,
            "predecessor_ref": (str(get("predecessor")).strip() if get("predecessor") else None),
        }
        activities.append(activity)
        name_to_index[name.lower()] = i

    # Resolve predecessor references (by row number or by activity name)
    for a in activities:
        ref = a.pop("predecessor_ref", None)
        a["predecessor_row_index"] = None
        if not ref:
            continue
        ref_clean = ref.strip()
        if ref_clean.isdigit():
            target_row = int(ref_clean) - 1  # 1-based row number in the sheet's data rows
            if 0 <= target_row < len(activities):
                a["predecessor_row_index"] = target_row
        elif ref_clean.lower() in name_to_index:
            a["predecessor_row_index"] = name_to_index[ref_clean.lower()]

    return activities
