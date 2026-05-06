# SkillCat Manager Dashboard — Working Prototype

A working prototype of the SkillCat manager-side ride-along review feature.

When a technician completes a ride-along with their manager, SkillCat sends the manager an SMS: *"Is this tech ready to handle this kind of call on their own? Y/N."* A `Y` flips the technician's Field Ready status to **Ready**. An `N` triggers a follow-up SMS asking for a short note explaining what to flag for next time. The note is saved to the technician's permanent ride-along record. Managers never have to open the app to respond.

This prototype runs the full state machine end-to-end. The SMS transport itself is **simulated in-browser** — the modal renders an iMessage-style thread the reviewer can drive with quick-reply buttons. The state machine, dashboard reflection, persistence, and copy are real.

## Run locally

```
npm install
npm start
```

Visit `http://localhost:3000`.

## Demo path

1. Open the dashboard. **Awaiting ride-along review** reads **2** (Tyrell Washington, Lauren Mitchell).
2. Click **Send review SMS to managers →**. The simulator opens.
3. First message arrives — about Tyrell. Reply **Y**.
4. Confirmation. The dashboard panel on the right flips Tyrell to **Ready**.
5. Second message arrives, framed as a continuation: *"One more for today: Lauren Mitchell rode along with you Saturday..."*
6. Reply **N**. The simulator prompts for a note. Type one and send (or click **SKIP**).
7. Confirmation. Lauren is marked **Not ready** and the note is captured to her record.
8. Close the modal. Dashboard now reads **Awaiting review: 0**, Tyrell is Ready, Lauren is Not ready.
9. Click any technician row to see their detail view — Lauren's ride-along timeline now shows the new entry with the captured note.
10. **Reset demo** in the simulator restores both pending reviews so the other paths can be exercised.

## Stack

- Node 20+ / Express
- `better-sqlite3` (in-memory by default; ephemeral on Railway is intentional — every cold start is a fresh demo)
- Static HTML + vanilla JS, served by Express

## Architecture notes

- `db.js` — schema migration on boot, seed loaded from `seed.sql`
- `routes/api.js` — read endpoints for the dashboard and detail view
- `routes/sms.js` — `/reviews/pending`, `/sms/inbound` (state machine), `/admin/reset`
- `public/sms.js` — phone simulator module; exposes `window.SkillCatSMS.open({ onChange, focusTechId })`
- The "One more for today:" continuity phrasing fires on the second-onward outbound to the same recipient, exactly as it would in a real SMS thread

## Out of scope for this prototype

- Real Twilio (or any) SMS transport — fully simulated
- Auth, multi-tenancy, account management
- Auto-triggered ride-along requests (cron from a "ride-along ended" event) — manual trigger via dashboard CTA only
- Branch transfer / cross-org tech record portability
- Tech-facing UI changes
