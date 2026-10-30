/* PRD-484: design-review bar for presenting dashboard versions (v1.1 → v1.3).
 *
 * A full-width bar pinned above the dashboard, styled unlike the product (blue,
 * not SkillCat orange) so viewers read it as a review tool, not a feature.
 * Injected by mock_platform.py after every version's HTML, so the version
 * files stay free to change. The server sets
 * window.__DEMO_VERSIONS = { current: "1.2", versions: ["1.1", "1.2", "1.3"] }.
 *
 * - The address bar always carries ?v=… and #<screen>; "Copy link" copies it.
 * - Opening the bare URL returns you to the version you last picked.
 * - Switching versions keeps you on the same screen when the other version
 *   has it in the sidebar; otherwise it opens on the Dashboard.
 */
(function () {
  var cfg = window.__DEMO_VERSIONS;
  if (!cfg || !cfg.versions || !cfg.versions.length) return;
  var KEY = "demo:version";
  var params = new URLSearchParams(location.search);

  function store(get, value) {
    try {
      if (get) return localStorage.getItem(KEY);
      localStorage.setItem(KEY, value);
    } catch (e) {}
    return null;
  }

  // Bare URL: go back to the last version picked in this browser.
  if (!params.get("v")) {
    var last = store(true);
    if (last && last !== cfg.current && cfg.versions.indexOf(last) !== -1) {
      params.set("v", last);
      location.replace(location.pathname + "?" + params.toString() + location.hash);
      return;
    }
  }
  store(false, cfg.current);

  function activeScreen() {
    var page = document.querySelector(".page.active");
    return page && page.id ? page.id.replace(/^page-/, "") : "";
  }

  function urlFor(version) {
    var p = new URLSearchParams(location.search);
    p.set("v", version);
    var screen = activeScreen();
    return location.pathname + "?" + p.toString() + (screen ? "#" + screen : "");
  }

  function syncUrl() {
    history.replaceState(history.state, "", urlFor(cfg.current));
  }

  var css = document.createElement("style");
  css.textContent = [
    ":root{--review-h:40px}",
    "body{box-sizing:border-box;padding-top:var(--review-h)}",
    // The dashboard sizes itself to the window; give the bar its slice.
    ".app{height:calc(100vh - var(--review-h))!important}",
    ".add-person-panel{top:var(--review-h)!important}",
    ".notes-panel{top:calc(80px + var(--review-h))!important}",
    "@media (max-width:900px){.sidebar{top:var(--review-h)!important}",
    ".hamburger{top:calc(12px + var(--review-h))!important}}",
    ".review-bar{position:fixed;top:0;left:0;right:0;height:var(--review-h);z-index:400;",
    "display:flex;align-items:center;gap:14px;padding:0 16px;box-sizing:border-box;",
    "background:repeating-linear-gradient(135deg,#16203a 0 14px,#18233f 14px 28px);",
    "border-bottom:1px solid #3b5aa8;color:#c9d7fb;font:500 12.5px/1 system-ui,-apple-system,'Segoe UI',sans-serif}",
    ".review-tag{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:11px;",
    "letter-spacing:.09em;text-transform:uppercase;color:#7aa7ff;white-space:nowrap}",
    ".review-tag svg{width:14px;height:14px;stroke:#7aa7ff;stroke-width:2;fill:none}",
    ".review-note{color:#8fa3d6;white-space:nowrap}",
    ".review-versions{display:inline-flex;border:1px solid #3b5aa8;border-radius:8px;overflow:hidden;margin-left:auto}",
    ".review-versions a{padding:6px 12px;color:#c9d7fb;text-decoration:none;font-weight:600;",
    "font-variant-numeric:tabular-nums;border-left:1px solid #3b5aa8}",
    ".review-versions a:first-child{border-left:0}",
    ".review-versions a:hover{background:rgba(122,167,255,.12)}",
    ".review-versions a[aria-current=page]{background:#7aa7ff;color:#0b1430}",
    ".review-versions a:focus-visible,.review-copy:focus-visible{outline:2px solid #fff;outline-offset:-2px}",
    ".review-copy{background:transparent;border:1px solid #3b5aa8;color:#c9d7fb;border-radius:8px;",
    "padding:6px 11px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}",
    ".review-copy:hover{background:rgba(122,167,255,.12)}",
    "@media (max-width:720px){.review-note{display:none}.review-bar{gap:8px;padding:0 10px}",
    ".review-versions a{padding:6px 8px}.review-copy{padding:6px 8px}.review-copy .long{display:none}}",
  ].join("");
  document.head.appendChild(css);

  var bar = document.createElement("div");
  bar.className = "review-bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Design review controls");
  bar.innerHTML =
    '<span class="review-tag"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
    "Design review</span>" +
    '<span class="review-note">Not part of the product. For reviewing designs and flows only.</span>' +
    '<nav class="review-versions" aria-label="Dashboard version"></nav>' +
    '<button type="button" class="review-copy" aria-label="Copy link to this version and screen">Copy<span class="long"> link</span></button>';

  var nav = bar.querySelector(".review-versions");
  cfg.versions.forEach(function (v) {
    var a = document.createElement("a");
    a.textContent = "v" + v;
    a.href = urlFor(v);
    if (v === cfg.current) a.setAttribute("aria-current", "page");
    a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      if (v === cfg.current) return;
      store(false, v);
      location.assign(urlFor(v)); // current screen, read at click time
    });
    nav.appendChild(a);
  });

  var copy = bar.querySelector(".review-copy");
  copy.addEventListener("click", function () {
    var href = location.origin + urlFor(cfg.current);
    var done = function (ok) {
      var label = copy.innerHTML;
      copy.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(function () { copy.innerHTML = label; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(href).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  });

  document.body.insertBefore(bar, document.body.firstChild);

  // Reopen the screen named in the link, if this version has it in the nav.
  var wanted = decodeURIComponent(location.hash.slice(1));
  if (wanted && wanted !== activeScreen()) {
    var item = document.querySelector('.nav-item[data-page="' + wanted.replace(/"/g, "") + '"]');
    if (item) item.click();
  }

  // Keep ?v, #screen and the version links current as the presenter moves around.
  function refresh() {
    syncUrl();
    Array.prototype.forEach.call(nav.children, function (a, i) {
      a.href = urlFor(cfg.versions[i]);
    });
  }
  document.addEventListener("click", function () { setTimeout(refresh, 0); }, true);
  refresh();
})();
