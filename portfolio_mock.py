#!/usr/bin/env python3
"""
Technician's Notes / Portfolio — mock data + API
================================================
Adds the Portfolio surfaces (Technician's Notes) to the throwaway mock platform:

  * Screen 1b — the public/shared dossier   -> GET /portfolio/<technician_id>
  * Screen 2a — the technician's edit view  -> GET /notes/<technician_id>

Both read the SAME backend state, so the star demo works end-to-end: flip a note
public in 2a and it appears on the public 1b dossier.

This module is imported by mock_platform.py. It:
  * creates its own tables inside the shared SQLite DB (create_portfolio_tables)
  * seeds Ray Okonkwo's dossier to match the handoff/screenshots (seed_portfolio)
  * exposes a Flask Blueprint (portfolio_bp) with the read/write API + page routes

Like the rest of the mock, it's throwaway: fake data, no auth, re-seeded on boot.
The DB path mirrors mock_platform's default so both talk to the same file.
"""

import os
import json
import sqlite3
import pathlib
from flask import Blueprint, request, jsonify, Response, abort

HERE = pathlib.Path(__file__).resolve().parent
DB_PATH = os.environ.get("MOCK_DB", "mock_platform.db")

portfolio_bp = Blueprint("portfolio", __name__)


def _db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


# ----------------------------------------------------------------------- SCHEMA
def create_portfolio_tables(c):
    """Create the portfolio tables inside an existing connection (called from
    mock_platform.init_db, before it commits)."""
    c.executescript("""
    CREATE TABLE IF NOT EXISTS portfolios (
        technician_id   TEXT PRIMARY KEY,
        name            TEXT,
        title           TEXT,
        employer        TEXT,
        region          TEXT,
        verified_phone  TEXT,
        verified_email  TEXT,
        intro           TEXT,
        -- readiness
        readiness_status         TEXT,
        readiness_confirmed_label TEXT,
        readiness_confirmed_by    TEXT,
        attestation_count         INTEGER,
        -- generated review note (owned by the technician)
        review_note_body          TEXT,
        review_note_source_count  INTEGER,
        review_note_updated_label TEXT,
        -- section-level public visibility (2a toggles)
        section_intro         INTEGER DEFAULT 1,
        section_readiness     INTEGER DEFAULT 1,
        section_review_note   INTEGER DEFAULT 1,
        section_skills        INTEGER DEFAULT 1,
        -- public link + counts (labels are demo strings, not computed)
        link_live             INTEGER DEFAULT 1,
        items_total           INTEGER DEFAULT 0,
        -- the intro channels shown in 2a
        channel_phone         TEXT,
        channel_email         TEXT
    );
    CREATE TABLE IF NOT EXISTS portfolio_skills (
        technician_id TEXT, skill TEXT, count INTEGER, ord INTEGER
    );
    CREATE TABLE IF NOT EXISTS portfolio_vouchers (
        technician_id TEXT, name TEXT, role TEXT, note_count INTEGER, ord INTEGER
    );
    CREATE TABLE IF NOT EXISTS portfolio_notes (
        id                  TEXT PRIMARY KEY,
        technician_id       TEXT,
        author_role         TEXT,   -- 'technician' | 'manager'
        author_name         TEXT,
        body                TEXT,
        source_channel      TEXT,   -- sms | mms | voice | email | app | skillcat
        date_label          TEXT,   -- e.g. "23 JUN 2026"
        time_label          TEXT,   -- e.g. "2:14 PM" or ""
        capture_label       TEXT,   -- e.g. "4:41 PM"
        receipt_label       TEXT,   -- e.g. "6:10 PM (low signal)"
        visibility          TEXT,   -- private | shared | public
        pinned              INTEGER DEFAULT 0,
        hidden_by_technician INTEGER DEFAULT 0,
        ord                 INTEGER,
        -- JSON blobs
        attestation_json    TEXT,   -- {manager_name, role, company, published_label} | null
        media_json          TEXT,   -- [{label}]
        transcript_json     TEXT    -- {text, heard, corrected, duration, position, audio_url} | null
    );
    """)


# ------------------------------------------------------------------------- SEED
RAY = "tech_ray"


def seed_portfolio(c):
    """Seed Ray Okonkwo's dossier to match the handoff + screenshots.

    Coherent shared state across 1b and 2a (deliberately picked so the public
    toggle demo is meaningful): the attestation and field note are PUBLIC; the
    voice note is SHARED (private) — so it shows in 2a with its toggle OFF and
    is absent from 1b until the technician flips it public."""
    # Make sure Ray exists as a technician so he also appears in the roster /
    # People list. mock_platform seeds three techs; add Ray alongside them.
    row = c.execute("SELECT id FROM technicians WHERE id=?", (RAY,)).fetchone()
    if not row:
        c.execute("INSERT INTO technicians VALUES (?,?,?,?,?,?)",
                  (RAY, "co_test", "Ray Okonkwo", "go", "Dana Whitfield", "2026-06-18T00:00:00Z"))

    c.execute("DELETE FROM portfolios WHERE technician_id=?", (RAY,))
    c.execute("DELETE FROM portfolio_skills WHERE technician_id=?", (RAY,))
    c.execute("DELETE FROM portfolio_vouchers WHERE technician_id=?", (RAY,))
    c.execute("DELETE FROM portfolio_notes WHERE technician_id=?", (RAY,))

    c.execute("""INSERT INTO portfolios (
        technician_id, name, title, employer, region, verified_phone, verified_email, intro,
        readiness_status, readiness_confirmed_label, readiness_confirmed_by, attestation_count,
        review_note_body, review_note_source_count, review_note_updated_label,
        section_intro, section_readiness, section_review_note, section_skills,
        link_live, items_total, channel_phone, channel_email
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?)""", (
        RAY, "Ray Okonkwo", "HVAC Service Technician", "Brightline Mechanical", "Tulsa, OK",
        "917-826-4055", "ray@brightlinemech.com",
        "Four years on residential and light commercial split systems. Most of my work is "
        "diagnostics on units nobody else wants to touch — I document every call so the "
        "next tech isn't guessing.",
        "Field ready", "Confirmed Jun 2026", "Dana Whitfield", 11,
        "Managers consistently describe Ray as the tech they send on repeat-callback jobs. "
        "Cited strengths: refrigerant-side diagnostics, willingness to re-test rather than "
        "assume, and unusually clear write-ups. One note flags speed on install work as a "
        "growth area.",
        11, "Updated Jun 2026",
        1, 1, 1, 1,          # sections: intro / readiness / review note / skills all on
        1, 38,               # link live, 38 items total
        "+1 251 313 5407", "notes@skillcat.com",
    ))

    skills = [
        ("Refrigerant diagnostics", 5),
        ("Electrical troubleshooting", 3),
        ("Customer handoff", 3),
        ("Brazing", 2),
        ("Airflow balancing", 2),
        ("Startup & commissioning", 1),
        ("Leak detection", 1),
    ]
    c.executemany("INSERT INTO portfolio_skills VALUES (?,?,?,?)",
                  [(RAY, s, n, i) for i, (s, n) in enumerate(skills)])

    vouchers = [
        ("Dana Whitfield", "Service Manager", 9),
        ("Marcus Kealoha", "Field Supervisor", 2),
    ]
    c.executemany("INSERT INTO portfolio_vouchers VALUES (?,?,?,?,?)",
                  [(RAY, n, r, cnt, i) for i, (n, r, cnt) in enumerate(vouchers)])

    notes = [
        dict(
            id="pn_ray_01", author_role="manager", author_name="Dana Whitfield",
            body="Ray caught a restriction two other techs had written off as a low charge. "
                 "This is the diagnostic standard I want on every call.",
            source_channel="email", date_label="23 JUN 2026", time_label="",
            capture_label="", receipt_label="",
            visibility="public", pinned=1, hidden_by_technician=0, ord=0,
            attestation_json=json.dumps({
                "manager_name": "Dana Whitfield", "role": "Service Manager",
                "company": "Brightline Mechanical", "published_label": "published to you 23 Jun",
            }),
            media_json=json.dumps([]),
            transcript_json=None,
        ),
        dict(
            id="pn_ray_02", author_role="technician", author_name="Ray",
            body="Compressor short-cycling on a 4-ton Trane. Found the liquid line filter-drier "
                 "restricted — 18° split across it. Replaced, evacuated to 380 microns, "
                 "charge weighed back in.",
            source_channel="sms", date_label="23 JUN 2026", time_label="2:14 PM",
            capture_label="", receipt_label="",
            visibility="public", pinned=0, hidden_by_technician=0, ord=1,
            attestation_json=None,
            media_json=json.dumps([
                {"label": "filter-drier"}, {"label": "gauge set"}, {"label": "micron gauge"},
            ]),
            transcript_json=None,
        ),
        dict(
            id="pn_ray_03", author_role="technician", author_name="Ray",
            body="",
            source_channel="voice", date_label="23 JUN 2026", time_label="4:41 PM",
            capture_label="4:41 PM", receipt_label="6:10 PM (low signal)",
            visibility="shared", pinned=0, hidden_by_technician=0, ord=2,
            attestation_json=None,
            media_json=json.dumps([]),
            transcript_json=json.dumps({
                "text": "Walked the homeowner through why the drier failed and what to watch "
                        "for. She asked for the same tech next time.",
                "heard": "dryer", "corrected": "drier",
                "duration": "0:48", "position": "0:16",
                "audio_url": "",
            }),
        ),
    ]
    for n in notes:
        c.execute("""INSERT INTO portfolio_notes (
            id, technician_id, author_role, author_name, body, source_channel,
            date_label, time_label, capture_label, receipt_label,
            visibility, pinned, hidden_by_technician, ord,
            attestation_json, media_json, transcript_json
        ) VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?)""", (
            n["id"], RAY, n["author_role"], n["author_name"], n["body"], n["source_channel"],
            n["date_label"], n["time_label"], n["capture_label"], n["receipt_label"],
            n["visibility"], n["pinned"], n["hidden_by_technician"], n["ord"],
            n["attestation_json"], n["media_json"], n["transcript_json"],
        ))


# ---------------------------------------------------------------- SERIALIZATION
def _note_dict(r):
    return {
        "id": r["id"],
        "author_role": r["author_role"],
        "author_name": r["author_name"],
        "body": r["body"],
        "source_channel": r["source_channel"],
        "date_label": r["date_label"],
        "time_label": r["time_label"],
        "capture_label": r["capture_label"],
        "receipt_label": r["receipt_label"],
        "visibility": r["visibility"],
        "pinned": bool(r["pinned"]),
        "hidden_by_technician": bool(r["hidden_by_technician"]),
        "ord": r["ord"],
        "attestation": json.loads(r["attestation_json"]) if r["attestation_json"] else None,
        "media": json.loads(r["media_json"]) if r["media_json"] else [],
        "transcript": json.loads(r["transcript_json"]) if r["transcript_json"] else None,
    }


def _portfolio_payload(c, tid, view):
    p = c.execute("SELECT * FROM portfolios WHERE technician_id=?", (tid,)).fetchone()
    if not p:
        return None
    skills = [dict(skill=s["skill"], count=s["count"])
              for s in c.execute("SELECT * FROM portfolio_skills WHERE technician_id=? ORDER BY ord", (tid,))]
    vouchers = [dict(name=v["name"], role=v["role"], note_count=v["note_count"])
                for v in c.execute("SELECT * FROM portfolio_vouchers WHERE technician_id=? ORDER BY ord", (tid,))]
    notes = [_note_dict(n) for n in c.execute(
        "SELECT * FROM portfolio_notes WHERE technician_id=? ORDER BY ord", (tid,))]

    sections = {
        "intro": bool(p["section_intro"]),
        "readiness": bool(p["section_readiness"]),
        "review_note": bool(p["section_review_note"]),
        "attested_skills": bool(p["section_skills"]),
    }

    shown = sum(1 for n in notes if n["visibility"] == "public" and not n["hidden_by_technician"])

    if view == "public":
        # Only public, non-hidden items; pinned first, then original order.
        notes = [n for n in notes if n["visibility"] == "public" and not n["hidden_by_technician"]]
        notes.sort(key=lambda n: (0 if n["pinned"] else 1, n["ord"]))

    payload = {
        "view": view,
        "technician": {
            "id": tid, "name": p["name"], "title": p["title"], "employer": p["employer"],
            "region": p["region"], "verified_phone": p["verified_phone"],
            "verified_email": p["verified_email"], "intro": p["intro"],
            "link_live": bool(p["link_live"]),
            "items_shown": shown, "items_total": p["items_total"],
            "channel_phone": p["channel_phone"], "channel_email": p["channel_email"],
        },
        "readiness": {
            "status": p["readiness_status"],
            "confirmed_label": p["readiness_confirmed_label"],
            "confirmed_by": p["readiness_confirmed_by"],
            "attestation_count": p["attestation_count"],
        },
        "sections": sections,
        "attested_skills": skills,
        "vouchers": vouchers,
        "review_note": {
            "body": p["review_note_body"],
            "source_note_count": p["review_note_source_count"],
            "updated_label": p["review_note_updated_label"],
        },
        "notes": notes,
    }
    return payload


# -------------------------------------------------------------------- READ API
@portfolio_bp.get("/api/portfolio/<technician_id>")
def get_portfolio(technician_id):
    """Full dossier. ?view=public applies the technician's visibility choices
    (public items + section toggles); ?view=owner returns everything for 2a."""
    view = request.args.get("view", "owner")
    view = "public" if view == "public" else "owner"
    c = _db()
    payload = _portfolio_payload(c, technician_id, view)
    c.close()
    if payload is None:
        abort(404, description="no portfolio for that technician")
    return jsonify(payload)


# ------------------------------------------------------------------- WRITE API
@portfolio_bp.patch("/api/portfolio/<technician_id>")
def patch_portfolio(technician_id):
    """Update intro text and/or section-level public toggles (2a controls).
    Body: {"intro"?: str, "sections"?: {intro,readiness,review_note,attested_skills}}."""
    body = request.get_json(force=True) or {}
    c = _db()
    p = c.execute("SELECT * FROM portfolios WHERE technician_id=?", (technician_id,)).fetchone()
    if not p:
        c.close(); abort(404)
    if "intro" in body:
        intro = str(body["intro"])[:400]  # 400-char cap mirrors the UI
        c.execute("UPDATE portfolios SET intro=? WHERE technician_id=?", (intro, technician_id))
    secs = body.get("sections") or {}
    colmap = {"intro": "section_intro", "readiness": "section_readiness",
              "review_note": "section_review_note", "attested_skills": "section_skills"}
    for key, col in colmap.items():
        if key in secs:
            c.execute(f"UPDATE portfolios SET {col}=? WHERE technician_id=?",
                      (1 if secs[key] else 0, technician_id))
    c.commit()
    payload = _portfolio_payload(c, technician_id, "owner")
    c.close()
    return jsonify(payload)


@portfolio_bp.patch("/api/portfolio/<technician_id>/notes/<note_id>")
def patch_note(technician_id, note_id):
    """Update one note. Technician-authored notes: body/transcript/visibility/
    pinned/hidden all editable. Manager-authored notes: only visibility, pinned,
    hidden (the technician can show/hide/pin, never edit or delete manager text)."""
    body = request.get_json(force=True) or {}
    c = _db()
    n = c.execute("SELECT * FROM portfolio_notes WHERE id=? AND technician_id=?",
                  (note_id, technician_id)).fetchone()
    if not n:
        c.close(); abort(404)
    is_manager = n["author_role"] == "manager"

    if "visibility" in body:
        vis = body["visibility"]
        if vis not in ("private", "shared", "public"):
            c.close(); abort(400, description="bad visibility")
        # A technician may only promote a SHARED item to public — never an
        # unpublished manager note (manager notes land as 'shared' on publish).
        c.execute("UPDATE portfolio_notes SET visibility=? WHERE id=?", (vis, note_id))
    if "pinned" in body:
        c.execute("UPDATE portfolio_notes SET pinned=? WHERE id=?",
                  (1 if body["pinned"] else 0, note_id))
    if "hidden_by_technician" in body:
        c.execute("UPDATE portfolio_notes SET hidden_by_technician=? WHERE id=?",
                  (1 if body["hidden_by_technician"] else 0, note_id))

    if not is_manager:
        if "body" in body:
            c.execute("UPDATE portfolio_notes SET body=? WHERE id=?",
                      (str(body["body"]), note_id))
        if "transcript_text" in body and n["transcript_json"]:
            tj = json.loads(n["transcript_json"])
            tj["text"] = str(body["transcript_text"])  # audio is never overwritten
            c.execute("UPDATE portfolio_notes SET transcript_json=? WHERE id=?",
                      (json.dumps(tj), note_id))
    c.commit()
    updated = c.execute("SELECT * FROM portfolio_notes WHERE id=?", (note_id,)).fetchone()
    c.close()
    return jsonify(_note_dict(updated))


@portfolio_bp.post("/api/portfolio/<technician_id>/notes")
def add_note(technician_id):
    """Capture bar: add a technician field note. Lands as 'shared' (default for
    technician-authored notes) — the technician opts it into public separately."""
    body = request.get_json(force=True) or {}
    text = (body.get("body") or "").strip()
    if not text:
        abort(400, description="body required")
    c = _db()
    p = c.execute("SELECT technician_id FROM portfolios WHERE technician_id=?",
                  (technician_id,)).fetchone()
    if not p:
        c.close(); abort(404)
    # New notes sort above existing ones (most recent first in the editor).
    minord = c.execute("SELECT MIN(ord) AS m FROM portfolio_notes WHERE technician_id=?",
                       (technician_id,)).fetchone()["m"]
    ordv = (minord if minord is not None else 0) - 1
    import base64
    nid = "pn_" + base64.urlsafe_b64encode(os.urandom(5)).decode().rstrip("=")
    c.execute("""INSERT INTO portfolio_notes (
        id, technician_id, author_role, author_name, body, source_channel,
        date_label, time_label, capture_label, receipt_label,
        visibility, pinned, hidden_by_technician, ord,
        attestation_json, media_json, transcript_json
    ) VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?)""", (
        nid, technician_id, "technician", "Ray", text, body.get("source_channel", "app"),
        "TODAY", "", "", "", "shared", 0, 0, ordv,
        None, json.dumps([]), None,
    ))
    c.commit()
    n = c.execute("SELECT * FROM portfolio_notes WHERE id=?", (nid,)).fetchone()
    c.close()
    return jsonify(_note_dict(n))


# ------------------------------------------------------------------ PAGE ROUTES
@portfolio_bp.get("/portfolio/<technician_id>")
def serve_public_dossier(technician_id):
    """Screen 1b — the public/shared dossier. Standalone, no manager chrome."""
    path = HERE / "portfolio.html"
    if not path.exists():
        return ("<h1>portfolio.html missing</h1>", 404)
    html = path.read_text(encoding="utf-8").replace("__TECHNICIAN_ID__", technician_id)
    return Response(html, mimetype="text/html")


@portfolio_bp.get("/notes/<technician_id>")
def serve_edit_view(technician_id):
    """Screen 2a — the technician-owned edit & input view."""
    path = HERE / "notes.html"
    if not path.exists():
        return ("<h1>notes.html missing</h1>", 404)
    html = path.read_text(encoding="utf-8").replace("__TECHNICIAN_ID__", technician_id)
    return Response(html, mimetype="text/html")
