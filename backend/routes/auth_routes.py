from flask import Blueprint, request, jsonify, session
from db import get_db
from auth import hash_password, verify_password, current_user

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.post("/register")
def register():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()
    if not email or not password or not name:
        return jsonify({"error": "email, password and name are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "An account with that email already exists"}), 409

    cur = conn.execute(
        "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
        (email, hash_password(password), name),
    )
    conn.commit()
    user_id = cur.lastrowid
    conn.close()
    session["user_id"] = user_id
    return jsonify({"id": user_id, "email": email, "name": name}), 201


@bp.post("/login")
def login():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid email or password"}), 401
    session["user_id"] = user["id"]
    return jsonify({"id": user["id"], "email": user["email"], "name": user["name"]})


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.get("/me")
def me():
    user = current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    return jsonify(user)
