const express = require('express');
const { db } = require('../db');

const router = express.Router();

const technicianSummary = db.prepare(`
  SELECT
    t.id, t.name, t.initials, t.role, t.department, t.field_ready_status,
    m.name AS manager_name,
    p.name AS path_name,
    p.total_modules,
    pp.modules_complete,
    pp.status AS path_status
  FROM technicians t
  LEFT JOIN managers m            ON m.id = t.manager_id
  LEFT JOIN training_paths p      ON p.id = t.current_path_id
  LEFT JOIN technician_path_progress pp
         ON pp.technician_id = t.id AND pp.path_id = t.current_path_id
  ORDER BY t.id
`);

const technicianById = db.prepare(`
  SELECT
    t.*,
    m.name  AS manager_name,
    m.id    AS manager_id,
    p.id    AS path_id,
    p.name  AS path_name,
    p.total_modules,
    pp.modules_complete,
    pp.days_in_path,
    pp.cohort_avg_days,
    pp.status AS path_status
  FROM technicians t
  LEFT JOIN managers m            ON m.id = t.manager_id
  LEFT JOIN training_paths p      ON p.id = t.current_path_id
  LEFT JOIN technician_path_progress pp
         ON pp.technician_id = t.id AND pp.path_id = t.current_path_id
  WHERE t.id = ?
`);

const reviewsForTech = db.prepare(`
  SELECT r.*, m.name AS reviewer_name
  FROM ride_along_reviews r
  LEFT JOIN managers m ON m.id = r.reviewer_id
  WHERE r.technician_id = ?
  ORDER BY r.occurred_date DESC
`);

const certsForTech       = db.prepare(`SELECT * FROM certifications        WHERE technician_id = ? ORDER BY in_progress, issued_date DESC`);
const coursesForTech     = db.prepare(`SELECT * FROM completed_courses     WHERE technician_id = ? ORDER BY completed_date DESC`);
const assignmentsForTech = db.prepare(`SELECT * FROM outstanding_assignments WHERE technician_id = ? ORDER BY overdue_days DESC, due_date ASC`);

const pendingCount = db.prepare(`SELECT count(*) AS n FROM ride_along_reviews WHERE response = 'pending'`);

function pct(complete, total) {
  if (!complete || !total) return 0;
  return Math.round((complete / total) * 100);
}

router.get('/technicians', (_req, res) => {
  const rows = technicianSummary.all().map(t => ({
    id: t.id,
    name: t.name,
    initials: t.initials,
    role: t.role,
    department: t.department,
    manager_name: t.manager_name,
    field_ready_status: t.field_ready_status,
    path: {
      name: t.path_name,
      pct: pct(t.modules_complete, t.total_modules),
      status: t.path_status || 'on-track'
    }
  }));
  res.json({
    technicians: rows,
    stats: {
      total: rows.length,
      field_ready: rows.filter(r => r.field_ready_status === 'yes').length,
      on_track: rows.filter(r => r.path.status === 'on-track').length,
      behind: rows.filter(r => r.path.status === 'behind').length,
      stalled: rows.filter(r => r.path.status === 'stalled').length,
      awaiting_review: pendingCount.get().n
    }
  });
});

router.get('/technicians/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = technicianById.get(id);
  if (!t) return res.status(404).json({ error: 'Not found' });

  const reviews = reviewsForTech.all(id);
  const reviewed = reviews.filter(r => r.response === 'yes' || r.response === 'no');
  const ready_count = reviewed.filter(r => r.response === 'yes').length;

  res.json({
    id: t.id,
    name: t.name,
    initials: t.initials,
    role: t.role,
    department: t.department,
    hire_date: t.hire_date,
    field_ready_status: t.field_ready_status,
    manager: { id: t.manager_id, name: t.manager_name },
    path: {
      id: t.path_id,
      name: t.path_name,
      total_modules: t.total_modules,
      modules_complete: t.modules_complete,
      pct: pct(t.modules_complete, t.total_modules),
      days_in_path: t.days_in_path,
      cohort_avg_days: t.cohort_avg_days,
      status: t.path_status || 'on-track'
    },
    outstanding_assignments: assignmentsForTech.all(id),
    completed_courses: coursesForTech.all(id),
    certifications: certsForTech.all(id),
    ride_along_reviews: reviews,
    ride_along_summary: {
      total_reviewed: reviewed.length,
      ready_count
    }
  });
});

module.exports = router;
