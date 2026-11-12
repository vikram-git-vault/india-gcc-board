(function () {
  var STAGE_LABEL = {
    rm_score: 'RM scoring', careerops_score: 'career-ops evaluation', resume_tailoring: 'Resume tailoring',
    cover_letter: 'Cover letter', ats_optimization: 'ATS optimization', application_package: 'CV and cover letter',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function k(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function usd(n) { return '$' + (Number(n) || 0).toFixed(2); }
  function pct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }
  function tokens(s) { return (s.input_tokens || 0) + (s.output_tokens || 0) + (s.cache_read_tokens || 0) + (s.cache_write_tokens || 0); }

  function render(data) {
    var t = data.totals;
    document.getElementById('summary').textContent = 'Since ' + data.since + '. Scoring: ' + data.models.scoring + '. CV and cover letter: ' + data.models.documents + '.';
    document.getElementById('tiles').innerHTML = [
      [t.calls, 'Claude calls'], [k(t.tokens), 'tokens'], [usd(t.cost_usd), 'list-price value'],
      [pct(t.scoring_on_sonnet), 'scoring calls on Sonnet'], [pct(t.routing_compliance), 'calls on the routed model'],
    ].map(function (x) { return '<li><span class="v">' + esc(x[0]) + '</span><span class="l">' + esc(x[1]) + '</span></li>'; }).join('');

    var rows = data.stages.slice().sort(function (a, b) { return a.stage.localeCompare(b.stage) || a.shadow - b.shadow; });
    document.getElementById('stages').innerHTML = '<thead><tr><th>Stage</th><th>Model</th><th class="num">Calls</th><th class="num">Roles</th>'
      + '<th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cache write</th>'
      + '<th class="num">Value</th><th class="num">Tokens / role</th><th class="num">Value / role</th><th class="num">Seconds / role</th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (s) {
        return '<tr><td class="name">' + esc(STAGE_LABEL[s.stage] || s.stage) + (s.shadow ? ' <span class="pill other">check run</span>' : '') + '</td>'
          + '<td>' + esc(s.model) + (s.compliant < s.calls ? ' <span class="pill blocked">' + (s.calls - s.compliant) + ' off-route</span>' : '') + '</td>'
          + '<td class="num">' + s.calls + (s.ok_calls < s.calls ? ' (' + (s.calls - s.ok_calls) + ' failed)' : '') + '</td><td class="num">' + s.roles + '</td>'
          + '<td class="num">' + k(s.input_tokens) + '</td><td class="num">' + k(s.output_tokens) + '</td>'
          + '<td class="num">' + k(s.cache_read_tokens) + '</td><td class="num">' + k(s.cache_write_tokens) + '</td>'
          + '<td class="num">' + usd(s.cost_usd) + '</td><td class="num">' + k(s.per_role.tokens) + '</td>'
          + '<td class="num">' + usd(s.per_role.cost_usd) + '</td><td class="num">' + Math.round(s.per_role.seconds) + '</td></tr>';
      }).join('') : '<tr><td colspan="12" class="empty">No Claude calls in this period</td></tr>') + '</tbody>';

    document.getElementById('days-table').innerHTML = '<thead><tr><th>Day (UTC)</th><th>Stage</th><th class="num">Calls</th><th class="num">Roles</th><th class="num">Tokens</th><th class="num">Value</th></tr></thead><tbody>'
      + (data.byDay.length ? data.byDay.slice().reverse().map(function (d) {
        return '<tr><td>' + esc(d.day) + '</td><td>' + esc(STAGE_LABEL[d.stage] || d.stage) + '</td><td class="num">' + d.calls + '</td><td class="num">' + d.roles
          + '</td><td class="num">' + k(tokens(d)) + '</td><td class="num">' + usd(d.cost_usd) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">No Claude calls in this period</td></tr>') + '</tbody>';
  }

  function load() {
    var days = document.getElementById('days').value;
    fetch('/api/usage?days=' + encodeURIComponent(days)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(render).catch(function (err) {
      document.getElementById('summary').textContent = 'Cannot load the usage (' + err.message + ').';
    });
  }
  document.getElementById('days').addEventListener('change', load);
  load();
})();
