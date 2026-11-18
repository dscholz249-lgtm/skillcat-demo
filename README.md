# Mock Platform — SMS Ride-Along Review

A disposable stand-in for the full SkillCat platform. It implements the
[API contract](../sms_ridealong_platform_api_contract.md), seeds a SQLite DB on
boot, and serves the existing dashboard prototype with a live wiring script so
the ride-along surfaces (Person Detail notes, Inbox) read from this mock.

Two jobs: **test the mini-app end-to-end**, and **serve as the executable
contract** the platform team builds against.

---

## Run

```bash
pip install flask

# point it at the prototype (one of):
#   - place manager_dashboard.html next to mock_platform.py, or
#   - export PROTOTYPE_PATH=/path/to/manager_dashboard.html
export PROTOTYPE_PATH=../manager_dashboard.html

# use a real phone you control so live Twilio round-trips work:
export TEST_PHONE="+1XXXXXXXXXX"

python mock_platform.py
# open http://localhost:5000
```

The DB is recreated on every boot (and via the debug **reset** button). Nothing
persists; this is throwaway.

## Dashboard versions

A blue **Design review** bar across the top of the page switches between whole
copies of the dashboard, for showing how it progresses. The bar is a review
tool only, not part of the product:

| Version | File |
|---|---|
| v1.1 | `manager_dashboard.html` |

v1.2 and v1.3 were folded into v1.1 in Nov 2026 (v1.3's dashboard setup, v1.2's
seat-swap panel). Design concepts are reviewed elsewhere now; the bar still
works for more versions if a row is added to `VERSIONS`.

- Edit each file freely; they share the mock API and data. The bar is added
  by the server (`version-switcher.js`), so don't add it to the files.
- Only files that exist are offered. Delete one to drop it from the menu, or
  add a row to `VERSIONS` in `mock_platform.py` for a new one.
- Links carry the version and screen, e.g. `/?v=1.2#seats`; the bar's **Copy
  link** copies the current one. A bare `/` opens
  the version you last picked in that browser, or v1.1 for anyone new.
- A fix that every version needs has to be made in each file.

## Sign-in and Beta Group (PRD-543)

The dashboard sits behind an email sign-in. A signed-in browser stays signed in
for 400 days (the longest browsers allow); the lists are re-checked on every
request, so removing someone locks them out straight away.

- `@skillcatapp.com` addresses listed in `INTERNAL_EMAILS` get the internal demo
  at `/`, after a 6-digit code emailed to them (10 minutes, 5 tries).
- Addresses in `BETA_EMAILS` get the **Beta Group** version at `/beta` with just
  their email (set `BETA_REQUIRE_CODE=1` to give them a code too).
- Anyone else is refused. The mock API (`/api/...`) and portfolio pages stay open.

**Promoting screens.** On any screen, turn on **Show to Beta Group** in the blue
review bar. Everything starts off. Detail screens follow their parent (promote
People and the person detail comes with it). Beta Group uses pages from one
version at a time. **Beta Group** in the version links opens what testers see.

**Testers** get a **Leave a note** button. Their screens, time on each screen and
the names of buttons/links they click are recorded (never what they type, except
the notes). SkillCat staff previewing `/beta` are never tracked.

**Daily report.** At 11:55pm ET a Railway cron calls `POST /api/beta/daily-report`
and the day's activity goes to Slack, with a written analysis (from Claude when
`ANTHROPIC_API_KEY` is set, otherwise a plain summary). Staff can see a draft any
time at `/api/beta/report-preview?day=YYYY-MM-DD`.

Beta data lives in `beta.db` on the Railway volume at `/data`, so it survives
deploys (the mock DB doesn't). Variables:

| Variable | |
|---|---|
| `INTERNAL_EMAILS` | SkillCat staff for the internal demo, comma separated |
| `BETA_EMAILS` | approved testers, comma separated |
| `RESEND_API_KEY` | sends sign-in codes (`RESEND_FROM` optional, default `noreply@tryskillcat.com`) |
| `BETA_REQUIRE_CODE` | optional; `1` gives testers a code too |
| `SLACK_WEBHOOK_URL` | where the daily report posts |
| `CRON_SECRET` | bearer token the report cron sends |
| `ANTHROPIC_API_KEY` | optional, for the written analysis |
| `SESSION_SECRET` | optional; otherwise generated and kept on the volume |

Cron service (schedule `55 3,4 * * *`; only the run at 11pm ET does anything, and a run that starts late, after midnight ET, reports the day that just ended). The cron service's variable must be named `CRON_SECRET`; set it as a reference, `${{skillcat-demo.CRON_SECRET}}`:

```
sh -c 'apk add --no-cache curl >/dev/null 2>&1; curl -fsS -X POST -H "authorization: Bearer $CRON_SECRET" "https://<demo-domain>/api/beta/daily-report"'
```

## Labs Console (PRD-539)

Registered in the Labs Console as **Beta Demo Dashboard**. Once a day a cron
calls `POST /api/internal/labs-metrics` (bearer `CRON_SECRET`), which posts
yesterday's snapshot (a UTC day) as two signed events: `metrics.daily` and
`metrics.activity.daily`. The code is in `labs_console.py`.

**The Beta Group lives in the Console (PRD-547).** Every 10 minutes the app reads
it (signed `GET /v1/beta-group`) and stores it in `beta.db`; sign-in only reads
the stored copy, so a Console outage never blocks anyone. Add or remove someone
on the Console's People page and the demo follows within 10 minutes.
`BETA_EMAILS` still adds one-off testers on top. A tester's first sign-in is
sent as `user.registered` (losing access as `user.removed`), so the People page
shows who is in this experiment. The Console's Update button calls
`POST /api/labs/refresh` once that's set as the product's refresh URL.

- **Users** are the Beta Group testers (the Console's Beta Group plus `BETA_EMAILS`). Staff are never
  tracked, so they never count. The breakdown is Active to date / Not yet active.
- **Active** means a tester with any tracked screen view, time on a screen,
  click or note that day. DAU, MAU, last active and retention (d1/w1/m1/m6,
  from the first tracked day) are all built on that.
- **Activity** is the day's Screen views, Clicks, Notes, Sessions and Minutes
  on screens, sent as explicit zeros on a quiet day.
- Only counts are sent, never note text or click labels. With the variables
  unset, the route does nothing; every Console failure is swallowed.
- `?dry_run=1` shows the payloads without sending; `?day=YYYY-MM-DD` sends
  another day.

| Variable | |
|---|---|
| `LABS_CONSOLE_PRODUCT_ID` | `8fd67d58-0705-4ee3-851f-8bf42254a781` |
| `LABS_CONSOLE_SECRET` | from the Console (shown once; rotate on the product page if lost). Never commit it |
| `LABS_CONSOLE_ENDPOINT` | optional; defaults to the production Console |

Cron service: image `curlimages/curl`, schedule `0 6 * * *` (UTC), start command

```
sh -c 'curl -fsS -X POST -H "authorization: Bearer $CRON_SECRET" "https://<demo-domain>/api/internal/labs-metrics"'
```

## Deploy to Railway

The repo includes `requirements.txt` and a `Procfile` — Railway/Nixpacks
detects Python and runs it. The app binds `0.0.0.0:$PORT` and seeds on boot.

```bash
# from inside mock-platform/
cp /path/to/manager_dashboard.html .   # bundle the prototype (see note below)
railway init
railway up
# Railway gives you a public https URL
```

Or connect a GitHub repo in the Railway dashboard and it auto-deploys on push.

**Bundle the prototype.** Railway has no access to your local files, so
`manager_dashboard.html` must be committed alongside `mock_platform.py` (the
server finds it automatically when it's in the same folder). Alternatively set a
`PROTOTYPE_PATH` variable in Railway pointing at a path inside the deploy.

**Set `TEST_PHONE`** as a Railway variable to your real test number so live
Twilio round-trips work.

### Two things to know before exposing it publicly

1. **No auth.** Anyone with the URL can read the (fake) data, send batches, and
   hit the debug **reset**. That's fine for a fake-data demo shared with the
   team, but don't treat it as private. If you want a light gate, put it behind
   Railway's password protection or add a shared-secret header check.
2. **Ephemeral storage.** Railway's filesystem resets on every redeploy/restart,
   and the DB re-seeds on boot — so reviews you create won't survive a restart.
   That's by design for a mock; just don't expect persistence.

### Mock vs. mini-app — what "public" gets you

Deploying *the mock* publicly lets colleagues **view the dashboard and the API**
from anywhere. It does **not** by itself enable the live SMS round-trip — Twilio
delivers inbound texts by POSTing to a webhook, which is the **mini-app's**
endpoint, not the mock's. To demo the full text conversation end-to-end, the
**mini-app also needs a public URL** (host it the same way), with its Twilio
Messaging Service webhook pointed at it and its platform base URL pointed at
this mock.

## What you get

- **The prototype, live.** Served at `/`. A green `● LIVE · mock platform` badge
  (bottom-left) confirms the wiring is active. Open a technician's **Person
  Detail → Notes** to see completed ride-along reviews as a distinct entry type
  (orange tag, Ready / Not-yet-ready badge). The **Inbox** shows one row per
  review To Do, flipping from "Action" to resolved as reviews complete.
- **Debug panel** (`⚙ mock`, bottom-right). Raw reviews + todos, a **simulate
  in-app complete** button per pending review (the cross-channel test), and a
  **reset DB** button.
- **Seat management** (below). Client-side only — no API, no persistence.

Pricing and Settings stay as static prototype.

---

## Seat management

Lives entirely in `manager_dashboard.html` (one model, no backend). It exists to
demo the pitch: managers swap technicians in and out of a fixed number of seats
to hold a budget, and today that means *remove then re-add* — a window of
underutilized seats and a gap in the billing cycle.

**The concepts**

| Term | Meaning |
|---|---|
| **Seat** | A numbered, billable slot. Costs money whether or not anyone uses it. |
| **Roster** | Every technician uploaded, seated or not. Not billable. |
| **Bench** | A roster technician with no seat. Keeps their progress, costs $0. |
| **Idle** | An assigned seat with no access in 30+ days — the swap candidates. |
| **Swap** | Move a bench technician into an occupied seat in **one** action. The seat never leaves the plan, so there is no gap and no billing change. |

**Seed state:** 53 on the roster · 49 seats on the plan · 47 assigned · 2 open ·
4 idle · 6 on the bench. Regions are seat pools: North, South, No Region.

**Where it shows up**

- **Dashboard → Seats.** Idle Seats and On Bench side by side, so the waste and
  the waiting list are visible without opening anything.
- **People.** Seated / Bench / All tabs over the full roster, a bench banner, and
  a selection bar that can hand out seats or move someone to the bench.
- **Seats.** Plan tiles, a swap callout, per-region pools (multi-tier), filters,
  and per-seat **Swap** / **Move to bench** / **Assign** / **Remove seat**.
- **Billing.** Seat charges, regional breakdown and bench count all read from the
  same model, so a swap visibly does *not* move the invoice.

**Demo path:** Dashboard → 4 idle seats while 6 wait → Seats → *Review Swaps* →
pick a bench tech → the toast confirms the plan is unchanged. Then People →
Bench → select two → *Give Seats* → select everyone to trigger the shortfall
branch (add seats, or swap into an idle one).

State is in-memory: reload resets it. `window.SEATS` is exposed for poking at the
model from the console mid-demo.

## Endpoints (mirror the contract)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/ride-along/roster?company_id=` | managers + technicians (phone, opt-in) |
| POST | `/api/ride-along/review-batch` | Send All → one To Do per review; returns SMS-eligible subset (idempotent on `batch_id`) |
| POST | `/api/ride-along/reviews/{id}/result` | write back SMS verdict + note (409 if already complete) |
| GET  | `/api/ride-along/reviews/{id}` | review status (the mini-app's pre-send check) |
| GET  | `/api/token?company_id=&user_id=` | mint a signed iframe context token |

Read-helpers used by the prototype UI: `GET /api/ride-along/reviews`,
`GET /api/ride-along/todos`. Debug: `GET /api/debug/state`,
`POST /api/debug/reviews/{id}/complete-in-app`, `POST /api/debug/reset`.

## Point the mini-app at it

Set the mini-app's platform base URL to `http://localhost:5000` and its
company to `co_test`. Then:

1. Compose in the mini-app: stack e.g. Eric Park → David Kim, Eric Park →
   Amanda Lee, Maria Lopez → Sarah Johnson. Hit **Send All**.
2. Debug panel shows 3 reviews + 3 todos; Eric's two are `sms_eligible`,
   Maria's is app-only (no opt-in).
3. Run the SMS conversation on the opt-in manager's phone. Watch verdicts/notes
   land on each tech's Person Detail → Notes.
4. **Cross-channel test:** before finishing the batch, hit **simulate in-app
   complete** on one of Eric's pending reviews. The mini-app should skip it and
   not text about that tech (it checks `GET /reviews/{id}` first).
5. **Idempotency:** re-send with the same `batch_id` → no duplicate reviews.

## Seed data

| Company | `co_test` — Northeast HVAC |
|---|---|
| Managers | Eric Park (opt-in, `$TEST_PHONE`) · Maria Lopez (app-only) |
| Technicians | David Kim · Amanda Lee · Sarah Johnson |

Technicians match people that exist in the prototype, so reviews land on real
Person Detail pages (David Kim is the prototype's hardcoded detail view).

## Not included (it's a mock)

Real auth depth, RBAC, the Customer.io pipe, persistence across reboots. The
token is HMAC-signed to model the real handshake but isn't a production JWT.
The platform team's real endpoints must match the **behavior** here — create
one To Do per review, idempotent batches, 409 on channel race, note attached to
the review record — not this implementation.
