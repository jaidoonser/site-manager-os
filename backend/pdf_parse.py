"""Lightweight 'AI-assisted' drawing sheet recognition.

Per the product doc, the AI's job here is narrow: read the sheet number,
title and probable type (plan / elevation / section / detail) from the
title-block text of each page so the site manager doesn't have to type it
in by hand. It should NOT pretend to understand the drawing content itself,
and every guess is stored with a confidence level so it stays reviewable.
"""
import re
import subprocess
from pypdf import PdfReader

SHEET_NUMBER_PATTERNS = [
    re.compile(r"\b([A-Z]{1,3}[-\.]?\d{2,4}(?:\.\d{1,2})?)\b"),  # A-101, S101, A-101.1
]

TYPE_KEYWORDS = [
    ("elevation", "elevation"),
    ("section", "section"),
    ("detail", "detail"),
    ("floor plan", "plan"),
    ("site plan", "plan"),
    ("roof plan", "plan"),
    ("plan", "plan"),
    ("schedule", "schedule"),
    ("finishes", "schedule"),
]

# Discipline guessing: matched against the drawing set's filename plus the
# extracted text of its first few pages. Order matters - more specific
# keywords are checked before generic ones. This is the same "narrow,
# reviewable AI" approach as sheet recognition: a guess with a confidence
# level, never a silent, unreviewable classification.
DISCIPLINE_KEYWORDS = [
    ("hydraulic", "hydraulic"), ("plumbing", "hydraulic"), ("drainage", "hydraulic"), ("stormwater", "hydraulic"),
    ("structural", "structural"), ("engineer", "structural"),
    ("electrical", "electrical"), (" elec", "electrical"),
    ("mechanical", "mechanical"), ("hvac", "mechanical"),
    ("fire", "fire"), ("sprinkler", "fire"),
    ("landscape", "landscape"),
    ("geotechnical", "geotechnical"), ("geotech", "geotechnical"),
    ("survey", "survey"),
    ("civil", "civil"),
    ("architectural", "architectural"), (" arch", "architectural"),
]

# Fallback: a common sheet-number prefix letter used across the industry
# (e.g. "S-101" for structural, "H-01" for hydraulic) when no keyword hits.
DISCIPLINE_PREFIXES = {
    "A": "architectural", "S": "structural", "C": "civil", "H": "hydraulic",
    "E": "electrical", "M": "mechanical", "L": "landscape", "F": "fire",
    "G": "geotechnical",
}

DISCIPLINE_LABELS = {
    "architectural": "Architectural", "structural": "Structural", "civil": "Civil",
    "hydraulic": "Hydraulic", "electrical": "Electrical", "mechanical": "Mechanical",
    "landscape": "Landscape", "fire": "Fire", "geotechnical": "Geotechnical",
    "survey": "Survey", "other": "Other",
}


def guess_sheet_number(text):
    for pattern in SHEET_NUMBER_PATTERNS:
        matches = pattern.findall(text)
        if matches:
            # title blocks usually put the sheet number near the top or
            # bottom of the extracted text; just take the first plausible hit
            return matches[0].upper()
    return None


def guess_sheet_type(text):
    lower = text.lower()
    for keyword, sheet_type in TYPE_KEYWORDS:
        if keyword in lower:
            return sheet_type
    return "plan"


def guess_sheet_title(text):
    # Take the longest all-caps-ish line as a rough title guess - title
    # blocks are usually short, capitalised strings like "GROUND FLOOR PLAN".
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    candidates = [l for l in lines if 4 <= len(l) <= 60 and sum(c.isalpha() for c in l) >= 4]
    caps = [l for l in candidates if l.upper() == l]
    pool = caps or candidates
    if not pool:
        return None
    return max(pool, key=len).title()


def guess_discipline(filename, sample_text, sheet_numbers=None):
    """Guess a drawing set's discipline from its filename + sampled page
    text, with a fallback to the sheet-number prefix letter convention
    (A-, S-, C-, H-, E-, M-, L-, F-, G-). Returns (discipline, confidence)."""
    haystack = f"{filename} {sample_text}".lower()
    for keyword, discipline in DISCIPLINE_KEYWORDS:
        if keyword in haystack:
            return discipline, "medium"
    for number in (sheet_numbers or []):
        if number:
            prefix = re.match(r"[A-Z]+", number.upper())
            if prefix and prefix.group(0)[0] in DISCIPLINE_PREFIXES:
                return DISCIPLINE_PREFIXES[prefix.group(0)[0]], "low"
    return "other", "low"


def get_page_count(pdf_path):
    """Determine a PDF's page count as robustly as possible.

    `pdfinfo` (poppler, the same tool used for rasterizing) is tried first -
    it tolerates far more real-world PDF quirks (odd xrefs, unusual
    encodings, restricted-permission encryption from CAD exports, etc.)
    than pypdf's pure-Python parser. pypdf is only a fallback.
    """
    try:
        result = subprocess.run(
            ["pdfinfo", pdf_path], capture_output=True, text=True, timeout=30,
        )
        for line in result.stdout.splitlines():
            if line.lower().startswith("pages:"):
                return int(line.split(":", 1)[1].strip())
    except Exception:
        pass
    try:
        return len(PdfReader(pdf_path).pages)
    except Exception:
        return None


def render_sheet_image(pdf_path, page_number, out_path_no_ext, dpi=150):
    """Rasterize a single PDF page to a PNG using poppler's pdftoppm.

    We render server-side (rather than parsing the PDF in the browser with
    pdf.js) so the Plans viewer works in any browser without a JS bundler
    or a client-side PDF engine - just a plain <img>.
    """
    subprocess.run(
        [
            "pdftoppm", "-png", "-r", str(dpi),
            "-f", str(page_number), "-l", str(page_number),
            "-singlefile", pdf_path, out_path_no_ext,
        ],
        check=True,
        capture_output=True,
    )
    return out_path_no_ext + ".png"


def parse_drawing_set(file_path):
    """Return a list of dicts, one per page, with best-guess metadata.

    The number of pages always comes from `get_page_count`, independent of
    whether pypdf can successfully extract text from any given page - a
    drawing set that pypdf struggles with (unusual CAD-export encoding, a
    scanned/image-only page, a damaged page) still produces one sheet per
    actual page instead of silently truncating to whatever the first
    exception-free page was. Per-page text extraction and metadata guessing
    are wrapped individually so one bad page can never take any other page
    down with it.
    """
    page_count = get_page_count(file_path) or 1

    reader = None
    try:
        reader = PdfReader(file_path)
        if getattr(reader, "is_encrypted", False):
            try:
                reader.decrypt("")  # most CAD/office exports use an empty user password
            except Exception:
                pass
    except Exception:
        reader = None

    results = []
    for i in range(page_count):
        text = ""
        if reader is not None:
            try:
                if i < len(reader.pages):
                    text = reader.pages[i].extract_text() or ""
            except Exception:
                text = ""
        try:
            number = guess_sheet_number(text)
            title = guess_sheet_title(text)
            sheet_type = guess_sheet_type(text)
        except Exception:
            number, title, sheet_type = None, None, "plan"
        confidence = "medium" if number else "low"
        results.append({
            "page_number": i + 1,
            "sheet_number": number or f"SHEET-{i + 1}",
            "sheet_title": title or f"Untitled sheet {i + 1}",
            "sheet_type": sheet_type,
            "ai_confidence": confidence,
            "_text": text,
        })
    return results
