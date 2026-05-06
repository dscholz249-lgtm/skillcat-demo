-- Managers
INSERT INTO managers (id, name, phone_e164) VALUES
  (1, 'Mike Daniels', '+15555550199'),
  (2, 'Sarah Lin',    '+15555550188'),
  (3, 'Jay Romero',   '+15555550177');

-- Training paths
INSERT INTO training_paths (id, name, total_modules) VALUES
  (1, 'Advanced Diagnostics',  30),
  (2, 'Refrigeration Mastery', 22),
  (3, 'HVAC Fundamentals',     18),
  (4, 'Install Basics',        20),
  (5, 'Heat Pump Specialist',  24),
  (6, 'Commercial Install',    26);

-- Technicians (manager assignments match the dashboard prototype)
INSERT INTO technicians (id, name, initials, role, department, manager_id, hire_date, field_ready_status, current_path_id) VALUES
  (1,  'James Thornton',    'JT', 'Lead Tech',   'HVAC Service', 1, '2022-08-12', 'yes',     1),
  (2,  'Maria Reyes',       'MR', 'Senior Tech', 'HVAC Service', 1, '2023-04-03', 'yes',     2),
  (3,  'Tyrell Washington', 'TW', 'Junior Tech', 'HVAC Service', 2, '2025-11-20', 'pending', 3),
  (4,  'Marcus Chen',       'MC', 'Apprentice',  'HVAC Install', 3, '2026-01-08', 'no',      4),
  (5,  'Diana Foster',      'DF', 'Senior Tech', 'HVAC Service', 1, '2021-09-15', 'yes',     5),
  (6,  'Ravi Patel',        'RP', 'Junior Tech', 'HVAC Install', 3, '2025-06-30', 'yes',     4),
  (7,  'Lauren Mitchell',   'LM', 'Junior Tech', 'HVAC Service', 1, '2026-01-15', 'pending', 2),
  (8,  'Brandon Kim',       'BK', 'Apprentice',  'HVAC Service', 2, '2026-02-10', 'no',      3),
  (9,  'Devon Sanders',     'DS', 'Senior Tech', 'HVAC Install', 3, '2022-03-22', 'yes',     6),
  (10, 'Anthony Russo',     'AR', 'Junior Tech', 'HVAC Service', 2, '2025-09-04', 'yes',     3);

-- Path progress (technician_id, path_id, modules_complete, days_in_path, cohort_avg_days, status)
INSERT INTO technician_path_progress (technician_id, path_id, modules_complete, days_in_path, cohort_avg_days, status) VALUES
  (1, 1, 28, 92, 95, 'on-track'),
  (2, 2, 17, 75, 58, 'behind'),
  (3, 3, 11, 50, 52, 'on-track'),
  (4, 4,  9, 70, 50, 'behind'),
  (5, 5, 21, 80, 78, 'on-track'),
  (6, 4, 14, 60, 62, 'on-track'),
  (7, 2, 12, 65, 48, 'behind'),
  (8, 3,  5, 95, 45, 'on-track'),
  (9, 6, 21, 78, 80, 'stalled'),
  (10, 3, 16, 65, 60, 'on-track');

-- Lauren's ride-along history
INSERT INTO ride_along_reviews (technician_id, reviewer_id, occurred_date, context, response, note, source, responded_at) VALUES
  (7, 1, '2026-03-18', 'basic install ride-along',            'yes', NULL,                                                                                   'sms', '2026-03-18 19:42:00'),
  (7, 1, '2026-04-10', 'advanced refrigeration ride-along',   'no',  'Strong on diagnostics, less confident on refrigerant recovery. Pairing with Diana on next ride-along.', 'sms', '2026-04-10 20:14:00');

-- Pending reviews (the demo's two SMS sends)
INSERT INTO ride_along_reviews (technician_id, reviewer_id, occurred_date, context, response, source) VALUES
  (3, 2, '2026-04-28', 'first solo service call assessment',  'pending', 'sms'),
  (7, 1, '2026-05-02', 'refrigeration recovery service call', 'pending', 'sms');

-- Lauren's certifications
INSERT INTO certifications (technician_id, name, issued_date, expires_date, in_progress, progress_pct) VALUES
  (7, 'EPA 608 Universal', '2026-02-05', NULL,         0, NULL),
  (7, 'OSHA-10',           '2026-01-22', '2031-01-22', 0, NULL),
  (7, 'NATE Core',         NULL,         NULL,         1, 65);

-- Lauren's completed courses
INSERT INTO completed_courses (technician_id, name, completed_date, module_count, hours, score) VALUES
  (7, 'HVAC Fundamentals',          '2026-03-05', 22, 48, '94%'),
  (7, 'EPA 608 Prep',               '2026-02-01', 14, 32, '88%'),
  (7, 'Tools & Safety Basics',      '2026-01-28',  8, 18, '96%'),
  (7, 'OSHA-10 Construction Safety','2026-01-22', NULL, 10, 'Pass');

-- Lauren's outstanding assignments
INSERT INTO outstanding_assignments (technician_id, name, due_date, overdue_days) VALUES
  (7, 'Recovery & Charge Calculations', '2026-04-28', 7),
  (7, 'Pressure-Temp Charts Quiz',      '2026-05-07', 0),
  (7, 'Leak Detection Practical',       '2026-05-14', 0);
