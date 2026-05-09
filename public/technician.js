(function () {
  const id = Number(window.location.pathname.split('/').pop());
  const body = document.getElementById('td-body');
  const current = document.getElementById('td-current');

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const SHORT_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function parseISO(d) {
    if (!d) return null;
    const parts = d.split(/[-T :]/).map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function fmtDate(iso, withWeekday) {
    const d = parseISO(iso);
    if (!d) return '';
    const md = `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    return withWeekday ? `${SHORT_WEEKDAYS[d.getDay()]} ${md}` : md;
  }

  function tenureLabel(iso) {
    const hire = parseISO(iso);
    if (!hire) return '';
    const now = new Date();
    let months = (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth());
    if (now.getDate() < hire.getDate()) months -= 1;
    if (months < 1) return 'less than 1 month tenure';
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} tenure`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    if (rem === 0) return `${years} year${years === 1 ? '' : 's'} tenure`;
    return `${years}y ${rem}m tenure`;
  }

  function statusLabel(s) {
    if (s === 'on-track') return 'On track';
    if (s === 'behind')   return 'Falling behind';
    if (s === 'stalled')  return 'Stalled';
    return s;
  }

  function readyLabel(r) {
    if (r === 'yes') return 'Field ready';
    if (r === 'no')  return 'Not ready';
    return 'Pending review';
  }

  function pronounSubject(name) {
    return name ? name.split(' ')[0] : 'them';
  }

  function renderHeaderCard(t) {
    const latest = t.ride_along_reviews && t.ride_along_reviews[0];
    const isPending = t.field_ready_status === 'pending';
    const lastRideHtml = latest
      ? `Last ride-along: <strong style="color:var(--sc-navy);font-weight:500;">${fmtDate(latest.occurred_date, true)}</strong><br>${latest.response === 'pending'
          ? `Awaiting ${escapeHtml(latest.reviewer_name || 'manager')}'s response`
          : `Reviewed by ${escapeHtml(latest.reviewer_name || 'manager')}`}`
      : 'No ride-alongs yet';

    return `
      <div class="header-card">
        <div class="header-row">
          <div class="identity">
            <div class="av">${escapeHtml(t.initials)}</div>
            <div>
              <h2>${escapeHtml(t.name)}</h2>
              <div class="meta">
                <strong>${escapeHtml(t.role)}</strong> · ${escapeHtml(t.department)} · Tech #${1000 + t.id}<br>
                Reports to <strong>${escapeHtml(t.manager.name || '—')}</strong><br>
                Hired ${fmtDate(t.hire_date)} · ${tenureLabel(t.hire_date)}
              </div>
            </div>
          </div>
          <div class="status-block">
            <span class="ready-badge ${t.field_ready_status}"><span class="dot"></span>${readyLabel(t.field_ready_status)}</span>
            <div class="last-ride">${lastRideHtml}</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" id="td-resend" type="button" ${isPending ? '' : 'disabled'}>${isPending ? 'Resend review SMS' : 'No pending review'}</button>
          <button class="btn secondary" type="button" disabled title="Not available in prototype">Send training nudge</button>
        </div>
      </div>
    `;
  }

  function renderPathSection(t) {
    if (!t.path || !t.path.id) {
      return `<div class="section"><div class="section-header"><h3>Current training path</h3></div><div class="section-body"><div class="empty-state">No active training path.</div></div></div>`;
    }
    const tag = `<span class="status-tag ${t.path.status}">${statusLabel(t.path.status)}</span>`;
    const assignments = (t.outstanding_assignments || []).length === 0
      ? `<div class="empty-state">No outstanding assignments.</div>`
      : t.outstanding_assignments.map(a => `
          <div class="assignment ${a.overdue_days > 0 ? 'overdue' : ''}">
            <span class="name">${escapeHtml(a.name)}</span>
            <span class="due">${a.overdue_days > 0 ? `Overdue ${a.overdue_days} day${a.overdue_days === 1 ? '' : 's'}` : `Due ${fmtDate(a.due_date)}`}</span>
          </div>
        `).join('');

    return `
      <div class="section">
        <div class="section-header"><h3>Current training path</h3>${tag}</div>
        <div class="section-body">
          <div class="path-summary ${t.path.status}">
            <div class="path-name">${escapeHtml(t.path.name)}</div>
            <div class="path-bar"><div style="width:${t.path.pct}%;"></div></div>
            <div class="path-pct">${t.path.pct}% complete · ${t.path.modules_complete} of ${t.path.total_modules} modules done</div>
          </div>
          <p class="assignments-title">Outstanding assignments</p>
          ${assignments}
        </div>
      </div>
    `;
  }

  function renderCourses(t) {
    const list = t.completed_courses || [];
    const totalHours = list.reduce((s, c) => s + (c.hours || 0), 0);
    const meta = list.length === 0 ? '' : `<span class="meta-tag">${list.length} finished · ${totalHours} hrs</span>`;
    if (list.length === 0) {
      return `<div class="section"><div class="section-header"><h3>Completed courses</h3></div><div class="section-body"><div class="empty-state">No courses completed yet.</div></div></div>`;
    }
    return `
      <div class="section">
        <div class="section-header"><h3>Completed courses</h3>${meta}</div>
        <div class="section-body">
          <div class="course-list">
            ${list.map(c => `
              <div class="course">
                <span class="check"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6 L5 9 L10 3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                <div class="info">
                  <div class="name">${escapeHtml(c.name)}</div>
                  <div class="detail">Completed ${fmtDate(c.completed_date)}${c.module_count ? ` · ${c.module_count} modules` : ''}${c.hours ? ` · ${c.hours} hrs` : ''}</div>
                </div>
                ${c.score ? `<span class="score">${escapeHtml(c.score)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderCerts(t) {
    const list = t.certifications || [];
    if (list.length === 0) {
      return `<div class="section"><div class="section-header"><h3>Certifications</h3></div><div class="section-body"><div class="empty-state">No certifications on file.</div></div></div>`;
    }
    return `
      <div class="section">
        <div class="section-header"><h3>Certifications</h3></div>
        <div class="section-body">
          <div class="cert-grid">
            ${list.map(c => {
              if (c.in_progress) {
                return `<div class="cert pending">
                  <div class="name">${escapeHtml(c.name)}</div>
                  <div class="dates">In progress</div>
                  <div class="mini-bar"><div style="width:${c.progress_pct || 0}%;"></div></div>
                  <div class="progress">${c.progress_pct || 0}% complete</div>
                </div>`;
              }
              return `<div class="cert">
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="dates">Issued ${fmtDate(c.issued_date)} · ${c.expires_date ? `Expires ${fmtDate(c.expires_date)}` : 'Lifetime'}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderHistory(t) {
    const list = t.ride_along_reviews || [];
    if (list.length === 0) {
      return `<div class="section"><div class="section-header"><h3>Ride-along history</h3></div><div class="section-body"><div class="empty-state">No ride-alongs yet — first review hasn't been requested.</div></div></div>`;
    }
    const reviewed = list.filter(r => r.response === 'yes' || r.response === 'no');
    const ready = reviewed.filter(r => r.response === 'yes').length;
    const trend = reviewed.length === 0
      ? `<span><strong>${list.length}</strong> ride-along${list.length === 1 ? '' : 's'} on record · all pending</span>`
      : `<span><strong>${ready} of ${reviewed.length}</strong> prior ride-along${reviewed.length === 1 ? '' : 's'} marked Ready</span>`;
    const captured = list.filter(r => r.source === 'sms').length;

    return `
      <div class="section">
        <div class="section-header"><h3>Ride-along history</h3></div>
        <div class="section-body">
          <div class="trend">${trend}<span style="font-size:11px;">${captured} review${captured === 1 ? '' : 's'} captured via SMS</span></div>
          <div class="timeline">
            ${list.map(r => {
              const cls = r.response === 'yes' ? 'yes' : r.response === 'no' ? 'no' : 'pending';
              const tag = r.response === 'yes' ? 'Ready' : r.response === 'no' ? 'Not ready' : 'Pending';
              const meta = r.response === 'pending'
                ? `Awaiting ${escapeHtml(r.reviewer_name || 'manager')} · ${escapeHtml(r.context || 'ride-along')}`
                : `Reviewed by ${escapeHtml(r.reviewer_name || 'manager')} via SMS · ${escapeHtml(r.context || 'ride-along')}`;
              const note = r.note
                ? `<div class="tl-note">"${escapeHtml(r.note)}"<div class="src">Captured via SMS follow-up</div></div>`
                : '';
              return `<div class="tl-entry ${cls}">
                <div class="tl-head"><span class="tl-date">${fmtDate(r.occurred_date, true)}</span><span class="tl-result ${cls}">${tag}</span></div>
                <div class="tl-meta">${meta}</div>
                ${note}
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderNotes() {
    return `
      <div class="section">
        <div class="section-header"><h3>Manager notes</h3></div>
        <div class="section-body">
          <div class="empty-state">Notes feature not available in prototype.</div>
        </div>
      </div>
    `;
  }

  async function load() {
    const res = await fetch(`/api/technicians/${id}`);
    if (!res.ok) {
      body.innerHTML = `<div class="empty-state">Technician not found. <a href="/">Back to dashboard</a></div>`;
      current.textContent = 'Not found';
      return;
    }
    const t = await res.json();
    document.title = `SkillCat — ${t.name}`;
    current.textContent = t.name;

    body.innerHTML =
      renderHeaderCard(t) +
      renderPathSection(t) +
      renderCourses(t) +
      renderCerts(t) +
      renderHistory(t) +
      renderNotes();

    window.SkillCatTrack && window.SkillCatTrack.capture('tech_detail_viewed', {
      tech_id: t.id,
      tech_name: t.name,
      field_ready_status: t.field_ready_status,
      path_status: t.path && t.path.status
    });

    const resend = document.getElementById('td-resend');
    if (resend && !resend.disabled) {
      resend.addEventListener('click', () => {
        window.SkillCatTrack && window.SkillCatTrack.capture('sms_modal_opened', { source: 'tech_detail_resend', tech_id: t.id });
        window.SkillCatSMS.open({ onChange: load, focusTechId: t.id });
      });
    }
  }

  load();
})();
