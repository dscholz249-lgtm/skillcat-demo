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

Only the ride-along slice is wired. Seats, Billing, Pricing, Settings stay as
static prototype.

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
