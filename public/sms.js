(function () {
  // Public API: window.SkillCatSMS.open({ onChange?, focusTechId? })
  // - onChange: called whenever a review's state has been mutated server-side
  // - focusTechId: if provided, only show that tech's pending review (used from detail page)

  const TYPING_MS  = 900;
  const PAUSE_MS   = 500;
  const ADVANCE_MS = 700;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function buildSimulatorMarkup() {
    return `
      <div class="stage">
        <div class="phone">
          <div class="screen">
            <div class="status-bar">
              <span>9:14</span>
              <div class="right">
                <svg viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 11h2M5 9h2M9 7h2M13 5h2" stroke-linecap="round"/></svg>
                <span style="font-size:11px;">5G</span>
                <svg viewBox="0 0 22 10" fill="currentColor"><rect x="0.5" y="0.5" width="18" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="0.6"/><rect x="2" y="2" width="13" height="6" rx="1"/><rect x="19.5" y="3.5" width="1.5" height="3" rx="0.5"/></svg>
              </div>
            </div>
            <div class="imsg-header">
              <div class="avatar">SC</div>
              <div class="sender">SkillCat <span class="arrow">›</span></div>
            </div>
            <div class="chat" id="sms-chat"></div>
            <div class="input-bar">
              <div class="quick-replies" id="sms-qr" style="display:none;">
                <button class="qr-btn" data-reply="Y" type="button">Y — Ready</button>
                <button class="qr-btn" data-reply="N" type="button">N — Not yet</button>
              </div>
              <div class="note-input" id="sms-note">
                <div class="suggestions" id="sms-suggestions"></div>
                <div class="input-row">
                  <input type="text" id="sms-note-field" placeholder="Type a note..." />
                  <button class="send-btn" id="sms-note-send" type="button" disabled>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 14V2M3 7l5-5 5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="skip-btn" id="sms-note-skip" type="button">SKIP</button>
                </div>
              </div>
              <div class="input-resting" id="sms-resting" style="display:none;">
                <div class="field">iMessage</div>
              </div>
            </div>
          </div>
        </div>

        <div class="reflection" id="sms-reflection">
          <div style="display:flex; justify-content: space-between; align-items: center;">
            <h3>Dashboard reflection</h3>
            <span class="pulse" id="sms-pulse">Live</span>
          </div>
          <div class="stat-mini">
            <span class="lbl">Awaiting ride-along review</span>
            <span class="val" id="sms-awaiting">—</span>
          </div>
          <div id="sms-cards"></div>
          <button class="reset-btn" id="sms-reset" type="button">Reset demo</button>
        </div>
      </div>
    `;
  }

  // -------- chat helpers --------

  function appendBubble(chat, side, text, withDelivered) {
    const row = document.createElement('div');
    row.className = `bubble-row ${side}`;
    const b = document.createElement('div');
    b.className = `bubble ${side}`;
    b.textContent = text;
    row.appendChild(b);
    chat.appendChild(row);
    if (withDelivered) {
      const d = document.createElement('div');
      d.className = 'delivered';
      d.textContent = 'Delivered';
      chat.appendChild(d);
    }
    chat.scrollTop = chat.scrollHeight;
  }

  function appendTimestamp(chat, label) {
    const t = document.createElement('div');
    t.className = 'timestamp';
    t.innerHTML = `<span class="day">Today</span> ${label}`;
    chat.appendChild(t);
    chat.scrollTop = chat.scrollHeight;
  }

  function appendTyping(chat) {
    const row = document.createElement('div');
    row.className = 'bubble-row in';
    row.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
    return row;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // -------- reflection panel --------

  function renderCards(reviews, activeId, statesById) {
    return reviews.map(r => {
      const state = statesById[r.id] || { ready: 'pending', note: null };
      const cls   = state.ready;
      const label = cls === 'yes' ? 'Ready' : cls === 'no' ? 'Not ready' : 'Pending';
      const meta  = state.ready === 'pending'
        ? `Ride-along ${r.weekday} · awaiting ${escapeHtml(r.reviewer_name)}`
        : state.ready === 'yes'
          ? `Reviewed by ${escapeHtml(r.reviewer_name)} · just now`
          : `Flagged for additional ride-along · ${escapeHtml(r.reviewer_name)} just now`;
      const noteBlock = state.note
        ? `<div class="captured-note show"><div class="label">Note from ${escapeHtml(r.reviewer_name.split(' ')[0])}</div>"${escapeHtml(state.note)}"</div>`
        : '';
      return `
        <div class="row-card ${activeId === r.id ? 'active' : ''}">
          <div class="tech">
            <div class="av">${escapeHtml(r.tech_initials)}</div>
            <div>
              <div class="name">${escapeHtml(r.tech_name)}</div>
              <div class="role">${escapeHtml(r.tech_role)} · ${escapeHtml(r.tech_department)}</div>
            </div>
          </div>
          <div class="field-row">
            <span class="key">Field ready</span>
            <span class="ready ${cls}"><span class="dot"></span>${label}</span>
          </div>
          <div class="meta ${state.ready === 'yes' ? 'success' : ''}">${meta}</div>
          ${noteBlock}
        </div>
      `;
    }).join('');
  }

  // -------- runner --------

  async function run(root, opts) {
    root.innerHTML = buildSimulatorMarkup();

    const chat       = root.querySelector('#sms-chat');
    const qr         = root.querySelector('#sms-qr');
    const note       = root.querySelector('#sms-note');
    const noteField  = root.querySelector('#sms-note-field');
    const noteSend   = root.querySelector('#sms-note-send');
    const noteSkip   = root.querySelector('#sms-note-skip');
    const suggBox    = root.querySelector('#sms-suggestions');
    const resting    = root.querySelector('#sms-resting');
    const reflection = root.querySelector('#sms-reflection');
    const pulse      = root.querySelector('#sms-pulse');
    const awaiting   = root.querySelector('#sms-awaiting');
    const cardsEl    = root.querySelector('#sms-cards');
    const resetBtn   = root.querySelector('#sms-reset');

    function setBar(mode) {
      qr.style.display      = mode === 'qr'      ? 'flex' : 'none';
      note.classList.toggle('show',   mode === 'note');
      resting.style.display = mode === 'resting' ? 'flex' : 'none';
    }

    function bumpPulse(text) {
      reflection.classList.add('done');
      pulse.textContent = text;
    }

    // Pull pending reviews (server composes correct first vs continuity phrasing per filter)
    const url = opts.focusTechId ? `/api/reviews/pending?tech_id=${opts.focusTechId}` : '/api/reviews/pending';
    const r = await fetch(url);
    const data = await r.json();
    const reviews = data.reviews;

    if (reviews.length === 0) {
      chat.innerHTML = '';
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:24px;text-align:center;color:#8E8E93;font-size:13px;';
      empty.textContent = 'No pending ride-along reviews. Reset the demo to send fresh ones.';
      chat.appendChild(empty);
      setBar('resting');
      awaiting.textContent = '0';
      cardsEl.innerHTML = '';
      attachReset();
      return;
    }

    const statesById = {};
    reviews.forEach(rv => { statesById[rv.id] = { ready: 'pending', note: null }; });
    awaiting.textContent = String(reviews.length);
    cardsEl.innerHTML = renderCards(reviews, reviews[0].id, statesById);

    appendTimestamp(chat, '8:42 AM');

    let firstSent = false;

    async function sendOutbound(rv) {
      cardsEl.innerHTML = renderCards(reviews, rv.id, statesById);
      for (const line of rv.outbound_lines) {
        appendBubble(chat, 'in', line, false);
        await delay(120);
      }
      const d = document.createElement('div');
      d.className = 'delivered';
      d.textContent = 'Delivered';
      chat.appendChild(d);
      chat.scrollTop = chat.scrollHeight;
    }

    async function awaitQuickReply() {
      setBar('qr');
      qr.querySelectorAll('button').forEach(b => b.disabled = false);
      return new Promise(resolve => {
        qr.querySelectorAll('button').forEach(b => {
          b.addEventListener('click', () => {
            qr.querySelectorAll('button').forEach(x => x.disabled = true);
            resolve(b.dataset.reply);
          }, { once: true });
        });
      });
    }

    async function awaitNote() {
      setBar('note');
      noteField.value = '';
      noteField.disabled = false;
      noteSend.disabled = true;
      noteField.focus();

      return new Promise(resolve => {
        const onInput = () => { noteSend.disabled = noteField.value.trim().length === 0; };
        const submit = () => {
          const v = noteField.value.trim();
          if (!v) return;
          cleanup();
          resolve({ kind: 'text', body: v });
        };
        const skip = () => { cleanup(); resolve({ kind: 'skip', body: 'SKIP' }); };
        const onKey = (e) => { if (e.key === 'Enter') submit(); };
        function cleanup() {
          noteField.disabled = true;
          noteSend.disabled = true;
          noteField.removeEventListener('input', onInput);
          noteField.removeEventListener('keydown', onKey);
          noteSend.removeEventListener('click', submit);
          noteSkip.removeEventListener('click', skip);
        }
        noteField.addEventListener('input', onInput);
        noteField.addEventListener('keydown', onKey);
        noteSend.addEventListener('click', submit);
        noteSkip.addEventListener('click', skip);
      });
    }

    function suggestionsFor(tech_id) {
      // Light contextual hints — keep it generic.
      return [
        'Needs more ride-along practice',
        'Pair with a senior tech next time',
        'Strong on basics, weak on diagnostics'
      ];
    }

    function showSuggestions(tech_id) {
      const sug = suggestionsFor(tech_id);
      suggBox.innerHTML = sug.map(s => `<button class="sug-chip" type="button">${escapeHtml(s)}</button>`).join('');
      suggBox.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          noteField.value = b.textContent;
          noteSend.disabled = false;
          noteField.focus();
        });
      });
    }

    async function postInbound(review_id, body) {
      const res = await fetch('/api/sms/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id, body })
      });
      return res.json();
    }

    // Walk through reviews
    for (let i = 0; i < reviews.length; i++) {
      const rv = reviews[i];

      // Outbound (initial OR continuity-framed — server composed it for us)
      await sendOutbound(rv);
      await delay(PAUSE_MS);

      // Quick reply Y or N
      const reply = await awaitQuickReply();
      appendBubble(chat, 'out', reply, true);
      await delay(PAUSE_MS);

      const t1 = appendTyping(chat);
      await delay(TYPING_MS);
      t1.remove();

      const r1 = await postInbound(rv.id, reply);
      appendBubble(chat, 'in', r1.reply, false);

      if (reply === 'Y') {
        statesById[rv.id] = { ready: 'yes', note: null };
        awaiting.textContent = String(reviews.length - (i + 1));
        cardsEl.innerHTML = renderCards(reviews, reviews[i + 1] ? reviews[i + 1].id : null, statesById);
        bumpPulse('Updated');
        if (opts.onChange) opts.onChange();
      } else {
        // N → note flow
        statesById[rv.id] = { ready: 'no', note: null };
        cardsEl.innerHTML = renderCards(reviews, rv.id, statesById);

        await delay(PAUSE_MS);
        showSuggestions(rv.technician_id);
        const noteRes = await awaitNote();
        appendBubble(chat, 'out', noteRes.body, true);
        await delay(PAUSE_MS);

        const t2 = appendTyping(chat);
        await delay(TYPING_MS);
        t2.remove();

        const r2 = await postInbound(rv.id, noteRes.body);
        appendBubble(chat, 'in', r2.reply, false);

        if (noteRes.kind === 'text') statesById[rv.id] = { ready: 'no', note: noteRes.body };
        awaiting.textContent = String(reviews.length - (i + 1));
        cardsEl.innerHTML = renderCards(reviews, reviews[i + 1] ? reviews[i + 1].id : null, statesById);
        bumpPulse('Updated');
        if (opts.onChange) opts.onChange();
      }

      // Brief pause before the next outbound
      if (i < reviews.length - 1) {
        await delay(ADVANCE_MS);
      }
    }

    setBar('resting');
    bumpPulse('Done');

    function attachReset() {
      resetBtn.addEventListener('click', async () => {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetting…';
        await fetch('/api/admin/reset', { method: 'POST' });
        if (opts.onChange) opts.onChange();
        // Re-run the simulator from a clean slate
        await run(root, opts);
      }, { once: true });
    }
    attachReset();
  }

  // -------- modal wiring --------

  function open(opts = {}) {
    const overlay = document.getElementById('sms-modal');
    const root    = document.getElementById('sms-app');
    const close   = document.getElementById('sms-close');
    if (!overlay || !root) return;

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    function dismiss() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      root.innerHTML = '';
      close.removeEventListener('click', dismiss);
      overlay.removeEventListener('click', backdrop);
      document.removeEventListener('keydown', onKey);
      if (opts.onChange) opts.onChange();
    }
    function backdrop(e) { if (e.target === overlay) dismiss(); }
    function onKey(e)    { if (e.key === 'Escape') dismiss(); }

    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', backdrop);
    document.addEventListener('keydown', onKey);

    run(root, opts).catch(err => {
      console.error(err);
      root.innerHTML = `<div style="padding:20px;color:#B91C1C;">Simulator error: ${escapeHtml(err.message)}</div>`;
    });
  }

  window.SkillCatSMS = { open };
})();
