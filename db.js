const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || ':memory:';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS managers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone_e164 TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS training_paths (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      total_modules INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS technicians (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      initials TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      manager_id INTEGER REFERENCES managers(id),
      hire_date TEXT NOT NULL,
      field_ready_status TEXT NOT NULL,
      current_path_id INTEGER REFERENCES training_paths(id)
    );

    CREATE TABLE IF NOT EXISTS technician_path_progress (
      technician_id INTEGER REFERENCES technicians(id),
      path_id INTEGER REFERENCES training_paths(id),
      modules_complete INTEGER NOT NULL DEFAULT 0,
      days_in_path INTEGER NOT NULL DEFAULT 0,
      cohort_avg_days INTEGER,
      status TEXT NOT NULL DEFAULT 'on-track',
      PRIMARY KEY (technician_id, path_id)
    );

    CREATE TABLE IF NOT EXISTS ride_along_reviews (
      id INTEGER PRIMARY KEY,
      technician_id INTEGER REFERENCES technicians(id),
      reviewer_id INTEGER REFERENCES managers(id),
      occurred_date TEXT NOT NULL,
      context TEXT,
      response TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'sms',
      responded_at TEXT,
      awaiting_note_until TEXT,
      last_outbound_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS certifications (
      id INTEGER PRIMARY KEY,
      technician_id INTEGER REFERENCES technicians(id),
      name TEXT NOT NULL,
      issued_date TEXT,
      expires_date TEXT,
      in_progress INTEGER DEFAULT 0,
      progress_pct INTEGER
    );

    CREATE TABLE IF NOT EXISTS completed_courses (
      id INTEGER PRIMARY KEY,
      technician_id INTEGER REFERENCES technicians(id),
      name TEXT NOT NULL,
      completed_date TEXT NOT NULL,
      module_count INTEGER,
      hours INTEGER,
      score TEXT
    );

    CREATE TABLE IF NOT EXISTS outstanding_assignments (
      id INTEGER PRIMARY KEY,
      technician_id INTEGER REFERENCES technicians(id),
      name TEXT NOT NULL,
      due_date TEXT,
      overdue_days INTEGER DEFAULT 0
    );
  `);
}

function seed() {
  const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
  db.exec(seedSql);
}

function reset() {
  db.exec(`
    DELETE FROM outstanding_assignments;
    DELETE FROM completed_courses;
    DELETE FROM certifications;
    DELETE FROM ride_along_reviews;
    DELETE FROM technician_path_progress;
    DELETE FROM technicians;
    DELETE FROM training_paths;
    DELETE FROM managers;
  `);
  seed();
}

migrate();
seed();

module.exports = { db, reset };
