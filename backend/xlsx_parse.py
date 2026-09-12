"""Programme (schedule) import: Excel (.xlsx) or CSV.

Real-world programmes (MS Project/Excel exports, site-manager-built
schedules) vary a lot in shape - not just column names. This parser is
deliberately tolerant of:

- Metadata rows before the real header row (a project title, start date,
  calendar settings etc. above the actual table) - the header row is
  detected by scanning for the row that best matches known column names,
  not assumed to be row 1.
- Multiple worksheets in one workbook (e.g. a full programme plus a
  "6 week lookahead" and a "scope & assumptions" tab) - every sheet is
  scored and the best-matching one is used, not just whichever sheet
  happens to be "active".
- Predecessors referenced by an ID/WBS column (e.g. "1.02") rather than by
  row number or the activity's name - the most common format for anything
  exported from proper scheduling tools.

Expected loose column headings (case-insensitive, order-independent):
    Task / Activity / Name
    Trade / Lead trade / Subcontractor
    Planned Start / Start
    Planned End / End / Finish
    Duration / Workdays (days) - used if end date is missing
    Predecessor               - an ID/WBS reference, a row number, or the
                                 name of another activity in the same file
    ID / Activity ID / WBS    - optional; if present, Predecessor values are
                                 matched against this column first

This mirrors the doc's MVP requirement: "Excel/CSV schedule with task,
dates, duration, predecessor and trade" - broadened to match how these
schedules actually look in practice.
"""
import csv
from datetime import datetime, timedelta
import openpyxl

COLUMN_ALIASES = {
    "id": ["id", "activity id", "task id", "wbs", "wbs id", "item id"],
    "name": ["task", "activity", "name", "task name", "activity name", "description"],
    "trade": ["trade", "lead trade", "subcontractor", "contractor", "responsible trade", "trade / sub"],
    "planned_start": ["planned start", "start", "start date"],
    "planned_end": ["planned end", "end", "finish", "end date", "finish date"],
    "duration": ["duration", "duration (days)", "duration (workdays)", "workdays", "days"],
    "predecessor": ["predecessor", "predecessors", "depends on"],
}

# A header row must at least identify the task name column, plus either a
# date or a duration, to be considered a real header rather than a
# coincidental text match in a metadata row.
REQUIRED_FOR_HEADER = ("name",)
ANY_OF_FOR_HEADER = ("planned_start", "planned_end", "duration")

# Sheet names that suggest "this is the main programme" when a workbook has
# several tabs and more than one looks plausible.
PREFERRED_SHEET_KEYWORDS = ("program", "programme", "schedule")


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


def _header_row_score(mapping):
    if not all(f in mapping for f in REQUIRED_FOR_HEADER):
        return 0
    if not any(f in mapping for f in ANY_OF_FOR_HEADER):
        return 0
    return len(mapping)


def _find_header_row(rows, max_scan=30):
    """Return (header_row_index, mapping) for the best-scoring row among the
    first `max_scan` rows, or (None, {}) if nothing plausible is found."""
    best_idx, best_mapping, best_score = None, {}, 0
    for i, row in enumerate(rows[:max_scan]):
        mapping = _map_columns(row)
        score = _header_row_score(mapping)
        if score > best_score:
            best_idx, best_mapping, best_score = i, mapping, score
    return best_idx, best_mapping


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


def _sheet_rows_and_score(ws):
    rows = [tuple(row) for row in ws.iter_rows(values_only=True)]
    header_idx, mapping = _find_header_row(rows)
    score = _header_row_score(mapping) if header_idx is not None else 0
    return rows, header_idx, mapping, score


def _rows_from_xlsx(file_path):
    """Pick the best-matching worksheet (not just whichever is "active"),
    scored by how well a header row can be found in it, with a small bonus
    for sheet names that look like the main programme."""
    wb = openpyxl.load_workbook(file_path, data_only=True)
    candidates = []
    for ws in wb.worksheets:
        rows, header_idx, mapping, score = _sheet_rows_and_score(ws)
        if score == 0:
            continue
        name_bonus = 1 if any(k in ws.title.lower() for k in PREFERRED_SHEET_KEYWORDS) else 0
        candidates.append((score + name_bonus, rows, header_idx, mapping))
    if not candidates:
        # nothing scored - fall back to the active sheet, header assumed to be row 1
        rows = [tuple(row) for row in wb.active.iter_rows(values_only=True)]
        return rows, 0
    candidates.sort(key=lambda c: c[0], reverse=True)
    _, rows, header_idx, _ = candidates[0]
    return rows, header_idx


def _rows_from_csv(file_path):
    with open(file_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        return [tuple(row) for row in reader]


def parse_programme(file_path, is_csv=False):
    if is_csv:
        rows = _rows_from_csv(file_path)
        header_idx, _ = _find_header_row(rows)
        if header_idx is None:
            header_idx = 0  # keep old behaviour for a simple CSV with no metadata rows
    else:
        rows, header_idx = _rows_from_xlsx(file_path)

    if not rows or header_idx is None or header_idx >= len(rows):
        return []

    headers = rows[header_idx]
    mapping = _map_columns(headers)
    data_rows = rows[header_idx + 1:]

    activities = []
    name_to_index = {}
    id_to_index = {}
    for i, row in enumerate(data_rows):
        def get(field, row=row):
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

        row_id = get("id")
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
        if row_id is not None and str(row_id).strip():
            id_to_index[str(row_id).strip().lower()] = i

    # Resolve predecessor references. A ref might be:
    #   - an ID/WBS value matching the sheet's own ID column (most specific
    #     and most common in real programmes, e.g. "1.02")
    #   - the name of another activity in the file
    #   - a plain row number (only meaningful when there's no ID column,
    #     since an ID column existing means row numbers aren't what's used)
    # Only the first reference is used if a cell lists more than one
    # (comma/semicolon/"and"-separated) - this app's data model links one
    # predecessor per activity.
    for a in activities:
        ref = a.pop("predecessor_ref", None)
        a["predecessor_row_index"] = None
        if not ref:
            continue
        first_ref = ref.replace(" and ", ",").replace(";", ",").split(",")[0].strip()
        if not first_ref:
            continue
        ref_lower = first_ref.lower()
        if ref_lower in id_to_index:
            a["predecessor_row_index"] = id_to_index[ref_lower]
        elif ref_lower in name_to_index:
            a["predecessor_row_index"] = name_to_index[ref_lower]
        elif not id_to_index and first_ref.isdigit():
            target_row = int(first_ref) - 1  # 1-based row number in the sheet's data rows
            if 0 <= target_row < len(activities):
                a["predecessor_row_index"] = target_row

    return activities
