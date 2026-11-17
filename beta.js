/* PRD-543: the Beta Group version of the dashboard, served at /beta.
 *
 * The server sends one whole dashboard version plus
 * window.__BETA = { version, pages, parent, email, internal }.
 * This script:
 *  - hides every screen that isn't promoted (sidebar items, and any button
 *    that would open one), and opens on the first promoted screen;
 *  - for testers: a "Leave a note" button, and journey tracking (screens,
 *    time on each, button/link names clicked; never what's typed in fields);
 *  - for SkillCat staff previewing: a bar saying so, and no tracking.
 */
(function () {
  var cfg = window.__BETA;
  if (!cfg || !window.showPage) return;
  var allowed = {};
  cfg.pages.forEach(function (p) { allowed[p] = true; });
  function ok(id) { return !!(allowed[id] || allowed[cfg.parent[id]]); }
  function label(id) {
    var item = document.querySelector('.sidebar .nav-item[data-page="' + id + '"]');
    return item ? item.textContent.trim().split(/\s{2,}|\n/)[0].trim() : id;
  }

  // ---- bar + styles ---------------------------------------------------------
  var css = document.createElement("style");
  css.textContent = [
    ":root{--review-h:40px}",
    "body{box-sizing:border-box;padding-top:var(--review-h)}",
    ".app{height:calc(100vh - var(--review-h))!important}",
    ".add-person-panel{top:var(--review-h)!important}",
    ".notes-panel{top:calc(80px + var(--review-h))!important}",
    "@media (max-width:900px){.sidebar{top:var(--review-h)!important}.hamburger{top:calc(12px + var(--review-h))!important}}",
    ".beta-bar{position:fixed;top:0;left:0;right:0;height:var(--review-h);z-index:400;display:flex;align-items:center;gap:12px;",
    "padding:0 16px;box-sizing:border-box;background:#141416;border-bottom:1px solid #2a2a30;color:#d4d4d8;",
    "font:500 13px/1 'Fira Sans',system-ui,sans-serif}",
    ".beta-bar.staff{background:repeating-linear-gradient(135deg,#16203a 0 14px,#18233f 14px 28px);border-color:#3b5aa8;color:#c9d7fb}",
    ".beta-tag{font-weight:700;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#f7763d;white-space:nowrap}",
    ".beta-bar.staff .beta-tag{color:#7aa7ff}",
    ".beta-who{margin-left:auto;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".beta-bar a{color:inherit;font-weight:600;white-space:nowrap}",
    ".beta-note-btn{position:fixed;right:20px;bottom:20px;z-index:300;height:48px;padding:0 18px;border-radius:24px;",
    "border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,#b7431e,#792d14);color:#fff;",
    "font:600 15px 'Fira Sans',system-ui,sans-serif;display:flex;align-items:center;gap:8px;cursor:pointer;",
    "box-shadow:0 12px 30px rgba(0,0,0,.5)}",
    ".beta-note-btn svg{width:18px;height:18px;stroke:#fff;stroke-width:2;fill:none}",
    ".beta-ov{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;padding:20px}",
    ".beta-ov.open{display:flex}",
    ".beta-dlg{width:100%;max-width:520px;background:#1c1c20;border:1px solid #2a2a30;border-radius:16px;padding:22px;",
    "color:#f4f4f5;font-family:'Fira Sans',system-ui,sans-serif;display:flex;flex-direction:column;gap:12px}",
    ".beta-dlg h2{margin:0;font-size:20px}.beta-dlg p{margin:0;color:#a1a1aa;font-size:14px;line-height:1.45}",
    ".beta-dlg label{font-size:13.5px;font-weight:700;color:#d4d4d8}",
    ".beta-dlg textarea{width:100%;box-sizing:border-box;min-height:150px;border-radius:10px;border:1px solid #2e2e34;",
    "background:#0d0d10;color:#f4f4f5;padding:12px;font:15px/1.45 'Fira Sans',system-ui,sans-serif;resize:vertical}",
    ".beta-dlg textarea:focus{outline:none;border-color:#f7763d}",
    ".beta-acts{display:flex;justify-content:flex-end;gap:10px}",
    ".beta-acts button{height:44px;padding:0 18px;border-radius:10px;font:600 14.5px 'Fira Sans',sans-serif;cursor:pointer}",
    ".beta-cancel{background:none;border:1px solid #363636;color:#f4f4f5}",
    ".beta-send{background:linear-gradient(180deg,#b7431e,#792d14);border:1px solid rgba(255,255,255,.06);color:#fff}",
    ".beta-msg{font-size:13.5px;min-height:18px;color:#a1a1aa}.beta-msg.err{color:#f0584b}",
    ".beta-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:600;background:#1f1f24;",
    "border:1px solid #3a3a42;border-radius:10px;padding:12px 16px;color:#f4f4f5;font:500 14px 'Fira Sans',sans-serif;",
    "box-shadow:0 12px 30px rgba(0,0,0,.5);display:none}",
    // The mock platform's debug controls are for SkillCat, never testers.
    "#ra-dbg-btn,#ra-dbg,#ra-live-badge{display:none!important}",
    "@media (max-width:600px){.beta-who{display:none}.beta-note-btn{right:16px;bottom:16px}}"
  ].join("");
  document.head.appendChild(css);

  var bar = document.createElement("div");
  bar.className = "beta-bar" + (cfg.internal ? " staff" : "");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", cfg.internal ? "Beta Group preview" : "Preview");
  bar.innerHTML = cfg.internal
    ? '<span class="beta-tag">Beta Group preview</span><span class="beta-who">What testers see. Your visits aren\'t tracked.</span>' +
      '<a href="/?v=' + encodeURIComponent(cfg.version) + '">Back to the internal demo</a>'
    : '<span class="beta-tag">Preview</span><span class="beta-who">Signed in as ' + escapeHtml(cfg.email) + '</span>' +
      '<a href="/signout">Sign out</a>';
  document.body.insertBefore(bar, document.body.firstChild);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  var toastEl = document.createElement("div");
  toastEl.className = "beta-toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  var toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.style.display = "block";
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.style.display = "none"; }, 2600);
  }

  // ---- hide what isn't promoted ---------------------------------------------
  document.querySelectorAll(".sidebar .nav-item, .sidebar .nav-link").forEach(function (n) {
    var id = n.getAttribute("data-page");
    if (!id || !ok(id)) n.style.display = "none";
  });
  document.querySelectorAll(".sidebar .nav-group").forEach(function (g) {
    var shown = [].some.call(g.children, function (c) { return c.style.display !== "none"; });
    if (!shown) {
      g.style.display = "none";
      var lbl = g.previousElementSibling;
      if (lbl && lbl.classList.contains("nav-label")) lbl.style.display = "none";
    }
  });

  var realShow = window.showPage;
  window.showPage = function (id) {
    if (!ok(id)) { toast("That part of the dashboard isn't in this preview."); return; }
    realShow.apply(this, arguments);
    onScreen(id);
  };
  // Buttons elsewhere that open a hidden screen get the same treatment.
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-page]");
    if (t && !t.closest(".sidebar") && !ok(t.getAttribute("data-page"))) {
      e.preventDefault(); e.stopPropagation();
      toast("That part of the dashboard isn't in this preview.");
    }
  }, true);

  // ---- tracking (testers only) ----------------------------------------------
  var track = !cfg.internal;
  var sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  var queue = [], screen = null, since = 0, visible = !document.hidden;

  function push(type, extra) {
    if (!track) return;
    var e = { type: type, at: new Date().toISOString(), page: screen || "" };
    for (var k in extra) e[k] = extra[k];
    queue.push(e);
    if (queue.length >= 25) flush();
  }
  function closeScreen() {
    if (screen && visible && since) push("time", { page: screen, ms: Date.now() - since });
    since = visible ? Date.now() : 0;
  }
  function onScreen(id) {
    if (id === screen) return;
    closeScreen();
    screen = id; since = visible ? Date.now() : 0;
    push("view", { page: id });
  }
  function flush(final) {
    if (!track || !queue.length) return;
    var body = JSON.stringify({ sid: sid, events: queue.splice(0) });
    if (final && navigator.sendBeacon) { navigator.sendBeacon("/api/beta/events", body); return; }
    fetch("/api/beta/events", { method: "POST", body: body, credentials: "same-origin", keepalive: true }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { closeScreen(); visible = false; since = 0; flush(true); }
    else { visible = true; since = Date.now(); }
  });
  window.addEventListener("pagehide", function () { closeScreen(); flush(true); });
  setInterval(function () { closeScreen(); flush(); }, 15000);

  // Clicks: the name of the button or link, never what's typed in a field.
  document.addEventListener("click", function (e) {
    var el = e.target.closest("button, a, [role=button], [role=tab], .nav-item, summary, label");
    if (!el || el.closest(".beta-bar, .beta-ov, .beta-note-btn")) return;
    var name = el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "";
    name = name.replace(/\s+/g, " ").trim().slice(0, 80);
    if (name) push("click", { label: name });
  }, true);

  // ---- notes (testers only) --------------------------------------------------
  if (!cfg.internal) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "beta-note-btn";
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>Leave a note';
    document.body.appendChild(btn);
    var ov = document.createElement("div");
    ov.className = "beta-ov";
    ov.innerHTML = '<div class="beta-dlg" role="dialog" aria-modal="true" aria-labelledby="betaNoteH">' +
      '<h2 id="betaNoteH">Leave a note</h2><p id="betaNoteAbout"></p>' +
      '<label for="betaNoteText">Your note</label>' +
      '<textarea id="betaNoteText" placeholder="What worked, what was confusing, what you\'d change…"></textarea>' +
      '<div class="beta-msg" id="betaNoteMsg" role="alert"></div>' +
      '<div class="beta-acts"><button type="button" class="beta-cancel">Cancel</button><button type="button" class="beta-send">Send note</button></div></div>';
    document.body.appendChild(ov);
    var ta = ov.querySelector("textarea"), msg = ov.querySelector("#betaNoteMsg");
    function openNote() {
      ov.querySelector("#betaNoteAbout").textContent = "About the " + label(screen || "") + " screen. Only the SkillCat team sees notes.";
      msg.textContent = ""; msg.className = "beta-msg";
      ov.classList.add("open"); ta.focus();
    }
    function closeNote() { ov.classList.remove("open"); btn.focus(); }
    btn.addEventListener("click", openNote);
    ov.querySelector(".beta-cancel").addEventListener("click", closeNote);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeNote(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ov.classList.contains("open")) closeNote(); });
    ov.querySelector(".beta-send").addEventListener("click", function () {
      var text = ta.value.trim();
      if (!text) { msg.textContent = "Write a note first."; msg.className = "beta-msg err"; ta.focus(); return; }
      fetch("/api/beta/notes", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: screen || "", text: text }) })
        .then(function (r) { if (!r.ok) throw new Error(); ta.value = ""; closeNote(); toast("Thanks, your note was sent."); })
        .catch(function () { msg.textContent = "Couldn't send the note. Try again in a moment."; msg.className = "beta-msg err"; });
    });
  }

  // ---- start on a promoted screen ------------------------------------------
  var wanted = decodeURIComponent(location.hash.slice(1));
  var active = document.querySelector(".page.active");
  var cur = active && active.id ? active.id.replace(/^page-/, "") : "";
  var start = ok(wanted) ? wanted : ok(cur) ? cur : cfg.pages[0];
  if (start !== cur) realShow(start);
  onScreen(start);
  document.querySelectorAll('.sidebar .nav-item').forEach(function (n) {
    n.classList.toggle("active", n.getAttribute("data-page") === (cfg.parent[start] || start));
  });
})();
