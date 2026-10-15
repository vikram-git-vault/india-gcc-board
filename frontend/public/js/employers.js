(function () {
  var PLATFORM = { workday: 'Workday', oracle: 'Oracle Fusion', greenhouse: 'Greenhouse', avature: 'Avature', custom: 'Custom (sitemap)',
    successfactors: 'SuccessFactors', phenom: 'Phenom', eightfold: 'Eightfold', icims: 'iCIMS', taleo: 'Taleo', unknown: 'Not known' };
  var data = { employers: [], excluded: [] };
  var tab = 'active';
  var query = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }
  // The first sentence of a dated note, without the date prefix.
  function reason(note) {
    var n = String(note || '').replace(/^Verified \d{4}-\d{2}-\d{2}:?\s*|^\d{4}-\d{2}-\d{2}:\s*/, '');
    return (n.split(/(?<=\.)\s/)[0] || '').slice(0, 220);
  }
  function matches(text) { return !query || text.toLowerCase().indexOf(query) !== -1; }

  function render() {
    var table = document.getElementById('table');
    var rows;
    if (tab === 'excluded') {
      rows = data.excluded.filter(function (e) { return matches(e.name + ' ' + e.reason); });
      table.innerHTML = '<thead><tr><th>Employer</th><th>Status</th><th>Reason</th></tr></thead><tbody>' +
        rows.map(function (e) {
          return '<tr><td class="name">' + esc(e.name) + '</td><td><span class="pill blocked">Not permitted</span></td><td class="reason">' + esc(e.reason) + '</td></tr>';
        }).join('') + '</tbody>';
    } else {
      var active = tab === 'active';
      rows = data.employers
        .filter(function (e) { return e.active === active; })
        .filter(function (e) { return matches(e.name + ' ' + (PLATFORM[e.ats_type] || e.ats_type) + ' ' + e.sector + ' ' + reason(e.note)); })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      table.innerHTML = '<thead><tr><th>Employer</th><th>Sector</th><th>Platform</th>' + (active ? '' : '<th>Why it is not automated</th>') + '<th>Career site</th></tr></thead><tbody>' +
        rows.map(function (e) {
          return '<tr><td class="name">' + esc(e.name) + '</td>' +
            '<td><span class="pill ' + (e.sector === 'BFSI' ? 'bfsi' : 'other') + '">' + esc(e.sector) + '</span></td>' +
            '<td>' + esc(PLATFORM[e.ats_type] || e.ats_type) + '</td>' +
            (active ? '' : '<td class="reason">' + esc(reason(e.note)) + '</td>') +
            '<td><a class="site" href="' + esc(safeUrl(e.careers_url)) + '" target="_blank" rel="noopener noreferrer">' + esc(String(e.careers_url).replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a></td></tr>';
        }).join('') + '</tbody>';
    }
    if (!rows.length) table.innerHTML = '<tbody><tr><td class="empty">No employers match this search.</td></tr></tbody>';
  }

  document.getElementById('search').addEventListener('input', function (e) { query = e.target.value.trim().toLowerCase(); render(); });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      tab = b.getAttribute('data-tab');
      render();
    });
  });

  fetch('/api/employers').then(function (r) {
    if (!r.ok) throw new Error('The employer list did not load.');
    return r.json();
  }).then(function (d) {
    data = d;
    var active = d.employers.filter(function (e) { return e.active; }).length;
    var manual = d.employers.length - active;
    document.getElementById('nActive').textContent = active;
    document.getElementById('nManual').textContent = manual;
    document.getElementById('nExcluded').textContent = d.excluded.length;
    document.getElementById('summary').textContent = (d.employers.length + d.excluded.length) + ' employers: the refresh scrapes ' + active +
      ', you check ' + manual + ' by hand, and ' + d.excluded.length + ' do not permit crawlers.';
    render();
  }).catch(function (err) { document.getElementById('summary').textContent = err.message; });
})();
