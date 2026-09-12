import os
from flask import Flask, send_from_directory, jsonify

from db import init_db, DB_PATH
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
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB upload cap

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
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
