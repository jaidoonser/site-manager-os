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
    """Return a list of dicts, one per page, with best-guess metadata."""
    reader = PdfReader(file_path)
    results = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        number = guess_sheet_number(text)
        title = guess_sheet_title(text)
        sheet_type = guess_sheet_type(text)
        confidence = "medium" if number else "low"
        results.append({
            "page_number": i + 1,
            "sheet_number": number or f"SHEET-{i + 1}",
            "sheet_title": title or f"Untitled sheet {i + 1}",
            "sheet_type": sheet_type,
            "ai_confidence": confidence,
        })
    return results
