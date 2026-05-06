const express = require('express');
const { db, reset } = require('../db');

const router = express.Router();

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Hardcoded pronouns for the seeded demo techs. Default to they/their.
const TECH_PRONOUNS = {
  3: { subject: 'he',  possessive: 'his',  object: 'him' },  // Tyrell Washington
  7: { subject: 'she', possessive: 'her',  object: 'her' },  // Lauren Mitchell
};
function pronouns(tech_id) {
  return TECH_PRONOUNS[tech_id] || { subject: 'they', possessive: 'their', object: 'them' };
}

function firstName(full) { return (full || '').split(' ')[0]; }

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

function composeOutbound(review, isFirst) {
  const tech    = db.prepare('SELECT * FROM technicians WHERE id = ?').get(review.technician_id);
  const manager = db.prepare('SELECT * FROM managers WHERE id = ?').get(review.reviewer_id);
  const p       = pronouns(tech.id);
  const day     = weekdayOf(review.occurred_date);

  if (isFirst) {
    return [
      `Hi ${firstName(manager.name)} — quick check-in from SkillCat.`,
      `${tech.name} rode along with you ${day}. Based on what you saw, is ${p.subject} ready to handle a service call on ${p.possessive} own? Reply Y or N.`
    ];
  }
  return [
    `One more for today: ${tech.name} rode along with you ${day}. Same question — ready to handle a service call on ${p.possessive} own? Reply Y or N.`
  ];
}

function composeReply(kind, review) {
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ?').get(review.technician_id);
  const p    = pronouns(tech.id);
  const fn   = firstName(tech.name);

  if (kind === 'yes')        return `Got it. ${fn} marked Field Ready. Logged with your name and timestamp — visible in your dashboard now.`;
  if (kind === 'no')         return `Got it. Anything to flag for ${p.object} next ride-along?`;
  if (kind === 'note_saved') return `Thanks. ${fn} flagged for additional support — note saved to ${p.possessive} ride-along record.`;
  if (kind === 'skip')       return `Thanks. ${fn} flagged for additional ride-along support. We'll prompt you again after ${p.possessive} next field day.`;
  return '';
}

const pendingReviewsStmt = db.prepare(`
  SELECT
    r.id, r.technician_id, r.reviewer_id, r.occurred_date, r.context, r.response,
    r.awaiting_note_until,
    t.name AS tech_name, t.initials AS tech_initials, t.role AS tech_role, t.department AS tech_department, t.field_ready_status,
    m.name AS reviewer_name
  FROM ride_along_reviews r
  JOIN technicians t ON t.id = r.technician_id
  JOIN managers m    ON m.id = r.reviewer_id
  WHERE r.response = 'pending' OR (r.awaiting_note_until IS NOT NULL AND r.awaiting_note_until > datetime('now'))
  ORDER BY r.occurred_date ASC, r.id ASC
`);

router.get('/reviews/pending', (req, res) => {
  let rows = pendingReviewsStmt.all();
  if (req.query.tech_id) {
    const id = Number(req.query.tech_id);
    rows = rows.filter(r => r.technician_id === id);
  }
  const out = rows.map((r, i) => ({
    ...r,
    weekday: weekdayOf(r.occurred_date),
    outbound_lines: composeOutbound(r, i === 0)
  }));
  res.json({ reviews: out });
});

router.post('/sms/inbound', (req, res) => {
  const { review_id, body } = req.body || {};
  if (!review_id || typeof body !== 'string') {
    return res.status(400).json({ error: 'review_id and body required' });
  }
  const review = db.prepare('SELECT * FROM ride_along_reviews WHERE id = ?').get(Number(review_id));
  if (!review) return res.status(404).json({ error: 'review not found' });

  const trimmed = body.trim();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Awaiting-note state
  if (review.awaiting_note_until) {
    if (/^skip$/i.test(trimmed)) {
      db.prepare('UPDATE ride_along_reviews SET awaiting_note_until = NULL WHERE id = ?').run(review.id);
      return res.json({ kind: 'skip', reply: composeReply('skip', review), done: true });
    }
    db.prepare('UPDATE ride_along_reviews SET note = ?, awaiting_note_until = NULL WHERE id = ?').run(trimmed, review.id);
    return res.json({ kind: 'note_saved', reply: composeReply('note_saved', review), note: trimmed, done: true });
  }

  // Pending state — Y/N
  if (review.response !== 'pending') {
    return res.status(409).json({ error: 'review already resolved' });
  }
  const yes = /^y/i.test(trimmed);
  const no  = /^n/i.test(trimmed);
  if (!yes && !no) {
    return res.status(400).json({ error: 'expected Y or N', reply: "Sorry, I didn't catch that. Reply Y or N." });
  }

  if (yes) {
    db.prepare(`UPDATE ride_along_reviews SET response = 'yes', responded_at = ? WHERE id = ?`).run(now, review.id);
    db.prepare(`UPDATE technicians SET field_ready_status = 'yes' WHERE id = ?`).run(review.technician_id);
    return res.json({ kind: 'yes', reply: composeReply('yes', review), tech_field_ready: 'yes', done: true });
  }

  // N: enter awaiting-note state for ~24h
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`UPDATE ride_along_reviews SET response = 'no', responded_at = ?, awaiting_note_until = ? WHERE id = ?`).run(now, expires, review.id);
  db.prepare(`UPDATE technicians SET field_ready_status = 'no' WHERE id = ?`).run(review.technician_id);
  return res.json({ kind: 'no', reply: composeReply('no', review), tech_field_ready: 'no', done: false });
});

router.post('/admin/reset', (_req, res) => {
  reset();
  res.json({ ok: true });
});

module.exports = router;
