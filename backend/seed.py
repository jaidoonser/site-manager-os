"""Seed a demo account + project so the app is immediately explorable.

The scenario intentionally mirrors the worked examples in the Site Manager
OS product overview doc (ABC Plumbing / amenities block / Zone B wall
linings / eastern elevation cladding / kitchen measure-up) so the seeded
data demonstrates the AI look-ahead prompts described there.

Run directly: `python3 seed.py` (safe to re-run - it wipes and rebuilds).
"""
import os
import uuid
from datetime import date, timedelta

from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.pagesizes import landscape, A4
from PIL import Image, ImageDraw

from db import init_db, get_db
from auth import hash_password
from status_engine import generate_forecast_shift_suggestions, generate_missing_prereq_suggestions
from pdf_parse import render_sheet_image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DRAWINGS_DIR = os.path.join(BASE_DIR, "uploads", "drawings")
PHOTOS_DIR = os.path.join(BASE_DIR, "uploads", "photos")

TODAY = date.today()


def d(days_offset):
    return (TODAY + timedelta(days=days_offset)).isoformat()


SHEET_ZONES = {
    1: [
        {"name": "Amenities Block", "x": 0.05, "y": 0.12, "w": 0.24, "h": 0.34},
        {"name": "Zone B - Wall Linings", "x": 0.34, "y": 0.12, "w": 0.24, "h": 0.34},
        {"name": "Kitchen", "x": 0.63, "y": 0.12, "w": 0.20, "h": 0.34},
        {"name": "Eastern Elevation", "x": 0.05, "y": 0.55, "w": 0.35, "h": 0.30},
        {"name": "Services Core", "x": 0.45, "y": 0.55, "w": 0.20, "h": 0.30},
    ],
    2: [
        {"name": "Bedroom 1", "x": 0.08, "y": 0.15, "w": 0.35, "h": 0.32},
        {"name": "Bedroom 2", "x": 0.50, "y": 0.15, "w": 0.35, "h": 0.32},
        {"name": "Bathroom", "x": 0.08, "y": 0.58, "w": 0.30, "h": 0.25},
    ],
}

SHEET_META = {
    1: {"sheet_number": "A-101", "sheet_title": "Ground Floor Plan", "sheet_type": "plan"},
    2: {"sheet_number": "A-102", "sheet_title": "First Floor Plan", "sheet_type": "plan"},
}


def make_drawing_pdf(path):
    page_w, page_h = landscape(A4)
    c = pdfcanvas.Canvas(path, pagesize=(page_w, page_h))
    for page_num in (1, 2):
        meta = SHEET_META[page_num]
        c.setFont("Helvetica-Bold", 18)
        c.drawString(30, page_h - 40, f"{meta['sheet_number']}  {meta['sheet_title']}")
        c.setFont("Helvetica", 9)
        c.drawString(30, page_h - 56, "SITE MANAGER OS DEMO PROJECT  |  Riverside Townhouses  |  Not for construction")
        c.rect(20, 20, page_w - 40, page_h - 80)

        for zone in SHEET_ZONES[page_num]:
            px = zone["x"] * page_w
            pw = zone["w"] * page_w
            ph = zone["h"] * page_h
            py = page_h * (1 - (zone["y"] + zone["h"]))
            c.setLineWidth(1.2)
            c.rect(px, py, pw, ph)
            c.setFont("Helvetica-Bold", 11)
            c.drawCentredString(px + pw / 2, py + ph / 2, zone["name"])
        c.showPage()
    c.save()


def make_photo(path, label, color):
    img = Image.new("RGB", (640, 480), color)
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, 620, 460], outline=(255, 255, 255), width=4)
    draw.text((40, 40), label, fill=(255, 255, 255))
    draw.text((40, 420), TODAY.isoformat(), fill=(255, 255, 255))
    img.save(path, "JPEG")


def run():
    os.makedirs(DRAWINGS_DIR, exist_ok=True)
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    init_db(reset=True)
    conn = get_db()

    # --- user ---
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
        ("demo@sitemanageros.app", hash_password("demo1234"), "Jaiden"),
    )
    user_id = cur.lastrowid

    # --- project ---
    cur = conn.execute(
        "INSERT INTO projects (name, address, owner_user_id) VALUES (?, ?, ?)",
        ("Riverside Townhouses", "42 Riverside Grove, Auckland", user_id),
    )
    project_id = cur.lastrowid

    # --- drawing set ---
    stored_name = f"{uuid.uuid4().hex}.pdf"
    pdf_path = os.path.join(DRAWINGS_DIR, stored_name)
    make_drawing_pdf(pdf_path)
    cur = conn.execute(
        """INSERT INTO drawing_sets (project_id, original_filename, stored_filename, page_count, discipline, discipline_confidence)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (project_id, "Riverside Townhouses - Issued for Construction.pdf", stored_name, 2, "architectural", "confirmed"),
    )
    drawing_set_id = cur.lastrowid

    sheet_ids = {}
    zone_ids = {}
    for page_num in (1, 2):
        meta = SHEET_META[page_num]
        image_filename = None
        try:
            out_prefix = os.path.join(DRAWINGS_DIR, f"{os.path.splitext(stored_name)[0]}_p{page_num}")
            image_path = render_sheet_image(pdf_path, page_num, out_prefix)
            image_filename = os.path.basename(image_path)
        except Exception as e:
            print("Warning: could not rasterize page", page_num, e)
        cur = conn.execute(
            """INSERT INTO sheets (project_id, drawing_set_id, page_number, sheet_number, sheet_title, sheet_type, ai_confidence, image_filename)
               VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)""",
            (project_id, drawing_set_id, page_num, meta["sheet_number"], meta["sheet_title"], meta["sheet_type"], image_filename),
        )
        sheet_ids[page_num] = cur.lastrowid
        for zone in SHEET_ZONES[page_num]:
            cz = conn.execute(
                "INSERT INTO zones (project_id, sheet_id, name, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (project_id, sheet_ids[page_num], zone["name"], zone["x"], zone["y"], zone["w"], zone["h"]),
            )
            zone_ids[zone["name"]] = cz.lastrowid
    conn.commit()

    # --- trades ---
    def add_trade(name, contact_name, phone, email):
        c = conn.execute(
            "INSERT INTO trades (project_id, name, contact_name, contact_phone, contact_email) VALUES (?, ?, ?, ?, ?)",
            (project_id, name, contact_name, phone, email),
        )
        return c.lastrowid

    t_concrete = add_trade("Coastal Concrete", "Nathan Reid", "021 555 0110", "nathan@coastalconcrete.co.nz")
    t_plumbing = add_trade("ABC Plumbing", "Steve Marsh", "021 555 0101", "steve@abcplumbing.co.nz")
    t_linings = add_trade("Linings & Interiors Co", "Maria Chen", "021 555 0122", "maria@liningsinteriors.co.nz")
    t_painters = add_trade("City Painters", "Tom Baxter", "021 555 0133", "tom@citypainters.co.nz")
    t_windows = add_trade("BuildRight Windows", "Aroha Ngata", "021 555 0144", "aroha@buildrightwindows.co.nz")
    t_scaffold = add_trade("Apex Scaffold", "Dave Wilson", "021 555 0155", "dave@apexscaffold.co.nz")
    t_cladding = add_trade("Coastview Cladding", "Rangi Parata", "021 555 0166", "rangi@coastviewcladding.co.nz")
    t_kitchen = add_trade("Kitchen Concepts Ltd", "Lee Yun", "021 555 0177", "lee@kitchenconcepts.co.nz")
    conn.commit()

    # --- activities ---
    def add_activity(name, trade_id, planned_start, planned_end, predecessor_id=None,
                      actual_start=None, actual_end=None, progress=0, blocked=False, blocked_reason=None, notes=None):
        c = conn.execute(
            """INSERT INTO activities (project_id, name, trade_id, predecessor_activity_id, planned_start, planned_end,
               forecast_start, forecast_end, actual_start, actual_end, progress_percent, blocked_manual, blocked_reason, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_id, name, trade_id, predecessor_id, planned_start, planned_end, planned_start, planned_end,
             actual_start, actual_end, progress, 1 if blocked else 0, blocked_reason, notes),
        )
        return c.lastrowid

    a_slab = add_activity("Slab pour - Amenities Block", t_concrete, d(-10), d(-8), actual_start=d(-10), actual_end=d(-8), progress=100)
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_slab, zone_ids["Amenities Block"]))

    a_drainage = add_activity("Underground drainage - Amenities Block", t_plumbing, d(11), d(12), predecessor_id=a_slab,
                               notes="RFI-17 floor wastes to confirm before pour-around.")
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_drainage, zone_ids["Amenities Block"]))

    a_linings = add_activity("Wall linings - Zone B", t_linings, d(-6), d(8), actual_start=d(-6), progress=60)
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_linings, zone_ids["Zone B - Wall Linings"]))

    a_plaster = add_activity("Plaster - Zone B", t_linings, d(9), d(35), predecessor_id=a_linings)
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_plaster, zone_ids["Zone B - Wall Linings"]))

    a_paint = add_activity("Painting - Zone B", t_painters, d(33), d(39), predecessor_id=a_plaster,
                            notes="Booking currently 2 days before plaster is forecast to finish - review.")
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_paint, zone_ids["Zone B - Wall Linings"]))

    a_windows = add_activity("Windows install - Bedroom 1", t_windows, d(7), d(8),
                              notes="Shop drawings not yet marked approved.")
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_windows, zone_ids["Bedroom 1"]))

    a_cladding = add_activity("Eastern elevation cladding", t_cladding, d(4), d(14), blocked=True,
                               blocked_reason="Scaffold modification required before eastern elevation cladding can begin (Apex Scaffold).")
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_cladding, zone_ids["Eastern Elevation"]))

    days_to_thursday = (3 - TODAY.weekday()) % 7  # Mon=0 ... Thu=3
    if days_to_thursday == 0:
        days_to_thursday = 7
    a_kitchen = add_activity("Kitchen measure-up", t_kitchen, d(days_to_thursday), d(days_to_thursday), predecessor_id=a_linings)
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_kitchen, zone_ids["Kitchen"]))

    a_bathroom = add_activity("Waterproofing - Bathroom", t_linings, d(20), d(22))
    conn.execute("INSERT INTO activity_zones (activity_id, zone_id) VALUES (?, ?)", (a_bathroom, zone_ids["Bathroom"]))

    conn.commit()

    # --- attendances ---
    def add_attendance(trade_id, activity_id, day, status, notes=None):
        conn.execute(
            "INSERT INTO attendances (project_id, trade_id, activity_id, date, status, notes) VALUES (?, ?, ?, ?, ?, ?)",
            (project_id, trade_id, activity_id, day, status, notes),
        )

    add_attendance(t_plumbing, a_drainage, d(-3), "complete", "Services set-out")
    add_attendance(t_plumbing, a_drainage, d(11), "confirmed", "Underground drainage")
    add_attendance(t_plumbing, None, d(25), "tentative", None)
    add_attendance(t_plumbing, None, d(68), "not_contacted", None)
    add_attendance(t_plumbing, None, d(84), "not_contacted", None)
    add_attendance(t_windows, a_windows, d(7), "tentative", "Shop drawings not yet approved")
    add_attendance(t_painters, a_paint, d(33), "not_contacted", None)
    add_attendance(t_kitchen, a_kitchen, d(days_to_thursday), "tentative", None)
    conn.commit()

    # --- diary entries (history) ---
    def add_diary(entry_type, text, activity_id=None, author="Site manager", days_ago=0):
        conn.execute(
            """INSERT INTO diary_entries (project_id, entry_type, activity_id, text, author, created_at)
               VALUES (?, ?, ?, ?, ?, datetime('now', ?))""",
            (project_id, entry_type, activity_id, text, author, f"-{days_ago} days"),
        )

    add_diary("system", "Project created and demo drawing set uploaded.", days_ago=12, author="AI assistant")
    add_diary("progress", "Slab pour to Amenities Block completed, no issues.", a_slab, days_ago=8)
    add_diary("progress", "Wall linings underway in Zone B, tracking to programme.", a_linings, days_ago=5)
    add_diary("delay", "Eastern elevation cladding blocked - scaffold needs modifying first.", a_cladding, days_ago=1)
    add_diary("progress", "Wall linings Zone B at 60% - on track for plaster in just over a week.", a_linings, days_ago=0)
    conn.commit()

    # --- photos ---
    p1 = os.path.join(PHOTOS_DIR, f"{uuid.uuid4().hex}.jpg")
    make_photo(p1, "Zone B - Wall linings 60%", (58, 98, 173))
    conn.execute(
        "INSERT INTO photos (project_id, activity_id, zone_id, file_path, caption) VALUES (?, ?, ?, ?, ?)",
        (project_id, a_linings, zone_ids["Zone B - Wall Linings"], os.path.basename(p1), "Wall linings progress - 60% complete"),
    )
    p2 = os.path.join(PHOTOS_DIR, f"{uuid.uuid4().hex}.jpg")
    make_photo(p2, "Services set-out - Amenities Block", (30, 130, 90))
    conn.execute(
        "INSERT INTO photos (project_id, activity_id, zone_id, file_path, caption) VALUES (?, ?, ?, ?, ?)",
        (project_id, a_drainage, zone_ids["Amenities Block"], os.path.basename(p2), "Services set-out complete, ready for drainage"),
    )
    conn.commit()

    # --- AI suggestions (run the heuristics so the Home screen has live prompts) ---
    generate_missing_prereq_suggestions(conn, project_id)
    generate_forecast_shift_suggestions(conn, project_id, a_slab)
    conn.commit()
    conn.close()

    print("Seed complete.")
    print("  Login: demo@sitemanageros.app / demo1234")
    print(f"  Project ID: {project_id}")


if __name__ == "__main__":
    run()
