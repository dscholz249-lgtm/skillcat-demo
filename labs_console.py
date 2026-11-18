"""
Labs Console — "Beta Demo Dashboard" (PRD-539, PRD-547)
=======================================================
This app never waits on the Console (product-experiment-console).

Daily snapshot (PRD-539). Once a day a Railway cron hits
POST /api/internal/labs-metrics, which posts two signed events for yesterday
(UTC day, as the Console's other products do):

  * metrics.daily           who the Beta Group is, and who used it
  * metrics.activity.daily  what they did

The Beta Group and who's in it (PRD-547). The Beta Group is kept on the
Console's People page:

  * Every 10 minutes this app reads it (signed GET /v1/beta-group) and stores
    it in beta.db. Sign-in only ever reads the stored copy, so a Console outage
    never blocks anyone. BETA_EMAILS still adds one-off testers on top.
  * A tester's first sign-in is sent as user.registered (external_user_id is
    their email), and losing access as user.removed, so the People page shows
    who is in this experiment. Sent in the background, retried by the sync.
  * The Console's Update button calls POST /api/labs/refresh (register it as
    the product's refresh_url) to re-send today's snapshot.

The users are the Beta Group testers (the Console's Beta Group plus $BETA_EMAILS). SkillCat staff on the
internal demo are never tracked (beta.py), so they never count. A tester is
"active" on a day with any tracked screen view, time on a screen, click or
note — the same journey data the 11:55pm Slack report reads.

Rules from the Console's integration doc: unconfigured is a no-op, every
failure is swallowed, and only identifiers and counts are sent — never note
text or click labels.

Environment:
  LABS_CONSOLE_PRODUCT_ID   this product's id in the Console
  LABS_CONSOLE_SECRET       signing secret (shown once at registration; never commit it)
  LABS_CONSOLE_ENDPOINT     optional; defaults to the production Console
  CRON_SECRET               bearer token the cron sends (shared with the daily report)
"""

import os, json, hmac, uuid, time, hashlib, datetime, threading, urllib.request, urllib.error
from flask import Blueprint, request, jsonify, abort

import beta

DEFAULT_ENDPOINT = "https://product-experiment-console-production.up.railway.app/v1/events"
UTC = datetime.timezone.utc

labs_bp = Blueprint("labs_console", __name__)


# ------------------------------------------------------------------- the helper
def labs_event(event_type, data, event_id=None, occurred_at=None):
    """Post one signed event. Returns {ok, status, body}, or None when the
    Console isn't configured. Never raises. Pass event_id to make a resend
    idempotent (the Console ignores an id it has seen)."""
    product_id = os.environ.get("LABS_CONSOLE_PRODUCT_ID")
    secret = os.environ.get("LABS_CONSOLE_SECRET")
    if not product_id or not secret:
        return None
    try:
        # Sign the exact bytes sent, not a re-serialized object.
        body = json.dumps({
            "event_id": event_id or str(uuid.uuid4()),
            "event_type": event_type,
            "occurred_at": occurred_at or datetime.datetime.now(UTC).isoformat(timespec="seconds"),
            "product_id": product_id,
            "data": data,
        }).encode()
        ts = str(int(time.time()))
        sig = hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
        req = urllib.request.Request(
            os.environ.get("LABS_CONSOLE_ENDPOINT") or DEFAULT_ENDPOINT, data=body, method="POST",
            headers={"Content-Type": "application/json", "X-Labs-Product": product_id,
                     "X-Labs-Timestamp": ts, "X-Labs-Signature": f"v1={sig}"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return {"ok": r.status in (200, 202), "status": r.status, "body": r.read(500).decode("utf-8", "replace")}
        except urllib.error.HTTPError as e:
            return {"ok": False, "status": e.code, "body": e.read(500).decode("utf-8", "replace")}
    except Exception as e:
        print("[labs] console event failed:", e)
        return {"ok": False, "status": None, "body": str(e)}


# ------------------------------------------------------------------- the snapshot
def _utc_day(iso):
    try:
        return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC).date()
    except (ValueError, AttributeError):
        return None


# Retention windows, in days after a tester's first active day (Console definition).
WINDOWS = {"d1": (1, 1), "w1": (7, 13), "m1": (30, 59), "m6": (180, 209)}


def snapshot(day):
    """Both payloads for one UTC day, from beta.db."""
    c = beta._db()
    events = c.execute("SELECT at, email, sid, type, ms FROM events").fetchall()
    notes = c.execute("SELECT at, email FROM notes").fetchall()
    c.close()

    active_days = {}  # email -> set of UTC days with any activity, up to `day`
    last_active = None
    activity = {"Screen views": 0, "Clicks": 0, "Notes": 0, "Sessions": 0, "Minutes on screens": 0}
    sessions, ms_today = set(), 0
    for row in [*events, *notes]:
        d = _utc_day(row["at"])
        if not d or d > day or not row["email"]:
            continue
        active_days.setdefault(row["email"].lower(), set()).add(d)
        if last_active is None or row["at"] > last_active:
            last_active = row["at"]
        if d != day:
            continue
        kind = row["type"] if "type" in row.keys() else "note"
        if kind == "view":
            activity["Screen views"] += 1
        elif kind == "click":
            activity["Clicks"] += 1
        elif kind == "time":
            ms_today += row["ms"] or 0
        elif kind == "note":
            activity["Notes"] += 1
        if kind != "note" and row["sid"]:
            sessions.add((row["email"], row["sid"]))
    activity["Sessions"] = len(sessions)
    activity["Minutes on screens"] = round(ms_today / 60000)

    approved = beta.approved_emails()
    month_start = day - datetime.timedelta(days=29)
    active_ever = {e for e in active_days if e in approved}

    retention, since = {}, min((min(ds) for ds in active_days.values()), default=None)
    if since:
        retention["since"] = since.isoformat()
        for key, (lo, hi) in WINDOWS.items():
            eligible = retained = 0
            for ds in active_days.values():
                first = min(ds)
                if first + datetime.timedelta(days=hi) > day:
                    continue
                eligible += 1
                if any(lo <= (d - first).days <= hi for d in ds):
                    retained += 1
            retention[key] = {"eligible": eligible, "retained": retained}

    daily = {
        "as_of_date": day.isoformat(),
        "total_users": len(approved),
        "dau": sum(1 for ds in active_days.values() if day in ds),
        "mau": sum(1 for ds in active_days.values() if any(month_start <= d <= day for d in ds)),
        "breakdown": {"Active to date": len(active_ever), "Not yet active": len(approved - active_ever)},
    }
    if last_active:
        daily["last_active_at"] = last_active
    if retention:
        daily["retention"] = retention
    return daily, {"as_of_date": day.isoformat(), "activity": activity}


@labs_bp.post("/api/internal/labs-metrics")
def labs_metrics():
    """Cron: yesterday's snapshot to the Console. ?day=YYYY-MM-DD for another
    day, ?dry_run=1 to see the payloads without sending."""
    secret = os.environ.get("CRON_SECRET")
    if not secret or not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {secret}"):
        abort(401)
    try:
        day = (datetime.date.fromisoformat(request.args["day"]) if request.args.get("day")
               else datetime.datetime.now(UTC).date() - datetime.timedelta(days=1))
    except ValueError:
        return jsonify(error="day must be YYYY-MM-DD"), 400
    daily, activity = snapshot(day)
    if request.args.get("dry_run") == "1":
        return jsonify(dry_run=True, daily=daily, activity=activity)
    sent = labs_event("metrics.daily", daily)
    if sent is None:
        return jsonify(skipped="LABS_CONSOLE_PRODUCT_ID / LABS_CONSOLE_SECRET not set", daily=daily, activity=activity)
    activity_sent = labs_event("metrics.activity.daily", activity)
    ok = sent["ok"] and bool(activity_sent and activity_sent["ok"])
    return jsonify(console_status=sent["status"], console_response=sent["body"],
                   activity_status=activity_sent and activity_sent["status"],
                   daily=daily, activity=activity), (200 if ok else 502)


# ------------------------------------------------------------------- Beta Group (PRD-547)
SYNC_EVERY = 600  # seconds
_synced = set()   # the Beta Group as of the last good read
_lock = threading.Lock()


def _creds():
    pid = (os.environ.get("LABS_CONSOLE_PRODUCT_ID") or "").strip()
    secret = (os.environ.get("LABS_CONSOLE_SECRET") or "").strip()
    return (pid, secret) if pid and secret else None


def _base_url():
    endpoint = os.environ.get("LABS_CONSOLE_ENDPOINT") or DEFAULT_ENDPOINT
    return endpoint.rstrip("/").removesuffix("/v1/events")


def _sign(secret, ts, body):
    return "v1=" + hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()


def init():
    """From beta.setup(): tables, the stored list, and the sync thread."""
    c = beta._db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS beta_list (email TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS labs_meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS console_members (email TEXT PRIMARY KEY, registered_at TEXT,
                                                sent INTEGER DEFAULT 0, removed_at TEXT);
    """)
    rows = c.execute("SELECT email FROM beta_list").fetchall()
    c.close()
    with _lock:
        _synced.clear()
        _synced.update(r["email"] for r in rows)
    if _creds() and not os.environ.get("LABS_NO_SYNC"):
        threading.Thread(target=_loop, name="labs-sync", daemon=True).start()


def synced_emails():
    with _lock:
        return set(_synced)


def _loop():
    while True:
        try:
            sync_once()
        except Exception as e:  # keep the last good list; try again next round
            print("[labs] Beta Group sync failed:", e)
        time.sleep(SYNC_EVERY)


def sync_once():
    """Read the Beta Group, store it, then settle memberships with the Console.
    Raises on a failed read so the stored list is left alone."""
    creds = _creds()
    if not creds:
        return
    pid, secret = creds
    ts = str(int(time.time()))
    req = urllib.request.Request(
        _base_url() + "/v1/beta-group",
        headers={"X-Labs-Product": pid, "X-Labs-Timestamp": ts, "X-Labs-Signature": _sign(secret, ts, ""),
                 "User-Agent": "skillcat-demo/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read() or b"{}")
    emails = {str(e).strip().lower() for e in data.get("emails", []) if str(e).strip()}
    c = beta._db()
    c.execute("DELETE FROM beta_list")
    c.executemany("INSERT INTO beta_list VALUES (?)", [(e,) for e in sorted(emails)])
    c.execute("INSERT OR REPLACE INTO labs_meta VALUES ('last_sync', ?)", (beta.now_iso(),))
    c.commit()
    c.close()
    with _lock:
        _synced.clear()
        _synced.update(emails)
    settle()
    print(f"[labs] Beta Group synced: {len(emails)} emails")


def settle():
    """Retry unsent registrations, and tell the Console about anyone who lost access."""
    c = beta._db()
    members = c.execute("SELECT * FROM console_members WHERE removed_at IS NULL").fetchall()
    c.close()
    for m in members:
        if beta.role_for(m["email"]) != "beta":
            _member_event(m["email"], m["registered_at"], removed=True)
        elif not m["sent"]:
            _member_event(m["email"], m["registered_at"])


def _member_event(email, registered_at, removed=False):
    # Ids derived from the registration, so a retry is a no-op at the Console
    # but a later re-registration is a new event.
    key = hashlib.sha256(f"{email}|{registered_at}".encode()).hexdigest()[:32]
    if removed:
        res = labs_event("user.removed", {"external_user_id": email, "reason": "other"},
                         event_id=f"demo-rm-{key}")
    else:
        res = labs_event("user.registered", {"external_user_id": email, "email": email, "role": "tester"},
                         event_id=f"demo-reg-{key}", occurred_at=registered_at)
    if not res or not res["ok"]:
        print(f"[labs] {'user.removed' if removed else 'user.registered'} not accepted, will retry:",
              res and res["status"])
        return
    c = beta._db()
    if removed:
        c.execute("UPDATE console_members SET removed_at=? WHERE email=?", (beta.now_iso(), email))
    else:
        c.execute("UPDATE console_members SET sent=1 WHERE email=?", (email,))
    c.commit()
    c.close()


def tester_signed_in(email):
    """First sign-in (or first since losing access) registers them with the
    Console, in the background so sign-in never waits on it."""
    if not _creds():
        return
    c = beta._db()
    row = c.execute("SELECT removed_at FROM console_members WHERE email=?", (email,)).fetchone()
    if row and row["removed_at"] is None:
        c.close()
        return
    at = beta.now_iso()
    c.execute("INSERT OR REPLACE INTO console_members VALUES (?,?,0,NULL)", (email, at))
    c.commit()
    c.close()
    threading.Thread(target=_member_event, args=(email, at), daemon=True).start()


@labs_bp.post("/api/labs/refresh")
def refresh():
    """The Console's Update button: re-send today's snapshot (so far) now.
    Signed by the Console with this product's secret, over the raw body."""
    creds = _creds()
    if not creds:
        abort(404)
    ts = request.headers.get("X-Labs-Timestamp", "")
    sig = request.headers.get("X-Labs-Signature", "")
    try:
        fresh = abs(time.time() - int(ts)) <= 300
    except ValueError:
        fresh = False
    if not fresh or not hmac.compare_digest(_sign(creds[1], ts, request.get_data(as_text=True)), sig):
        abort(401)
    day = datetime.datetime.now(UTC).date()
    daily, activity = snapshot(day)
    sent = labs_event("metrics.daily", daily)
    labs_event("metrics.activity.daily", activity)
    if not sent or not sent["ok"]:
        return jsonify(error="The Console didn't accept the snapshot."), 502
    return jsonify(ok=True, as_of_date=day.isoformat())
