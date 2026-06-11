/* ridealong-live.js
 * Injected by the mock platform. Activates ONLY when the mock API is reachable.
 * Opened as a plain file (no API), this no-ops and the prototype is unchanged.
 *
 * Wires three ride-along surfaces to the mock:
 *   1. Person Detail Notes panel  -> ride-along reviews as a distinct entry type
 *   2. Inbox                      -> one To Do row per review
 *   3. (Roster is consumed by the mini-app composer, not the prototype)
 * Plus a debug panel for the edge cases the polished UI hides.
 */
(function () {
  "use strict";
  var COMPANY = "co_test";
  var API = "/api/ride-along";
  var DBG = "/api/debug";

  function get(url) { return fetch(url).then(function (r) { return r.json(); }); }
  function post(url) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
  }

  // --- activate only if the mock is actually serving us ----------------------
  get(API + "/roster?company_id=" + COMPANY)
    .then(function (roster) { boot(roster); })
    .catch(function () { /* no mock -> leave prototype as-is */ });

  function boot(roster) {
    injectStyles();
    liveBadge();
    wireNotesPanel();
    refreshInbox();
    buildDebugPanel();
    setInterval(refreshInbox, 4000);
    setInterval(refreshDebug, 4000);
  }

  // --------------------------------------------------------------- 1. NOTES
  // The notes header reads "Manager Notes · <Name>". We pull ride-along reviews
  // for that person and inject them at the top of the notes list as a distinct
  // entry type (backed by review records, NOT general manager notes).
  function wireNotesPanel() {
    var panel = document.getElementById("notesPanel");
    if (!panel) return;
    var observer = new MutationObserver(function () {
      if (panel.classList.contains("open")) loadNotesForOpenPanel(panel);
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }

  function loadNotesForOpenPanel(panel) {
    var head = panel.querySelector(".notes-head .nm");
    var list = panel.querySelector(".notes-list");
    if (!head || !list) return;
    var name = (head.textContent.split("·")[1] || "").trim();
    if (!name) return;
    get(API + "/reviews?company_id=" + COMPANY + "&technician_name=" + encodeURIComponent(name))
      .then(function (data) {
        list.querySelectorAll(".note-ridealong").forEach(function (n) { n.remove(); });
        var done = (data.reviews || []).filter(function (r) { return r.status === "complete"; });
        // newest first, injected above manual notes
        done.reverse().forEach(function (r) {
          list.insertBefore(buildRideAlongNote(r), list.firstChild);
        });
      });
  }

  function buildRideAlongNote(r) {
    var el = document.createElement("div");
    el.className = "note note-ridealong";
    var ready = r.readiness === "ready";
    var badge = '<span class="ra-badge ' + (ready ? "ra-ready" : "ra-not") + '">'
      + (ready ? "Ready" : "Not yet ready") + "</span>";
    var when = (r.completed_at || r.created_at || "").slice(0, 10);
    el.innerHTML =
      '<div class="note-meta"><span class="ra-tag">Ride-Along</span> '
      + escapeHtml(r.manager_name || "Manager") + " · " + when + "</div>"
      + '<div class="ra-verdict">' + badge + "</div>"
      + (r.note ? '<div class="note-body">' + escapeHtml(r.note) + "</div>" : "");
    return el;
  }

  // --------------------------------------------------------------- 2. INBOX
  // One To Do per review -> one inbox row. Open = unread/action; resolved = read.
  function refreshInbox() {
    var page = document.getElementById("page-inbox");
    if (!page) return;
    var scroll = page.querySelector(".scroll");
    if (!scroll) return;
    get(API + "/todos?company_id=" + COMPANY).then(function (data) {
      var todos = data.todos || [];
      var group = scroll.querySelector("#ra-inbox-group");
      if (!group) {
        group = document.createElement("div");
        group.id = "ra-inbox-group";
        group.className = "inbox-group";
        group.innerHTML = '<div class="inbox-group-head">Ride-Along Reviews</div>'
          + '<div class="card" id="ra-inbox-card"></div>';
        var filters = scroll.querySelector(".inbox-filters");
        if (filters && filters.nextSibling) scroll.insertBefore(group, filters.nextSibling);
        else scroll.appendChild(group);
      }
      var card = group.querySelector("#ra-inbox-card");
      if (!todos.length) { group.style.display = "none"; return; }
      group.style.display = "";
      card.innerHTML = "";
      todos.forEach(function (t) {
        card.appendChild(buildInboxRow(t));
      });
    });
  }

  function buildInboxRow(t) {
    var row = document.createElement("div");
    var open = t.status === "open";
    row.className = "inbox-row" + (open ? " unread" : "");
    var icClass = open ? "blue" : "green";
    var title = open
      ? "Ride-Along Review — " + t.technician_name
      : t.technician_name + " — Review " + (t.readiness === "ready" ? "Ready" : "Not Ready");
    row.innerHTML =
      (open ? '<span class="unread-dot"></span>' : "")
      + '<div class="inbox-ic ' + icClass + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">'
      + '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>'
      + '<div class="inbox-meta"><div class="inbox-title">' + escapeHtml(title) + "</div>"
      + '<div class="inbox-time">via ' + escapeHtml(t.manager_name) + "</div></div>"
      + (open ? '<span class="pri pri-high">Action</span>' : "");
    return row;
  }

  // --------------------------------------------------------------- 3. DEBUG
  function buildDebugPanel() {
    var btn = document.createElement("button");
    btn.id = "ra-dbg-btn";
    btn.textContent = "⚙ mock";
    btn.onclick = function () {
      var p = document.getElementById("ra-dbg");
      p.style.display = p.style.display === "none" ? "block" : "none";
      refreshDebug();
    };
    document.body.appendChild(btn);

    var panel = document.createElement("div");
    panel.id = "ra-dbg";
    panel.style.display = "none";
    panel.innerHTML =
      '<div class="ra-dbg-head">Mock platform — debug'
      + '<button id="ra-dbg-reset">reset DB</button>'
      + '<button id="ra-dbg-close">×</button></div>'
      + '<div class="ra-dbg-body"><div id="ra-dbg-content">…</div></div>';
    document.body.appendChild(panel);
    panel.querySelector("#ra-dbg-close").onclick = function () { panel.style.display = "none"; };
    panel.querySelector("#ra-dbg-reset").onclick = function () {
      post(DBG + "/reset").then(function () { refreshDebug(); refreshInbox(); });
    };
  }

  function refreshDebug() {
    var content = document.getElementById("ra-dbg-content");
    if (!content || document.getElementById("ra-dbg").style.display === "none") return;
    get(DBG + "/state").then(function (s) {
      var html = "<h4>reviews (" + s.reviews.length + ")</h4>";
      if (!s.reviews.length) html += '<p class="ra-muted">none yet — send a batch</p>';
      s.reviews.forEach(function (r) {
        var pending = r.status === "pending";
        html += '<div class="ra-dbg-row"><code>' + r.id + "</code> "
          + "<b>" + r.status + "</b>"
          + (r.readiness ? " · " + r.readiness : "")
          + (r.channel ? " · " + r.channel : "")
          + (pending
            ? ' <button class="ra-sim" data-id="' + r.id + '">simulate in-app complete</button>'
            : "")
          + (r.note ? '<div class="ra-muted">“' + escapeHtml(r.note) + '”</div>' : "")
          + "</div>";
      });
      html += "<h4>todos (" + s.todos.length + ")</h4>";
      s.todos.forEach(function (t) {
        html += '<div class="ra-dbg-row"><code>' + t.id + "</code> " + t.status + "</div>";
      });
      content.innerHTML = html;
      content.querySelectorAll(".ra-sim").forEach(function (b) {
        b.onclick = function () {
          post(DBG + "/reviews/" + b.dataset.id + "/complete-in-app")
            .then(function () { refreshDebug(); refreshInbox(); });
        };
      });
    });
  }

  // --------------------------------------------------------------- chrome
  function liveBadge() {
    var b = document.createElement("div");
    b.id = "ra-live-badge";
    b.textContent = "● LIVE · mock platform";
    document.body.appendChild(b);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function injectStyles() {
    var css = document.createElement("style");
    css.textContent = `
      .note-ridealong { border-left: 3px solid var(--orange, #e5531f); padding-left: 10px; }
      .ra-tag { display:inline-block; font-size:9px; font-weight:800; letter-spacing:.08em;
        text-transform:uppercase; color: var(--orange,#e5531f);
        background: rgba(229,83,31,.14); padding:2px 6px; border-radius:5px; margin-right:6px; }
      .ra-verdict { margin:5px 0; }
      .ra-badge { font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; }
      .ra-ready { color:#0a3; background: rgba(43,208,122,.18); }
      .ra-not   { color:#c33; background: rgba(240,88,75,.18); }
      #ra-live-badge { position:fixed; left:12px; bottom:12px; z-index:9998;
        font:600 11px var(--sans,sans-serif); color:#2bd07a;
        background:#0d0d10; border:1px solid #233; padding:6px 10px; border-radius:8px; }
      #ra-dbg-btn { position:fixed; right:12px; bottom:12px; z-index:9999;
        font:700 12px var(--mono,monospace); color:#ddd; background:#16161a;
        border:1px solid #333; padding:8px 12px; border-radius:8px; cursor:pointer; }
      #ra-dbg { position:fixed; right:12px; bottom:54px; z-index:9999; width:360px;
        max-height:62vh; overflow:auto; background:#0e0e11; color:#ddd;
        border:1px solid #333; border-radius:12px; font:12px var(--mono,monospace);
        box-shadow:0 20px 60px -10px rgba(0,0,0,.8); }
      .ra-dbg-head { display:flex; align-items:center; gap:8px; padding:10px 12px;
        border-bottom:1px solid #262630; font-weight:700; position:sticky; top:0; background:#0e0e11; }
      .ra-dbg-head button { margin-left:auto; background:#1c1c22; color:#ccc;
        border:1px solid #333; border-radius:6px; padding:3px 8px; cursor:pointer; font:inherit; }
      .ra-dbg-head #ra-dbg-close { margin-left:6px; }
      .ra-dbg-body { padding:10px 12px; }
      .ra-dbg-body h4 { margin:10px 0 6px; font-size:11px; text-transform:uppercase;
        letter-spacing:.08em; color:#888; }
      .ra-dbg-row { padding:6px 0; border-bottom:1px solid #1d1d22; line-height:1.5; }
      .ra-dbg-row code { color:#7aa7ff; font-size:11px; }
      .ra-sim { display:block; margin-top:4px; background:#241; color:#9f9;
        border:1px solid #363; border-radius:6px; padding:3px 8px; cursor:pointer; font:inherit; }
      .ra-muted { color:#777; font-size:11px; }
    `;
    document.head.appendChild(css);
  }
})();
