"""Simple session-based auth (Flask signed cookies + werkzeug password hashing).

Kept deliberately simple for the V0.1 build: one user can own/manage
multiple projects. No roles/permissions beyond 'owns the project' yet -
the product doc lists "should subcontractors get restricted logins" as an
open product decision, not an MVP requirement.
"""
from functools import wraps
from flask import session, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from db import get_db


def hash_password(password):
    return generate_password_hash(password)


def verify_password(password, password_hash):
    return check_password_hash(password_hash, password)


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    if getattr(g, "_user_cache", None) and g._user_cache["id"] == user_id:
        return g._user_cache
    conn = get_db()
    user = conn.execute("SELECT id, email, name, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if user:
        g._user_cache = dict(user)
        return g._user_cache
    return None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "Not authenticated"}), 401
        return fn(*args, **kwargs)
    return wrapper


def project_access_required(fn):
    """Requires the authenticated user to be the owner (or a member) of the
    :project_id: in the route. Attaches nothing extra - handlers look up
    data themselves - this just guards access."""
    @wraps(fn)
    def wrapper(project_id, *args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "Not authenticated"}), 401
        conn = get_db()
        row = conn.execute(
            """SELECT 1 FROM projects WHERE id = ? AND owner_user_id = ?
               UNION SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?""",
            (project_id, user["id"], project_id, user["id"]),
        ).fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "Not found"}), 404
        return fn(project_id, *args, **kwargs)
    return wrapper
