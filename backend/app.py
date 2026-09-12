import os
from flask import Flask, send_from_directory, jsonify

from db import init_db, get_db, DB_PATH, _migrate
from routes.auth_routes import bp as auth_bp
from routes.project_routes import bp as project_bp
from routes.trade_routes import bp as trade_bp
from routes.activity_routes import bp as activity_bp
from routes.photo_routes import bp as photo_bp
from routes.diary_routes import bp as diary_bp
from routes.report_routes import bp as report_bp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me-in-production")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 150 * 1024 * 1024  # real multi-sheet drawing set PDFs can be large

app.register_blueprint(auth_bp)
app.register_blueprint(project_bp)
app.register_blueprint(trade_bp)
app.register_blueprint(activity_bp)
app.register_blueprint(photo_bp)
app.register_blueprint(diary_bp)
app.register_blueprint(report_bp)


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.errorhandler(413)
def too_large(e):
    max_mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
    return jsonify({"error": f"That file is larger than the {max_mb}MB upload limit."}), 413


@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:path>")
def static_proxy(path):
    full_path = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(full_path):
        return send_from_directory(FRONTEND_DIR, path)
    # SPA fallback for client-side hash routing
    return send_from_directory(FRONTEND_DIR, "index.html")


if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        print("No database found - creating one with demo data (run `python3 seed.py` any time to reset it).")
        import seed
        seed.run()
    else:
        # Existing database from a previous run/version - apply any pending
        # non-destructive schema migrations (e.g. newly added columns).
        _conn = get_db()
        _migrate(_conn)
        _conn.close()
    port = int(os.environ.get("PORT", 8000))
    # threaded=True: uploads kick off a background thread to rasterize
    # drawing pages (see routes/project_routes.py), so the server needs to
    # keep serving other requests (like polling for that thread's progress)
    # while it runs rather than blocking on a single request at a time.
    app.run(host="0.0.0.0", port=port, debug=True, threaded=True)
