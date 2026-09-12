# Site Manager OS — v0.1

A working build of the product described in `Site_Manager_OS_Product_Overview_v0.1.pdf`:
a site-management app built around the idea that **the drawings should be the
live interface for the project** — not a static PDF, not a separate spreadsheet.

This is a real, running full-stack app (not a mockup): a Python/Flask API backend with
a SQLite database, and a plain-JavaScript frontend, wired together end-to-end.

## Quick start

Requirements: Python 3.9+ with `pip`. That's it — no Node.js, no build step, no
external services.

```bash
cd backend
pip install -r requirements.txt   # Flask, pypdf, openpyxl, reportlab, Pillow
python3 app.py                    # starts the server on http://localhost:8000
```

The first run automatically creates a SQLite database seeded with a demo project. Run
`python3 seed.py` at any time to wipe it back to that same fresh demo state.

Open **http://localhost:8000** and log in with:

```
demo@sitemanageros.app / demo1234
```

The demo project ("Riverside Townhouses") is seeded with a sample drawing set, work-face
zones, trades, a programme, attendances and AI look-ahead prompts — deliberately built to
mirror the worked examples in the product doc (ABC Plumbing, Zone B wall linings, the
blocked eastern elevation cladding, etc.) so you can see the concept working immediately.

The `pdftoppm` command (from `poppler-utils`) is used to turn uploaded PDF drawing
sheets into images for the Plans viewer. It's pre-installed on most Linux/macOS dev
machines; on Debian/Ubuntu, `apt install poppler-utils` if it's missing.

## What's implemented (maps to the doc's "Version 0.1 — MVP" scope, page 9)

| Doc requirement | Status |
|---|---|
| Drawing import (PDF upload, sheet recognition) | ✅ Upload a PDF; each page is indexed, with a best-guess sheet number/title/type read from the drawing's own text. Guesses are flagged "AI guess — review" until confirmed. |
| Manual + AI-assisted zone creation | ✅ Drag directly on the rendered sheet to draw a work-face zone. |
| Programme import (Excel/CSV) | ✅ Task, trade, planned dates, duration, predecessor. Unknown trades are created automatically. |
| Work-face links | ✅ Activities link to one or more zones; zone color reflects the most urgent linked activity's status. |
| Status overlay (Complete/Active/Ready/Not Ready/Blocked) | ✅ Computed live from planned/forecast/actual dates and predecessor state — see `backend/status_engine.py`. |
| Task detail (dates, progress, notes, blockers) | ✅ Slide-over drawer from any screen. |
| Photos | ✅ Attach to a task; shows on the task and in daily reports. |
| Trade profiles (visits, confirmation, upcoming work) | ✅ Including the 8-item preparation checklist from the doc (book/invite, materials, shop drawings, access, etc). |
| Look-ahead diary (today / 2-week / 6-week) | ✅ |
| AI assistant (index drawings, interpret schedule, suggest links, summarise, flag risk) | ✅ Rule-based v0.1 implementation — see "About the AI" below. |
| Change history | ✅ Every field edit is logged (`change_log` table) and progress/delay/attendance events are written to the Site Diary automatically. |

Deliberately **not** built yet, matching the doc's "Not required for MVP" list: full BIM/3D,
computer-vision progress measurement, drone/360 integration, automatic subcontractor
messaging, cost control, or automatic construction-method generation.

## About the "AI" in this build

The product doc is explicit that AI here means *narrow, reviewable* assistance — not a
model that quietly rewrites the programme. This build honours that literally:

- **Sheet recognition** (`backend/pdf_parse.py`) reads each PDF page's text and pattern-matches
  a likely sheet number / title / type. No LLM call — just text extraction + regex, exactly
  the kind of "recognise sheet names and drawing types" behaviour on the doc's "AI should do" list.
- **Look-ahead prompts** and **forecast-shift suggestions** (`backend/status_engine.py`) are a
  small rules engine: when an activity's actual dates change, it looks at whatever names it as
  a predecessor and proposes a new forecast date for review — it never overwrites anything by
  itself. Try it: open any activity in the demo, set an "Actual end" date, save, then check the
  Home screen — you'll see a new suggestion with an **Accept / Dismiss** choice. This is the
  "a task slips" workflow from page 5 of the doc, implemented end-to-end.
- There's no call out to an LLM API anywhere in this build (so it runs with zero API keys and
  zero ongoing cost). The `ai_suggestions` table and the accept/dismiss flow are the seam where
  a real LLM (e.g. the Claude API) could be dropped in later — for richer drawing understanding,
  natural-language diary summaries, or smarter sequencing — without changing the review model.

## Architecture notes

- **Backend**: Flask + Python's built-in `sqlite3` (no ORM). One `backend/schema.sql`, one
  `backend/data/site_manager.db` file. Session-cookie auth (`werkzeug.security` password
  hashing) — no third-party auth service.
- **Frontend**: plain JavaScript (ES modules, no React/Vue, no bundler) + hand-written CSS.
  This was a deliberate choice, not a shortcut: it means the whole app is view-source-able,
  has zero `npm install` surface, and works the same on a five-year-old laptop in a site
  office as it does anywhere else. PDF pages are rasterized to PNG server-side (via
  `pdftoppm`) rather than parsed in the browser, so the Plans screen works in any browser
  without a client-side PDF engine.
- **Storage**: uploaded drawings/photos live under `backend/uploads/`; everything else is in
  the SQLite file. Both are trivial to back up (copy the folder) or migrate to S3/Postgres later.

## Project structure

```
backend/
  app.py            Flask app + route registration
  schema.sql         Database schema
  db.py              SQLite connection helpers
  auth.py            Session auth
  status_engine.py    Five-state status computation + AI suggestion rules
  pdf_parse.py        Sheet-number/title recognition + PDF→PNG rendering
  xlsx_parse.py        Programme (Excel/CSV) import
  seed.py             Demo data generator
  routes/             API blueprints (auth, projects, drawings/zones, trades, activities, photos, diary, reports)
frontend/
  index.html
  css/style.css
  js/
    app.js            Router + app shell
    api.js             Fetch wrapper for the backend API
    dom.js              Small DOM-building helper (no JSX/build step)
    pages/              One module per screen
    components/         Shared UI (the activity detail drawer)
```

## Suggested next steps

1. **Try it as a real site manager would** — walk through Workflow 1 (upload your own
   drawings + programme) and Workflow 2 (a Monday-morning check of Home) from the doc, and
   see where it falls short of how you actually work. That feedback is worth more than any
   more features right now.
2. **Deploy it somewhere reachable from a phone on site.** This runs anywhere Python does —
   a small VPS, Render, Railway, Fly.io, or a Raspberry Pi in the site office all work. The
   dev server (`python3 app.py`) is fine for trying it out; for real use, run it behind a
   production WSGI server (`gunicorn`/`waitress`) and switch `SECRET_KEY` to a real secret.
3. **Move to Postgres** once more than one person needs to write at the same time — SQLite is
   fine for one site manager on one device, less fine for a whole site team hitting it at once.
4. **Decide the open product questions from page 11 of the doc** (working name, mobile-first
   vs desktop-first, subcontractor logins, revised-drawing handling) — several of those change
   the data model, so worth settling before this grows much further.
5. **When ready for real AI**, the `ai_suggestions` review flow is the intended integration
   point — swap the rules in `status_engine.py` for calls to an LLM without changing anything
   about how suggestions are surfaced or approved.
