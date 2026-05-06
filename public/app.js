(function () {
  const tbody       = document.getElementById('sc-tbody');
  const search      = document.getElementById('sc-search');
  const filterToggle= document.getElementById('sc-filter-toggle');
  const filterPanel = document.getElementById('sc-filter-panel');
  const filterCount = document.getElementById('sc-filter-count');
  const dept        = document.getElementById('sc-dept');
  const ready       = document.getElementById('sc-ready');
  const sort        = document.getElementById('sc-sort');
  const clearBtn    = document.getElementById('sc-clear');

  const stamp        = document.getElementById('sc-stamp');
  const statTotal    = document.getElementById('stat-total');
  const statTotalDelta = document.getElementById('stat-total-delta');
  const statReady    = document.getElementById('stat-ready');
  const statReadyDelta = document.getElementById('stat-ready-delta');
  const statTrack    = document.getElementById('stat-track');
  const statTrackDelta = document.getElementById('stat-track-delta');
  const statPending  = document.getElementById('stat-pending');
  const statPendingDelta = document.getElementById('stat-pending-delta');
  const openSmsBtn   = document.getElementById('open-sms');

  let cache = { technicians: [], stats: null };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function load() {
    const res = await fetch('/api/technicians');
    cache = await res.json();
    render();
  }

  function setStats(s) {
    statTotal.textContent   = s.total;
    statTotalDelta.textContent = `Across ${new Set(cache.technicians.map(t => t.department)).size} departments`;

    statReady.textContent   = `${s.field_ready} / ${s.total}`;
    statReadyDelta.textContent = `${Math.round((s.field_ready / s.total) * 100)}% of team`;

    statTrack.textContent   = `${s.on_track} / ${s.total}`;
    const trackParts = [];
    if (s.behind)  trackParts.push(`${s.behind} behind`);
    if (s.stalled) trackParts.push(`${s.stalled} stalled`);
    statTrackDelta.textContent = trackParts.join(' · ') || 'All on track';

    statPending.textContent = s.awaiting_review;
    statPendingDelta.textContent = s.awaiting_review === 0 ? 'All caught up' : 'Tap to send SMS';
    openSmsBtn.disabled = s.awaiting_review === 0;
    openSmsBtn.textContent = s.awaiting_review === 0 ? 'No pending reviews' : 'Send review SMS to managers →';

    const now = new Date();
    stamp.textContent = `Updated ${now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  function activeFilterCount() {
    let n = 0;
    if (dept.value !== 'all')  n++;
    if (ready.value !== 'all') n++;
    if (sort.value !== 'name') n++;
    return n;
  }

  function readyLabel(r) {
    if (r === 'yes') return 'Ready';
    if (r === 'no')  return 'Not ready';
    return 'Pending';
  }

  function statusLabel(s) {
    if (s === 'on-track') return 'On track';
    if (s === 'behind')   return 'Falling behind';
    if (s === 'stalled')  return 'Stalled';
    return s;
  }

  function render() {
    if (!cache.stats) return;
    setStats(cache.stats);

    const q = (search.value || '').toLowerCase();
    let rows = cache.technicians.filter(t => {
      if (q && !(t.name.toLowerCase().includes(q) || t.role.toLowerCase().includes(q) || (t.manager_name || '').toLowerCase().includes(q))) return false;
      if (dept.value !== 'all'  && t.department !== dept.value)             return false;
      if (ready.value !== 'all' && t.field_ready_status !== ready.value)    return false;
      return true;
    });

    const statusOrder = { stalled: 0, behind: 1, 'on-track': 2 };
    if (sort.value === 'status')        rows.sort((a, b) => statusOrder[a.path.status] - statusOrder[b.path.status]);
    else if (sort.value === 'progress') rows.sort((a, b) => a.path.pct - b.path.pct);
    else                                rows.sort((a, b) => a.name.localeCompare(b.name));

    if (rows.length === 0) {
      tbody.innerHTML = '<tr class="sc-empty-row"><td colspan="6">No technicians match these filters.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(t => `
        <tr data-id="${t.id}">
          <td data-label="Technician"><div class="sc-tech"><div class="av">${escapeHtml(t.initials)}</div><div><div class="name">${escapeHtml(t.name)}</div><div class="id">Tech #${1000 + t.id}</div></div></div></td>
          <td data-label="Department">${escapeHtml(t.department)}</td>
          <td data-label="Role">${escapeHtml(t.role)}</td>
          <td data-label="Manager">${escapeHtml(t.manager_name || '—')}</td>
          <td data-label="Current training path"><div class="sc-path ${t.path.status}"><div class="name">${escapeHtml(t.path.name || '—')}</div><div class="sc-bar"><div style="width: ${t.path.pct}%;"></div></div><div class="pct">${t.path.pct}% · ${statusLabel(t.path.status)}</div></div></td>
          <td data-label="Field ready"><span class="sc-ready ${t.field_ready_status}"><span class="dot"></span>${readyLabel(t.field_ready_status)}</span></td>
        </tr>
      `).join('');
      tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('click', () => {
          window.location.href = `/technicians/${tr.dataset.id}`;
        });
      });
    }

    const n = activeFilterCount();
    if (n > 0) { filterCount.textContent = n; filterCount.style.display = 'inline-flex'; filterToggle.classList.add('active'); }
    else       { filterCount.style.display = 'none'; filterToggle.classList.remove('active'); }
  }

  filterToggle.addEventListener('click', () => filterPanel.classList.toggle('open'));
  clearBtn.addEventListener('click', () => {
    dept.value = 'all'; ready.value = 'all'; sort.value = 'name'; search.value = '';
    render();
  });
  search.addEventListener('input', render);
  dept.addEventListener('change', render);
  ready.addEventListener('change', render);
  sort.addEventListener('change', render);

  openSmsBtn.addEventListener('click', () => {
    if (openSmsBtn.disabled) return;
    window.SkillCatSMS.open({ onChange: load });
  });

  // User menu dropdown
  const menuTrigger = document.getElementById('user-menu-trigger');
  const menuPanel   = document.getElementById('user-menu-panel');
  const menuReset   = document.getElementById('user-menu-reset');

  function closeMenu() {
    menuPanel.hidden = true;
    menuTrigger.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    menuPanel.hidden = false;
    menuTrigger.setAttribute('aria-expanded', 'true');
  }

  menuTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuPanel.hidden) openMenu(); else closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menuPanel.hidden && !menuPanel.contains(e.target) && e.target !== menuTrigger) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menuPanel.hidden) closeMenu();
  });

  menuReset.addEventListener('click', async () => {
    menuReset.disabled = true;
    const titleEl = menuReset.querySelector('.title');
    const original = titleEl.textContent;
    titleEl.textContent = 'Resetting…';
    try {
      await fetch('/api/admin/reset', { method: 'POST' });
      await load();
      titleEl.textContent = 'Demo reset ✓';
      setTimeout(() => {
        titleEl.textContent = original;
        menuReset.disabled = false;
        closeMenu();
      }, 900);
    } catch (err) {
      titleEl.textContent = 'Reset failed';
      setTimeout(() => { titleEl.textContent = original; menuReset.disabled = false; }, 1500);
    }
  });

  load();
  setInterval(load, 5000);
})();
