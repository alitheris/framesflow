(function () {
  // mobile menu
  var side = document.getElementById('side');
  document.getElementById('menu-btn').addEventListener('click', function () { side.classList.toggle('open'); });
  side.addEventListener('click', function (e) { if (e.target.tagName === 'A') side.classList.remove('open'); });

  // copy buttons on code blocks
  document.querySelectorAll('pre').forEach(function (pre) {
    var b = document.createElement('button');
    b.className = 'copy'; b.type = 'button'; b.textContent = 'Copy';
    b.addEventListener('click', function () {
      var text = pre.querySelector('code').innerText;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); }, function () { b.textContent = 'Press Ctrl+C'; });
    });
    pre.appendChild(b);
  });

  // table of contents highlight
  var links = [].slice.call(document.querySelectorAll('.toc a'));
  if (links.length && 'IntersectionObserver' in window) {
    var map = {}; links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { links.forEach(function (a) { a.classList.remove('on'); }); var a = map[en.target.id]; if (a) a.classList.add('on'); } });
    }, { rootMargin: '-80px 0px -70% 0px' });
    document.querySelectorAll('article h2[id], article h3[id]').forEach(function (h) { io.observe(h); });
  }

  // search (client side, no server): loads search-index.json once
  var q = document.getElementById('q'), box = document.getElementById('results'), idx = null, sel = -1;
  function load() { if (idx) return Promise.resolve(); return fetch('search-index.json').then(function (r) { return r.json(); }).then(function (j) { idx = j; }); }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function run() {
    var terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) { box.className = ''; box.innerHTML = ''; return; }
    var scored = [];
    idx.forEach(function (e) {
      var title = (e.t + ' ' + e.h).toLowerCase(), body = e.x.toLowerCase(), s = 0, ok = true;
      terms.forEach(function (t) {
        var inT = title.indexOf(t) >= 0, inB = body.indexOf(t) >= 0;
        if (!inT && !inB) ok = false; else s += (inT ? 6 : 0) + (inB ? 1 + (body.split(t).length - 1) * 0.2 : 0);
      });
      if (ok) scored.push([s, e]);
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    var top = scored.slice(0, 8);
    box.className = 'open'; sel = -1;
    box.innerHTML = top.length ? top.map(function (p) {
      var e = p[1], at = e.x.toLowerCase().indexOf(terms[0]), start = Math.max(0, at - 40), snip = e.x.slice(start, start + 130);
      return '<a href="' + e.u + '"><b>' + esc(e.t) + (e.h ? ' <em>›</em> ' + esc(e.h) : '') + '</b><small>' + (start ? '…' : '') + esc(snip) + '…</small></a>';
    }).join('') : '<div class="nores">No results. Try other words.</div>';
  }
  q.addEventListener('input', function () { load().then(run); });
  q.addEventListener('focus', function () { load().then(function () { if (q.value) run(); }); });
  q.addEventListener('keydown', function (e) {
    var items = [].slice.call(box.querySelectorAll('a'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach(function (a, i) { a.classList.toggle('sel', i === sel); }); if (items[sel]) items[sel].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && items[Math.max(sel, 0)]) { location.href = items[Math.max(sel, 0)].getAttribute('href'); }
    else if (e.key === 'Escape') { box.className = ''; q.blur(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) box.className = ''; });
  document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement !== q && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); } });
})();
