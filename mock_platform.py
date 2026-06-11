#!/usr/bin/env python3
"""
SMS Ride-Along Review — Mock Platform / Test Harness
=====================================================
A disposable stand-in for the full SkillCat platform. Implements the API
contract (sms_ridealong_platform_api_contract.md), seeds an in-memory-ish
SQLite DB on boot, and serves the existing dashboard prototype with a live
wiring script injected so the ride-along slice reads from this mock.

Run:
    pip install flask
    python mock_platform.py
    # open http://localhost:5000

The prototype file is resolved from $PROTOTYPE_PATH, else ./manager_dashboard.html,
else ../manager_dashboard.html.

This is throwaway. No real auth, no real data. SQLite file is recreated on boot.
"""

import os, json, sqlite3, hmac, hashlib, base64, datetime, pathlib
from flask import Flask, request, jsonify, Response, abort

APP = Flask(__name__)


# Mock-only CORS: lets a separately-hosted mini-app call the API cross-origin.
# (It's a mock with fake data — wide-open is fine here, not for production.)
@APP.after_request
def _cors(resp):
    if request.path.startswith("/api/"):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@APP.route("/api/<path:_any>", methods=["OPTIONS"])
def _preflight(_any):
    return ("", 204)


DB_PATH = os.environ.get("MOCK_DB", "mock_platform.db")
TOKEN_SECRET = b"mock-shared-secret-not-for-production"
COMPANY_ID = "co_test"
MINIAPP_URL = os.environ.get("MINIAPP_URL", "")

HERE = pathlib.Path(__file__).resolve().parent
LIVE_SCRIPT = HERE / "ridealong-live.js"


# ----------------------------------------------------------------------------- DB
def db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    c = db()
    c.executescript("""
    CREATE TABLE companies   (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE managers     (id TEXT PRIMARY KEY, company_id TEXT, name TEXT,
                               phone TEXT, sms_opt_in INTEGER);
    CREATE TABLE technicians  (id TEXT PRIMARY KEY, company_id TEXT, name TEXT,
                               field_readiness_state TEXT,
                               field_readiness_set_by TEXT,
                               field_readiness_set_at TEXT);
    CREATE TABLE reviews      (id TEXT PRIMARY KEY, company_id TEXT,
                               manager_id TEXT, technician_id TEXT,
                               created_at TEXT, status TEXT, readiness TEXT,
                               note TEXT, channel TEXT, completed_at TEXT,
                               todo_id TEXT, batch_id TEXT);
    CREATE TABLE todos        (id TEXT PRIMARY KEY, company_id TEXT,
                               manager_id TEXT, review_id TEXT,
                               status TEXT, created_at TEXT);
    """)
    # --- seed -----------------------------------------------------------------
    # Technicians intentionally match people that exist in the prototype so a
    # review lands on a real Person Detail page (David Kim is the prototype's
    # hardcoded person detail).
    c.execute("INSERT INTO companies VALUES (?,?)", (COMPANY_ID, "Northeast HVAC"))

    managers = [
        # id,       name,         phone,           sms_opt_in
        ("mgr_eric", "Eric Park",  os.environ.get("TEST_PHONE", "+15555550100"), 1),
        ("mgr_maria","Maria Lopez", "+15555550199", 0),   # app-only path
    ]
    c.executemany("INSERT INTO managers VALUES (?,?,?,?,?)",
                  [(m[0], COMPANY_ID, m[1], m[2], m[3]) for m in managers])

    technicians = [
        ("tech_david",  "David Kim"),
        ("tech_amanda", "Amanda Lee"),
        ("tech_sarah",  "Sarah Johnson"),
    ]
    c.executemany("INSERT INTO technicians VALUES (?,?,?,?,?,?)",
                  [(t[0], COMPANY_ID, t[1], None, None, None) for t in technicians])
    c.commit()
    c.close()
    print(f"[mock] seeded DB at {DB_PATH} "
          f"(opt-in manager phone = {managers[0][2]}; set TEST_PHONE to override)")


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def new_id(prefix):
    return prefix + "_" + base64.urlsafe_b64encode(os.urandom(6)).decode().rstrip("=")


def review_dict(r):
    return {
        "review_id": r["id"], "company_id": r["company_id"],
        "manager_id": r["manager_id"], "technician_id": r["technician_id"],
        "created_at": r["created_at"], "status": r["status"],
        "readiness": r["readiness"], "note": r["note"], "channel": r["channel"],
        "completed_at": r["completed_at"], "todo_id": r["todo_id"],
    }


def check_company(cid):
    if cid != COMPANY_ID:
        abort(403, description="company_id not authorized for this caller")


# ------------------------------------------------------------------- CONTRACT API
@APP.get("/api/ride-along/roster")
def roster():
    cid = request.args.get("company_id", "")
    check_company(cid)
    c = db()
    managers = [dict(id=m["id"], name=m["name"], phone=m["phone"],
                     sms_opt_in=bool(m["sms_opt_in"]))
                for m in c.execute("SELECT * FROM managers WHERE company_id=?", (cid,))]
    techs = [dict(id=t["id"], name=t["name"])
             for t in c.execute("SELECT * FROM technicians WHERE company_id=?", (cid,))]
    c.close()
    return jsonify(company_id=cid, managers=managers, technicians=techs)


@APP.post("/api/ride-along/review-batch")
def review_batch():
    body = request.get_json(force=True)
    cid = body.get("company_id", "")
    check_company(cid)
    batch_id = body.get("batch_id")
    if not batch_id:
        abort(400, description="batch_id required (idempotency key)")

    c = db()
    # Idempotency: if this batch_id already exists, return the original set.
    existing = c.execute("SELECT * FROM reviews WHERE batch_id=?", (batch_id,)).fetchall()
    if existing:
        created = [_created_row(c, r) for r in existing]
        c.close()
        return jsonify(batch_id=batch_id, created=created)

    created = []
    for item in body.get("reviews", []):
        mgr = c.execute("SELECT * FROM managers WHERE id=?",
                        (item["manager_id"],)).fetchone()
        rid = new_id("rev")
        tid = new_id("td")
        c.execute("INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (rid, cid, item["manager_id"], item["technician_id"],
                   now_iso(), "pending", None, None, None, None, tid, batch_id))
        c.execute("INSERT INTO todos VALUES (?,?,?,?,?,?)",
                  (tid, cid, item["manager_id"], rid, "open", now_iso()))
        eligible = bool(mgr and mgr["sms_opt_in"] and mgr["phone"])
        created.append({
            "review_id": rid, "manager_id": item["manager_id"],
            "technician_id": item["technician_id"], "todo_id": tid,
            "sms_eligible": eligible,
            "manager_phone": mgr["phone"] if eligible else None,
        })
    c.commit()
    c.close()
    return jsonify(batch_id=batch_id, created=created)


def _created_row(c, r):
    mgr = c.execute("SELECT * FROM managers WHERE id=?", (r["manager_id"],)).fetchone()
    eligible = bool(mgr and mgr["sms_opt_in"] and mgr["phone"])
    return {"review_id": r["id"], "manager_id": r["manager_id"],
            "technician_id": r["technician_id"], "todo_id": r["todo_id"],
            "sms_eligible": eligible, "manager_phone": mgr["phone"] if eligible else None}


@APP.get("/api/ride-along/reviews/<review_id>")
def get_review(review_id):
    c = db()
    r = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    c.close()
    if not r:
        abort(404)
    return jsonify(review_dict(r))


@APP.post("/api/ride-along/reviews/<review_id>/result")
def write_result(review_id):
    body = request.get_json(force=True)
    check_company(body.get("company_id", ""))
    c = db()
    r = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    if not r:
        c.close(); abort(404)
    if r["status"] == "complete":
        # Channel race — already completed (e.g. in-app). Return existing record.
        existing = review_dict(r)
        c.close()
        return jsonify(existing), 409
    c.execute("""UPDATE reviews SET status='complete', readiness=?, note=?,
                 channel=?, completed_at=? WHERE id=?""",
              (body.get("readiness"), body.get("note"),
               body.get("channel", "sms"),
               body.get("completed_at", now_iso()), review_id))
    c.execute("UPDATE todos SET status='resolved' WHERE review_id=?", (review_id,))
    c.commit()
    r = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    c.close()
    return jsonify(review_dict(r))


@APP.get("/api/config")
def app_config():
    """Runtime config consumed by the dashboard prototype — lets the served HTML
    discover the mini-app's URL without hardcoding it."""
    return jsonify(miniapp_url=MINIAPP_URL, company_id=COMPANY_ID)


FIELD_READINESS_STATES = ("go", "evaluate", "nogo")


def _field_readiness_dict(row):
    return {
        "state": row["field_readiness_state"] or "evaluate",
        "set_by": row["field_readiness_set_by"],
        "set_at": row["field_readiness_set_at"],
    }


@APP.get("/api/technicians/<technician_id>/field-readiness")
def get_field_readiness(technician_id):
    """Read a technician's Field Readiness. Defaults to 'evaluate' when unset.
    Returns the full {state, set_by, set_at} envelope so the dashboard can
    surface attribution next to the indicator."""
    c = db()
    row = c.execute("SELECT * FROM technicians WHERE id=?", (technician_id,)).fetchone()
    c.close()
    if not row:
        abort(404)
    return jsonify(_field_readiness_dict(row))


@APP.patch("/api/technicians/<technician_id>/field-readiness")
def patch_field_readiness(technician_id):
    """Manager sets the Field Readiness state. Records set_by + set_at.

    Body: {"state": "go"|"evaluate"|"nogo", "set_by"?: "<user_id>"}.
    Auth TODO: only managers/admins on this company should be allowed to set
    this — the mock accepts any caller until real auth is wired."""
    body = request.get_json(force=True) or {}
    state = (body.get("state") or "").strip().lower()
    if state not in FIELD_READINESS_STATES:
        abort(400, description="state must be one of " + ", ".join(FIELD_READINESS_STATES))
    set_by = (body.get("set_by") or "").strip() or "unknown_user"
    c = db()
    row = c.execute("SELECT * FROM technicians WHERE id=?", (technician_id,)).fetchone()
    if not row:
        c.close(); abort(404)
    set_at = now_iso()
    c.execute("""UPDATE technicians
                 SET field_readiness_state=?, field_readiness_set_by=?, field_readiness_set_at=?
                 WHERE id=?""", (state, set_by, set_at, technician_id))
    c.commit()
    updated = c.execute("SELECT * FROM technicians WHERE id=?", (technician_id,)).fetchone()
    c.close()
    return jsonify(_field_readiness_dict(updated))


@APP.patch("/api/managers/<manager_id>")
def update_manager(manager_id):
    """Update a manager's phone. Used by the Test Roster admin page so testers
    can point SMS at their own phone without redeploying the mock.

    Body: {"phone": "+1XXXXXXXXXX"}. Light E.164 validation. Edits are lost on
    every redeploy / restart (mock seeds on import — by design)."""
    body = request.get_json(force=True) or {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        abort(400, description="phone required")
    # Light E.164 check: leading '+' then 8-15 digits.
    digits = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not (digits.startswith("+") and digits[1:].isdigit() and 8 <= len(digits[1:]) <= 15):
        abort(400, description="phone must be E.164 (e.g. +19178264055)")
    c = db()
    row = c.execute("SELECT * FROM managers WHERE id=?", (manager_id,)).fetchone()
    if not row:
        c.close(); abort(404)
    c.execute("UPDATE managers SET phone=? WHERE id=?", (digits, manager_id))
    c.commit()
    updated = c.execute("SELECT * FROM managers WHERE id=?", (manager_id,)).fetchone()
    c.close()
    return jsonify(id=updated["id"], name=updated["name"], phone=updated["phone"],
                   sms_opt_in=bool(updated["sms_opt_in"]))


@APP.get("/api/token")
def token():
    """Mint a signed iframe context token (models the real JWT handshake)."""
    cid = request.args.get("company_id", COMPANY_ID)
    uid = request.args.get("user_id", "user_admin")
    payload = {"user_id": uid, "company_id": cid, "role": "admin",
               "exp": now_iso()}
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=")
    sig = hmac.new(TOKEN_SECRET, raw, hashlib.sha256).digest()
    sig_b = base64.urlsafe_b64encode(sig).rstrip(b"=")
    return jsonify(token=(raw + b"." + sig_b).decode(), claims=payload)


# ------------------------------------------------------------- READ HELPERS (UI)
@APP.get("/api/ride-along/reviews")
def list_reviews():
    cid = request.args.get("company_id", COMPANY_ID)
    tname = request.args.get("technician_name")
    c = db()
    q = """SELECT r.*, m.name AS manager_name, t.name AS technician_name
           FROM reviews r
           JOIN managers m ON m.id = r.manager_id
           JOIN technicians t ON t.id = r.technician_id
           WHERE r.company_id=?"""
    args = [cid]
    if tname:
        q += " AND t.name = ?"; args.append(tname)
    q += " ORDER BY r.created_at DESC"
    rows = c.execute(q, args).fetchall()
    c.close()
    out = []
    for r in rows:
        d = review_dict(r)
        d["manager_name"] = r["manager_name"]
        d["technician_name"] = r["technician_name"]
        out.append(d)
    return jsonify(reviews=out)


@APP.get("/api/ride-along/todos")
def list_todos():
    cid = request.args.get("company_id", COMPANY_ID)
    c = db()
    rows = c.execute("""
        SELECT td.*, m.name AS manager_name, t.name AS technician_name,
               r.status AS review_status, r.readiness AS readiness
        FROM todos td
        JOIN reviews r ON r.id = td.review_id
        JOIN managers m ON m.id = td.manager_id
        JOIN technicians t ON t.id = r.technician_id
        WHERE td.company_id=? ORDER BY td.created_at DESC""", (cid,)).fetchall()
    c.close()
    return jsonify(todos=[dict(
        id=r["id"], review_id=r["review_id"], status=r["status"],
        manager_name=r["manager_name"], technician_name=r["technician_name"],
        review_status=r["review_status"], readiness=r["readiness"],
        created_at=r["created_at"]) for r in rows])


# --------------------------------------------------------------------- DEBUG API
@APP.get("/api/debug/state")
def debug_state():
    c = db()
    reviews = [dict(r) for r in c.execute("SELECT * FROM reviews ORDER BY created_at DESC")]
    todos = [dict(r) for r in c.execute("SELECT * FROM todos ORDER BY created_at DESC")]
    c.close()
    return jsonify(reviews=reviews, todos=todos)


@APP.post("/api/debug/reviews/<review_id>/complete-in-app")
def debug_complete_in_app(review_id):
    """Simulate the manager completing this review IN THE APP (not via SMS).
    This is the cross-channel test affordance."""
    c = db()
    r = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    if not r:
        c.close(); abort(404)
    if r["status"] == "complete":
        c.close(); return jsonify(error="already complete"), 409
    readiness = request.args.get("readiness", "ready")
    c.execute("""UPDATE reviews SET status='complete', readiness=?, channel='app',
                 completed_at=? WHERE id=?""", (readiness, now_iso(), review_id))
    c.execute("UPDATE todos SET status='resolved' WHERE review_id=?", (review_id,))
    c.commit()
    r = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    c.close()
    # (If a mini-app webhook URL were configured we'd POST review-completed here.)
    return jsonify(review_dict(r))


@APP.post("/api/debug/reset")
def debug_reset():
    init_db()
    return jsonify(ok=True)


# ------------------------------------------------------- STATIC: prototype + JS
def resolve_prototype():
    for p in [os.environ.get("PROTOTYPE_PATH"),
              HERE / "manager_dashboard.html",
              HERE.parent / "manager_dashboard.html"]:
        if p and os.path.exists(p):
            return str(p)
    return None


@APP.get("/")
def serve_prototype():
    path = resolve_prototype()
    if not path:
        return ("<h1>Prototype not found</h1><p>Set PROTOTYPE_PATH or place "
                "manager_dashboard.html next to mock_platform.py.</p>"), 404
    html = pathlib.Path(path).read_text(encoding="utf-8")
    inject = '\n<script src="/ridealong-live.js"></script>\n'
    html = html + inject  # prototype ends with </script>, no </body>; append is safe
    return Response(html, mimetype="text/html")


@APP.get("/ridealong-live.js")
def serve_live_js():
    if not LIVE_SCRIPT.exists():
        return ("// ridealong-live.js missing", 404,
                {"Content-Type": "application/javascript"})
    return Response(LIVE_SCRIPT.read_text(encoding="utf-8"),
                    mimetype="application/javascript")


# Seed at import time so it works regardless of how the host starts the app
# (python mock_platform.py, gunicorn, Railway's auto-detected entrypoint).
init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[mock] http://0.0.0.0:{port}  (API /api/ride-along, debug /api/debug)")
    APP.run(host="0.0.0.0", port=port, debug=False)
