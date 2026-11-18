"""
Labs Console — the daily snapshot for "Beta Demo Dashboard" (PRD-539)
====================================================================
The Console (product-experiment-console) is a registry: it never calls this
app, and this app never waits on it. Once a day a Railway cron hits
POST /api/internal/labs-metrics, which posts two signed events for yesterday
(UTC day, as the Console's other products do):

  * metrics.daily           who the Beta Group is, and who used it
  * metrics.activity.daily  what they did

No user events: the Console has this product registered without a user model.

The users are the Beta Group testers ($BETA_EMAILS). SkillCat staff on the
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

import os, json, hmac, uuid, time, hashlib, datetime, urllib.request, urllib.error
from flask import Blueprint, request, jsonify, abort

import beta

DEFAULT_ENDPOINT = "https://product-experiment-console-production.up.railway.app/v1/events"
UTC = datetime.timezone.utc

labs_bp = Blueprint("labs_console", __name__)


# ------------------------------------------------------------------- the helper
def labs_event(event_type, data):
    """Post one signed event. Returns {ok, status, body}, or None when the
    Console isn't configured. Never raises."""
    product_id = os.environ.get("LABS_CONSOLE_PRODUCT_ID")
    secret = os.environ.get("LABS_CONSOLE_SECRET")
    if not product_id or not secret:
        return None
    try:
        # Sign the exact bytes sent, not a re-serialized object.
        body = json.dumps({
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "occurred_at": datetime.datetime.now(UTC).isoformat(timespec="seconds"),
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
