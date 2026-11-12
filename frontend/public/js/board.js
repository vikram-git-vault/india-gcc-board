(function () {
  var MARKS_KEY = 'india-gcc-board:marks';

  function loadMarks() {
    try {
      var raw = localStorage.getItem(MARKS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveMarks() {
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(state.marks)); } catch (e) {}
  }

  var state = {
    roles: [],
    meta: {},
    coverage: { fetchedCount: 0, totalTracked: 0, manualCount: 0 },
    targeting: null,
    refreshRunning: false,  // from /api/refresh/status
    refreshProgress: null,  // the last step of the running refresh
    marks: loadMarks(),   // roleId -> status; the server keeps them (GET /api/marks), this browser keeps a copy
    query: '',
    hiddenRoles: [],      // shown only for a job id search
    grades: new Set(),
    families: new Set(),
    locations: new Set(),
    employers: new Set(),
    sort: 'career',       // default: best career-ops score first
    scoreBands: new Set(),
    coBands: new Set(),
    posted: null,         // one POSTED_BANDS id, or null for any date
    showOlder: false,     // show the roles older than targeting.max_age_days
    tab: 'open',
  };

  // Grade order mirrors config/targets.json: target grades first, then exceptions.
  var GRADE_ORDER = ['SVP', 'Director', 'Head', 'Associate Director', 'VP', 'Lead role (ungraded)', 'AVP', 'Senior Manager'];
  var FAMILY_ORDER = ['Product', 'Engineering leadership', 'AI / Data leadership', 'Delivery / Program / Transformation'];

  var SCORE_BANDS = [
    { id: 'fit75', label: '75 and above', test: function (r) { return r.score && r.score.fit >= 75; } },
    { id: 'fit50', label: '50 to 74', test: function (r) { return r.score && r.score.fit >= 50 && r.score.fit < 75; } },
    { id: 'fitlow', label: 'Below 50', test: function (r) { return r.score && r.score.fit < 50; } },
    { id: 'unscored', label: 'Not scored', test: function (r) { return !r.score; } },
  ];

  // career-ops score bands (1 to 5). At 4 or more the board makes a
  // tailored resume. Waiting: RM score at the minimum, no career-ops yet.
  function coScore(r) { return r.tailor && r.tailor.score != null ? Number(r.tailor.score) : null; }
  var CO_BANDS = [
    { id: 'co40', label: '4 and above', test: function (r) { return coScore(r) != null && coScore(r) >= 4; } },
    { id: 'co35', label: '3.5 to 3.9', test: function (r) { return coScore(r) != null && coScore(r) >= 3.5 && coScore(r) < 4; } },
    { id: 'co30', label: '3 to 3.4', test: function (r) { return coScore(r) != null && coScore(r) >= 3 && coScore(r) < 3.5; } },
    { id: 'colow', label: 'Below 3', test: function (r) { return coScore(r) != null && coScore(r) < 3; } },
    { id: 'copending', label: 'Waiting for career-ops', test: function (r) {
      var min = (state.targeting || {}).tailor_min_fit;
      return coScore(r) == null && min != null && !!r.score && bestFit(r) >= min;
    } },
  ];
  // "Within" bands include the newer ones; a role open more than a month
  // is less likely to still be hiring, so it has its own band.
  var POSTED_BANDS = [
    { id: 'd1', label: 'Within 1 day', test: function (d) { return d !== null && d <= 1; } },
    { id: 'd3', label: 'Within 3 days', test: function (d) { return d !== null && d <= 3; } },
    { id: 'd5', label: 'Within 5 days', test: function (d) { return d !== null && d <= 5; } },
    { id: 'w1', label: 'Within 1 week', test: function (d) { return d !== null && d <= 7; } },
    { id: 'w2', label: 'Within 2 weeks', test: function (d) { return d !== null && d <= 14; } },
    { id: 'm1', label: 'Within 1 month', test: function (d) { return d !== null && d <= 30; } },
    { id: 'older', label: 'More than a month', test: function (d) { return d !== null && d > 30; } },
    { id: 'unknown', label: 'Date unknown', test: function (d) { return d === null; } },
  ];
  var RESUME_LABEL = { PO: 'Product Owner', EM: 'Engineering Leader' };

  function band(n) { return n >= 75 ? 'high' : n >= 50 ? 'mid' : 'low'; }

  function orderedPresent(order, values) {
    var present = uniqueSorted(values);
    return order.filter(function (v) { return present.indexOf(v) !== -1; })
      .concat(present.filter(function (v) { return order.indexOf(v) === -1; }));
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
  }

  function relativeTime(iso) {
    if (!iso) return 'unknown';
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  // "13 Oct 2026, 6:42 PM IST" in the viewer's own time zone.
  function exactTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try {
      return d.toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });
    } catch (e) { return d.toString(); }
  }

  // Whole days from the posting date to today (the viewer's calendar), or
  // null when the site gave no date.
  // The board window (targeting.max_age_days, 30): older roles are hidden,
  // except the owner's marked roles and roles with a tailored CV. The age
  // is the posted date, or the day the board first found the role.
  function ageDays(role) {
    var d = role.age_date || role.posted_date;
    if (!/^\d{4}-\d{2}-\d{2}/.test(d || '')) return null;
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((today - Date.parse(d.slice(0, 10) + 'T00:00:00Z')) / 86400000));
  }
  function isOlder(role) {
    var max = (state.targeting || {}).max_age_days;
    var d = ageDays(role);
    return max != null && d !== null && d > max;
  }
  function inWindow(role) {
    return !isOlder(role) || !!markOf(role) || !!(role.tailor && role.tailor.cv);
  }
  function buildOlderChip() {
    var container = document.getElementById('facetOlder');
    container.innerHTML = '';
    var n = state.roles.filter(function (r) { return !inWindow(r); }).length;
    var max = (state.targeting || {}).max_age_days;
    if (!n || max == null) { container.parentNode.hidden = true; return; }
    container.parentNode.hidden = false;
    var btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = 'Show roles older than ' + max + ' days (' + n + ')';
    btn.title = 'These roles are hidden: they are older than ' + max + ' days, you did not mark them, and they have no tailored resume. The board does not score them again.';
    btn.setAttribute('aria-pressed', state.showOlder ? 'true' : 'false');
    btn.addEventListener('click', function () {
      state.showOlder = !state.showOlder;
      btn.setAttribute('aria-pressed', state.showOlder ? 'true' : 'false');
      render();
    });
    container.appendChild(btn);
  }

  function postedAgeDays(role) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(role.posted_date || '')) return null;
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((today - Date.parse(role.posted_date + 'T00:00:00Z')) / 86400000));
  }

  // One band at a time: the bands overlap, so more than one has no use.
  // A second click on the selected band removes the filter.
  function buildPostedChips() {
    var container = document.getElementById('facetPosted');
    container.innerHTML = '';
    var ages = state.roles.map(postedAgeDays);
    POSTED_BANDS.forEach(function (b) {
      var n = ages.filter(b.test).length;
      if (!n && b.id === 'unknown') return;
      var btn = document.createElement('button');
      btn.className = 'chip';
      btn.textContent = b.label + ' (' + n + ')';
      btn.setAttribute('data-posted', b.id);
      btn.setAttribute('aria-pressed', state.posted === b.id ? 'true' : 'false');
      btn.addEventListener('click', function () {
        state.posted = state.posted === b.id ? null : b.id;
        Array.prototype.forEach.call(container.querySelectorAll('.chip'), function (c) {
          c.setAttribute('aria-pressed', c.getAttribute('data-posted') === state.posted ? 'true' : 'false');
        });
        render();
      });
      container.appendChild(btn);
    });
  }

  function buildFacetChips(containerId, values, activeSet, labelFn) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    values.forEach(function (v) {
      var btn = document.createElement('button');
      btn.className = 'chip';
      btn.textContent = labelFn ? labelFn(v) : v;
      btn.setAttribute('aria-pressed', activeSet.has(v) ? 'true' : 'false');
      btn.addEventListener('click', function () {
        if (activeSet.has(v)) activeSet.delete(v); else activeSet.add(v);
        btn.setAttribute('aria-pressed', activeSet.has(v) ? 'true' : 'false');
        render();
      });
      container.appendChild(btn);
    });
  }

  function initFacets() {
    var bandLabel = {};
    SCORE_BANDS.forEach(function (b) { bandLabel[b.id] = b.label; });
    buildFacetChips('facetScore', SCORE_BANDS.filter(function (b) { return state.roles.some(b.test); }).map(function (b) { return b.id; }), state.scoreBands, function (id) { return bandLabel[id]; });
    var coLabel = {};
    CO_BANDS.forEach(function (b) { coLabel[b.id] = b.label; });
    buildFacetChips('facetCareerOps', CO_BANDS.filter(function (b) { return state.roles.some(b.test); }).map(function (b) { return b.id; }), state.coBands, function (id) { return coLabel[id]; });
    buildFacetChips('facetGrade', orderedPresent(GRADE_ORDER, state.roles.map(function (r) { return r.grade; })), state.grades);
    buildFacetChips('facetFamily', orderedPresent(FAMILY_ORDER, state.roles.map(function (r) { return r.family; })), state.families);
    buildFacetChips('facetLocation', uniqueSorted(state.roles.map(function (r) { return r.location; })), state.locations);
    buildPostedChips();
    buildOlderChip();
    buildFacetChips('facetEmployer', uniqueSorted(state.roles.map(function (r) { return r.employer; })), state.employers);
  }

  // The employer's job id, letters and digits only: "R-2680072" and
  // "2680072" both find R-2680072.
  function idKey(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function jobIdHit(role) {
    var q = idKey(state.query);
    return /\d{4}/.test(q) && !/\s/.test(state.query.trim()) && idKey(role.job_id).indexOf(q) !== -1;
  }

  function matchesFacets(role) {
    // A job id search also finds the roles older than the board window.
    var idHit = !!state.query && jobIdHit(role);
    if (!idHit && !state.showOlder && state.posted !== 'older' && !inWindow(role)) return false;
    if (state.scoreBands.size && !SCORE_BANDS.some(function (b) { return state.scoreBands.has(b.id) && b.test(role); })) return false;
    if (state.coBands.size && !CO_BANDS.some(function (b) { return state.coBands.has(b.id) && b.test(role); })) return false;
    if (state.grades.size && !state.grades.has(role.grade)) return false;
    if (state.families.size && !state.families.has(role.family)) return false;
    if (state.locations.size && !state.locations.has(role.location)) return false;
    if (state.employers.size && !state.employers.has(role.employer)) return false;
    if (state.posted) {
      var postedBand = POSTED_BANDS.filter(function (b) { return b.id === state.posted; })[0];
      if (postedBand && !postedBand.test(postedAgeDays(role))) return false;
    }
    if (state.query) {
      var q = state.query.toLowerCase();
      if (!idHit && role.title.toLowerCase().indexOf(q) === -1 && role.employer.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function markOf(role) { return state.marks[String(role.id)] || null; }

  // Applied and rejected roles leave the Open tab; they show only in their own tab.
  var DONE_MARKS = { applied: true, rejected: true };

  function matchesTab(role) {
    if (state.tab === 'open') return !DONE_MARKS[markOf(role)];
    return markOf(role) === state.tab;
  }

  function sortRoles(list) {
    var copy = list.slice();
    function scoreKey(r, key) { return r.score ? r.score[key] : -1; }
    // Roles with no career-ops score go after the scored ones.
    function coKey(r) { var v = coScore(r); return v == null ? -1 : v; }
    if (state.sort === 'career') copy.sort(function (a, b) { return coKey(b) - coKey(a) || scoreKey(b, 'fit') - scoreKey(a, 'fit'); });
    else if (state.sort === 'fit') copy.sort(function (a, b) { return scoreKey(b, 'fit') - scoreKey(a, 'fit') || scoreKey(b, 'ats') - scoreKey(a, 'ats'); });
    else if (state.sort === 'ats') copy.sort(function (a, b) { return scoreKey(b, 'ats') - scoreKey(a, 'ats') || scoreKey(b, 'fit') - scoreKey(a, 'fit'); });
    else if (state.sort === 'date') copy.sort(function (a, b) { return (b.posted_date || '').localeCompare(a.posted_date || ''); });
    else if (state.sort === 'employer') copy.sort(function (a, b) { return a.employer.localeCompare(b.employer); });
    else if (state.sort === 'title') copy.sort(function (a, b) { return a.title.localeCompare(b.title); });
    return copy;
  }

  function cardHtml(role) {
    var mark = markOf(role);
    var sc = role.score;
    var department = role.department && role.department !== role.employer ? role.department : null;
    var posted = role.posted_date ? 'Posted ' + relativeTime(role.posted_date + 'T00:00:00Z') : 'Posting date unknown';

    var metaParts = ['<span class="employer">' + escapeHtml(role.employer) + '</span>'];
    [role.location, role.family, department].filter(Boolean).forEach(function (m) { metaParts.push('<span>' + escapeHtml(m) + '</span>'); });
    metaParts.push('<span>' + posted + '</span>');
    if (role.job_id) metaParts.push('<span class="job-id" title="The employer\'s job id">Job ID ' + escapeHtml(role.job_id) + '</span>');

    var hiddenBadge = role.hidden
      ? '<span class="badge hidden-role" title="The board hides this role (' + escapeHtml(role.hidden) + '). It shows because you searched its job ID.">Hidden: ' + escapeHtml(role.hidden) + '</span>'
      : '';
    var exceptionBadge = role.tier === 'exception'
      ? '<span class="badge exception" title="AVP or Senior Manager grade. The board keeps it only when the RM score is 75 or more.">Exception</span>'
      : '';

    var ATS_TIP = 'ATS score: how well your resume text matches this job description, as an applicant tracking system reads it (0 to 100)';
    var RM_TIP = 'RM score (recruiter match): how a recruiter would rate your experience for this role (0 to 100)';
    var fitBlock = '<div class="scores">' + (sc
      ? '<div class="score-box ' + band(sc.ats) + '" title="' + ATS_TIP + '"><span class="num">' + sc.ats + '</span><span class="lbl">ATS score</span></div>' +
        '<div class="score-box ' + band(sc.fit) + '" title="' + RM_TIP + '"><span class="num">' + sc.fit + '</span><span class="lbl">RM score</span></div>'
      : '<div class="score-box pending" title="' + ATS_TIP + '"><span class="num">–</span><span class="lbl">ATS score</span></div>' +
        '<div class="score-box pending" title="' + RM_TIP + '"><span class="num">–</span><span class="lbl">RM score</span></div>') +
      tailorBox(role) +
      '</div>';

    function markBtn(value, label) {
      var pressed = mark === value;
      return '<button class="mark-btn ' + value + '" data-role-id="' + role.id + '" data-mark="' + value + '" aria-pressed="' + pressed + '">' + label + '</button>';
    }

    return '' +
      '<article class="card" data-card-id="' + role.id + '">' +
        fitBlock +
        '<div class="card-body">' +
        '<div class="card-head">' +
          '<h3 class="card-title">' + escapeHtml(role.title) + '</h3>' +
          '<span class="badges">' + hiddenBadge + exceptionBadge + '<span class="badge">' + escapeHtml(role.grade || '') + '</span></span>' +
        '</div>' +
        '<div class="card-meta">' + metaParts.join('') + '</div>' +
        scoreHtml(role) +
        '<div class="card-actions">' +
          '<a class="apply-link" href="' + escapeHtml(safeUrl(role.job_url)) + '" target="_blank" rel="noopener noreferrer">Open the posting</a>' +
          tailorLinks(role) +
          '<div class="mark-group" role="group" aria-label="Mark this role">' +
            markBtn('interested', 'Interested') +
            markBtn('applied', 'Applied') +
            markBtn('rejected', 'Rejected') +
            markBtn('closed', 'Closed') +
          '</div>' +
        '</div>' +
        '</div>' +
      '</article>';
  }

  // career-ops (tailor.js): its score from 1 to 5. A role with a better
  // RM score at or above the minimum and no result yet is waiting.
  var CO_TIP = 'career-ops score: how well this job fits you, from 1 to 5, from the career-ops evaluation. At 4 or more, the board makes a tailored Word resume and cover letter.';
  function bestFit(role) {
    var v = (role.score && role.score.variants) || {};
    return Math.max((v.PO || {}).fit || 0, (v.EM || {}).fit || 0);
  }
  function tailorBox(role) {
    var t = role.tailor;
    if (t && t.score != null) {
      var b = t.score >= 4 ? 'high' : t.score >= 3 ? 'mid' : 'low';
      return '<div class="score-box ' + b + '" title="' + CO_TIP + (t.stale ? ' The job description changed after this evaluation.' : '') + '"><span class="num">' + Number(t.score).toFixed(1) + '</span><span class="lbl">career-ops</span></div>';
    }
    var min = (state.targeting || {}).tailor_min_fit;
    if (min != null && role.score && bestFit(role) >= min) {
      return '<div class="score-box pending" title="' + CO_TIP + ' This role is waiting for career-ops."><span class="num">–</span><span class="lbl">career-ops</span></div>';
    }
    return '';
  }
  function tailorLinks(role) {
    var t = role.tailor;
    if (!t) return '';
    var base = '/api/roles/' + encodeURIComponent(role.id) + '/tailored/';
    // A click opens the file in its OneDrive folder (see openTailored);
    // the href is the download for a board opened on another device.
    function link(kind, label, tip) {
      return '<a class="doc-link" data-open="' + base + kind + '/open" href="' + (kind === 'folder' ? '#' : base + kind) + '" title="' + tip + '">' + label + '</a>';
    }
    var links = '';
    if (t.cv) links += link('cv', 'Resume (Word)', 'Open the tailored resume in Word, in its OneDrive folder');
    if (t.cover) links += link('cover', 'Cover letter (Word)', 'Open the tailored cover letter in Word, in its OneDrive folder');
    if (t.cv) links += link('report', 'career-ops report', 'Open the career-ops evaluation');
    if (t.cv) links += link('folder', 'Folder', 'Open the OneDrive folder of this role in Finder');
    return links;
  }

  function scoreHtml(role) {
    var sc = role.score;
    if (!sc) {
      var why = role.description_status === 'gone' ? 'The posting is closed.' : 'This role is waiting for a score.';
      return '<div class="score-line"><span class="send">' + why + '</span></div>';
    }
    var flags = '';
    if (sc.stale) flags += '<span class="flag" title="The job description or the rubric changed after this score. Score the role again.">Score out of date</span>';
    if (sc.confidence === 'low') flags += '<span class="flag" title="Scored from the title only. No full job description was available.">Title only</span>';

    var kw = (sc.matched_keywords || []).map(function (k) { return '<span class="kw">' + escapeHtml(k) + '</span>'; }).join('');
    var gaps = (sc.gaps || []).map(function (g) { return '<li>' + escapeHtml(g) + '</li>'; }).join('');
    var v = sc.variants || {};
    function variantRow(key) {
      var x = v[key] || {};
      return '<tr' + (key === sc.recommended ? ' class="chosen"' : '') + '><td>' + escapeHtml(RESUME_LABEL[key] || key) + (key === sc.recommended ? ' (send this)' : '') + '</td><td>' + x.ats + '</td><td>' + x.fit + '</td></tr>';
    }
    return '' +
      '<div class="score-line">' +
        '<span class="send">Send the <strong>' + escapeHtml(RESUME_LABEL[sc.recommended] || sc.recommended) + '</strong> resume</span>' +
        flags +
      '</div>' +
      '<details class="why" data-role-id="' + role.id + '"' + (openWhy[role.id] ? ' open' : '') + '><summary>Why this score</summary><div class="why-body">' +
        '<p>' + escapeHtml(sc.reason) + '</p>' +
        (kw ? '<div><h3>Found in your resume</h3><div class="kw-list">' + kw + '</div></div>' : '') +
        (gaps ? '<div><h3>Gaps to address</h3><ul class="gap-list">' + gaps + '</ul></div>' : '') +
        tailorWhy(role) +
        '<div><h3>Both resumes</h3><table class="variant-table"><tr><th>Resume</th><th>ATS score</th><th>RM score</th></tr>' + variantRow('PO') + variantRow('EM') + '</table></div>' +
      '</div></details>';
  }

  // A gap that the owner is confirming: the form stays open over re-renders.
  var gapForm = null;  // { roleId, idx, text, busy, error }

  function tailorWhy(role) {
    var t = role.tailor;
    if (!t) return '';
    var done = {};
    (t.confirmed || []).forEach(function (c) { done[c.gap] = true; });
    var g = (t.gaps || []).map(function (x, i) {
      if (done[x]) return '';
      var open = gapForm && gapForm.roleId === role.id && gapForm.idx === i;
      var form = open
        ? '<div class="gap-form"><label for="gapText' + role.id + '_' + i + '">Where you did it, what you did and a result, in your own words. It goes into your master CV as you write it.</label>' +
          '<textarea id="gapText' + role.id + '_' + i + '" class="gap-text" data-role-id="' + role.id + '" data-idx="' + i + '" rows="3" maxlength="800">' + escapeHtml(gapForm.text || '') + '</textarea>' +
          (gapForm.error ? '<p class="gap-error">' + escapeHtml(gapForm.error) + '</p>' : '') +
          '<div class="gap-actions"><button class="gap-save" data-role-id="' + role.id + '" data-idx="' + i + '"' + (gapForm.busy ? ' disabled' : '') + '>' + (gapForm.busy ? 'Saving…' : 'Add to my master CV') + '</button>' +
          '<button class="gap-cancel">Cancel</button></div></div>'
        : '<button class="gap-confirm" data-role-id="' + role.id + '" data-idx="' + i + '">I have done this</button>';
      return '<li><span>' + escapeHtml(x) + '</span> ' + form + '</li>';
    }).join('');
    var c = (t.confirmed || []).map(function (x) {
      return '<li><strong>' + escapeHtml(x.gap) + ':</strong> ' + escapeHtml(x.answer) + '</li>';
    }).join('');
    return '<div><h3>career-ops: ' + Number(t.score).toFixed(1) + ' of 5' + (t.decision ? ' (' + escapeHtml(t.decision) + ')' : '') + '</h3>' +
      '<p>' + (t.cv ? 'A tailored Word resume' + (t.cover ? ' and cover letter are' : ' is') + ' ready.' : 'Below the score for a tailored resume (4 of 5).') + '</p>' +
      (g ? '<h3>Not in your master CV (left off the resume)</h3><p>If you have done one of these, click <em>I have done this</em> and write it in your own words. The board adds it to your master CV, and career-ops makes this resume again.</p><ul class="gap-list">' + g + '</ul>' : '') +
      (c ? '<h3>Added to your master CV</h3><ul class="gap-list confirmed">' + c + '</ul>' : '') +
      '</div>';
  }

  function roleById(id) {
    return state.roles.filter(function (r) { return String(r.id) === String(id); })[0];
  }

  document.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('gap-text') && gapForm) gapForm.text = e.target.value;
  });
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el.classList) return;
    if (el.classList.contains('gap-confirm')) {
      gapForm = { roleId: Number(el.getAttribute('data-role-id')), idx: Number(el.getAttribute('data-idx')), text: '' };
      render();
      var ta = document.querySelector('.gap-text');
      if (ta) ta.focus();
    } else if (el.classList.contains('gap-cancel')) {
      gapForm = null;
      render();
    } else if (el.classList.contains('gap-save') && gapForm && !gapForm.busy) {
      var role = roleById(gapForm.roleId);
      var gap = role && role.tailor && role.tailor.gaps[gapForm.idx];
      gapForm.busy = true; gapForm.error = null;
      render();
      fetch('/api/roles/' + encodeURIComponent(gapForm.roleId) + '/gaps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gap: gap, answer: gapForm.text }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || 'error ' + r.status);
          gapForm = null;
          refreshStatusEl.textContent = 'Added to your master CV. career-ops makes this resume again ' + (body.retailoring === 'now' ? 'now (about 3 minutes).' : 'in the next run.');
          loadRoles();
          pollRefreshStatus();
        });
      }).catch(function (err) {
        if (gapForm) { gapForm.busy = false; gapForm.error = err.message; }
        render();
      });
    }
  });

  // Opens a tailored file on the Mac that runs the board. On another
  // device the server says no (403): then download it, or for the folder
  // say why nothing opened.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.doc-link[data-open]');
    if (!a) return;
    e.preventDefault();
    fetch(a.getAttribute('data-open'), { method: 'POST' }).then(function (r) {
      if (r.ok) return;
      if (r.status === 403 && a.getAttribute('href') !== '#') { window.location.href = a.getAttribute('href'); return; }
      return r.json().catch(function () { return {}; }).then(function (body) {
        window.alert(body.error || 'The file did not open (error ' + r.status + ').');
      });
    }).catch(function () { window.alert('The file did not open: the board server did not answer.'); });
  });

  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '#';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function flashStat(el, newValue) {
    var next = String(newValue);
    if (el.textContent === next) return;
    el.textContent = next;
    if (prefersReducedMotion) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  // Open "Why this score" panels survive re-renders (e.g. clicking a mark).
  var openWhy = {};
  document.addEventListener('toggle', function (e) {
    var el = e.target;
    if (el.classList && el.classList.contains('why')) {
      var id = el.getAttribute('data-role-id');
      if (el.open) openWhy[id] = true; else delete openWhy[id];
    }
  }, true);

  function applyRender() {
    var filtered = state.roles.filter(function (r) { return matchesFacets(r) && matchesTab(r); });
    // A job id search also finds the roles the board hides (below the RM minimum).
    if (state.query) filtered = filtered.concat(state.hiddenRoles.filter(function (r) { return jobIdHit(r) && matchesTab(r); }));
    var sorted = sortRoles(filtered);

    document.getElementById('cards').innerHTML = sorted.map(cardHtml).join('');
    // Set through the DOM, not a style attribute, so the CSP needs no 'unsafe-inline'.
    document.querySelectorAll('#cards .card').forEach(function (el) { el.style.viewTransitionName = 'role-' + el.getAttribute('data-card-id'); });
    document.getElementById('emptyState').hidden = sorted.length !== 0;
    document.getElementById('resultsMeta').textContent = 'Showing ' + sorted.length + ' of ' + state.roles.filter(matchesTab).length;

    var counts = { interested: 0, applied: 0, rejected: 0, closed: 0 };
    state.roles.forEach(function (r) {
      var m = markOf(r);
      if (m && counts.hasOwnProperty(m)) counts[m]++;
    });
    flashStat(document.getElementById('tabOpenN'), state.roles.length - counts.applied - counts.rejected);
    flashStat(document.getElementById('tabInterestedN'), counts.interested);
    flashStat(document.getElementById('tabAppliedN'), counts.applied);
    flashStat(document.getElementById('tabRejectedN'), counts.rejected);
    flashStat(document.getElementById('tabClosedN'), counts.closed);

    Array.prototype.forEach.call(document.querySelectorAll('.mark-btn'), function (btn) {
      btn.addEventListener('click', function () { toggleMark(btn.getAttribute('data-role-id'), btn.getAttribute('data-mark')); });
    });
  }

  var activeTransition = null;

  function render() {
    if (prefersReducedMotion || !document.startViewTransition || activeTransition) {
      applyRender();
      return;
    }
    var transition = document.startViewTransition(applyRender);
    activeTransition = transition;
    transition.finished.catch(function () {}).then(function () {
      if (activeTransition === transition) activeTransition = null;
    });
  }

  function putMark(roleId, status) {
    return fetch('/api/roles/' + encodeURIComponent(roleId) + '/mark', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status }),
    }).then(function (r) { if (!r.ok) throw new Error('error ' + r.status); });
  }

  function toggleMark(roleId, value) {
    var current = state.marks[roleId];
    var next = current === value ? null : value;
    if (next) state.marks[roleId] = next; else delete state.marks[roleId];
    saveMarks();
    render();
    putMark(roleId, next).catch(function (err) {
      window.alert('The mark was not saved on the server (' + err.message + '). It stays in this browser only.');
    });
  }

  // The server keeps the marks. One time in each browser, the marks that
  // only this browser has (from before the server kept them) go to the
  // server; after that, the server's marks win.
  var COPIED_KEY = 'india-gcc-board:marks-copied-to-server';
  function loadServerMarks() {
    fetch('/api/marks').then(function (r) { return r.ok ? r.json() : null; }).then(function (body) {
      if (!body) return;
      var server = body.marks || {};
      var copied = false;
      try { copied = localStorage.getItem(COPIED_KEY) === 'yes'; } catch (e) {}
      if (!copied) {
        var local = state.marks;
        var uploads = Object.keys(local).filter(function (id) { return !server[id]; });
        Promise.all(uploads.map(function (id) { return putMark(id, local[id]).then(function () { server[id] = local[id]; }); }))
          .then(function () {
            try { localStorage.setItem(COPIED_KEY, 'yes'); } catch (e) {}
            state.marks = server; saveMarks(); render();
          })
          // Not all copied: keep this browser's marks; the next load tries again.
          .catch(function () {});
        return;
      }
      state.marks = server;
      saveMarks();
      render();
    }).catch(function () {});
  }

  // "Refreshing: 14 of 56 employers done (now: Nomura, Intuit)" from
  // lib/progress.js messages; several employers run at once.
  function progressText(p) {
    if (!p) return 'Refreshing: starting';
    if (p.stage === 'scrape') return 'Refreshing: ' + p.done + ' of ' + p.total + ' employers done' + (p.item ? ' (now: ' + p.item + ')' : '');
    if (p.stage === 'descriptions') return 'Refreshing: job description ' + p.done + ' of ' + p.total + ' (' + p.item + ')';
    if (p.stage === 'classify') return 'Refreshing: classifying roles';
    if (p.stage === 'publish') return 'Refreshing: publishing roles';
    return 'Refreshing';
  }

  // The refresh status panel on "Updated …": what is done and what is
  // pending (lib/checkpoint.js). "Updated" is always the last complete run.
  function refreshSummary() {
    var r = state.meta.refresh;
    var t = state.targeting || {};
    var last = state.meta.last_refresh ? exactTime(state.meta.last_refresh) : 'unknown';
    var rows = [];
    var heading;
    var note = '';
    if (state.refreshRunning) {
      var p = state.refreshProgress;
      heading = 'Refresh running';
      rows.push(['Now', progressText(p).replace(/^Refreshing: /, '')]);
      if (r && !r.complete) {
        rows.push(['Done', r.refreshed + ' of ' + r.total + ' employers saved']);
        rows.push(['Pending', (r.total - r.refreshed) + ' employers']);
      }
      rows.push(['Last complete', last]);
      note = 'Until the refresh finishes, some roles are from the last complete refresh.';
    } else if (!r) {
      heading = 'Complete';
      rows.push(['Last refresh', last]);
    } else if (r.complete) {
      heading = 'Complete';
      rows.push(['Done', r.refreshed + ' of ' + r.total + ' employers']);
      rows.push(['Finished', exactTime(r.completed_at)]);
      rows.push(['Failed', r.failed.length ? r.failed.join(', ') : 'none']);
      if (r.failed.length) note = 'Failed employers show roles from an earlier refresh. The next refresh tries them again.';
    } else {
      heading = 'Partial: the last refresh stopped before the end';
      rows.push(['Done', r.refreshed + ' of ' + r.total + ' employers']);
      rows.push(['Pending', (r.total - r.refreshed) + ' employers, with roles from ' + last]);
      rows.push(['Started', exactTime(r.started_at)]);
      if (r.failed.length) rows.push(['Failed', r.failed.join(', ')]);
      note = 'A scheduled or automatic run in the 12 hours after the start continues from where this run stopped. Refresh now starts a full refresh.';
    }
    if (t.scored != null) {
      rows.push(['Scores', t.scored + ' scored' + (t.unscored ? ', ' + t.unscored + ' waiting' : '') + (state.refreshScoring ? ' (scoring now)' : '')]);
    }
    return { heading: heading, rows: rows, note: note };
  }

  function renderRefreshCompleteness() {
    var r = state.meta.refresh;
    var summary = refreshSummary();
    var tip = document.getElementById('freshTip');
    tip.textContent = '';
    var h = document.createElement('h4');
    h.textContent = summary.heading;
    tip.appendChild(h);
    var dl = document.createElement('dl');
    summary.rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    tip.appendChild(dl);
    if (summary.note) {
      var note = document.createElement('p');
      note.textContent = summary.note;
      tip.appendChild(note);
    }
    var tag = document.getElementById('freshPartial');
    var p = state.refreshProgress;
    tag.textContent = !state.refreshRunning ? 'Partial'
      : (p && p.stage === 'scrape' ? 'Refreshing ' + p.done + ' of ' + p.total : 'Refreshing');
    tag.hidden = !state.refreshRunning && !(r && !r.complete);
  }

  // A tap opens or closes the panel (no hover on a phone); Escape and a
  // tap outside close it.
  (function () {
    var el = document.getElementById('freshStatus');
    // Keyboard focus opens the panel; a tap toggles it (focus stays on
    // the item after a tap, so focus alone cannot be the open state).
    el.addEventListener('focus', function () { el.classList.add('open'); });
    el.addEventListener('blur', function () { el.classList.remove('open'); });
    el.addEventListener('click', function (e) {
      if (e.target.closest('.fresh-tip')) return;
      if (el.classList.contains('open') && el.dataset.justFocused !== '1') { el.classList.remove('open'); el.blur(); }
      else el.classList.add('open');
      el.dataset.justFocused = '';
    });
    el.addEventListener('pointerdown', function () { el.dataset.justFocused = document.activeElement === el ? '' : '1'; });
    document.addEventListener('click', function (e) {
      if (!el.contains(e.target)) el.classList.remove('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { el.classList.remove('open'); el.blur(); }
    });
  })();

  function renderFreshbar() {
    document.getElementById('freshTime').textContent = state.meta.last_refresh ? relativeTime(state.meta.last_refresh) : 'unknown';
    document.getElementById('freshTimeExact').textContent = state.meta.last_refresh
      ? ' (' + exactTime(state.meta.last_refresh) + ')'
      : '';
    renderRefreshCompleteness();
    flashStat(document.getElementById('freshCount'), state.roles.length);
    var t = state.targeting;
    var scoringEl = document.getElementById('freshScoring');
    if (t && t.scored != null) {
      var text = '<strong>' + t.scored + '</strong>scored';
      var notes = [];
      if (t.unscored) notes.push(t.unscored + ' waiting for a score');
      if (t.exceptions_hidden) notes.push(t.exceptions_hidden + ' AVP or Senior Manager roles hidden (RM score below ' + t.exception_min_fit + ')');
      if (t.employer_floor_hidden) notes.push(t.employer_floor_hidden + ' Amazon roles hidden (RM score below ' + ((t.employer_min_fit || {}).amazon || '') + ')');
      if (notes.length) text += ', ' + notes.join(', ');
      scoringEl.innerHTML = text;
    } else {
      scoringEl.textContent = '';
    }
    document.getElementById('freshTargetDetail').textContent = t
      ? ' (' + t.target + ' target, ' + (t.exception_shown != null ? t.exception_shown : t.exception) + ' exception, from ' + t.scanned + ' open roles)'
      : '';

    // Count employers over every scraped role, not just the shortlist.
    var withResults = state.coverage.withRoles != null
      ? state.coverage.withRoles
      : uniqueSorted(state.roles.map(function (r) { return r.employer; })).length;
    var fetched = state.coverage.fetchedCount;
    var total = state.coverage.totalTracked;
    var noResults = Math.max(fetched - withResults, 0);

    flashStat(document.getElementById('freshEmployers'), fetched + ' of ' + total);

    var detail = withResults + ' with roles';
    if (noResults > 0) detail += ', ' + noResults + ' with none this time';
    detail += ', ' + state.coverage.manualCount + ' checked by hand';
    document.getElementById('freshEmployersDetail').textContent = ' (' + detail + ')';
  }

  document.getElementById('search').addEventListener('input', function (e) { state.query = e.target.value; render(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  document.getElementById('clearFilters').addEventListener('click', function () { resetFacets(); });
  document.getElementById('emptyClear').addEventListener('click', function () { resetFacets(); });

  function resetFacets() {
    state.scoreBands.clear(); state.coBands.clear(); state.grades.clear(); state.families.clear(); state.locations.clear(); state.employers.clear();
    state.posted = null;
    state.showOlder = false;
    state.query = ''; document.getElementById('search').value = '';
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.setAttribute('aria-pressed', 'false'); });
    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.setAttribute('aria-pressed', 'false'); });
      tab.setAttribute('aria-pressed', 'true');
      state.tab = tab.getAttribute('data-tab');
      render();
    });
  });

  // The filter panel is a disclosure on narrow screens; keep it open on wide ones.
  var filtersEl = document.getElementById('filters');
  var wide = window.matchMedia('(min-width: 961px)');
  function syncFilters() { if (wide.matches) filtersEl.open = true; else filtersEl.open = false; }
  syncFilters();
  if (wide.addEventListener) wide.addEventListener('change', syncFilters);

  // --- data: fetched from this server's own API, no external dependency ---
  function loadRoles() {
    fetch('/api/roles').then(function (r) {
      if (!r.ok) return r.json().then(function (body) { throw new Error(body.error || 'The board could not load the roles.'); });
      return r.json();
    }).then(function (payload) {
      state.roles = payload.roles || [];
      state.hiddenRoles = payload.hidden_roles || [];
      state.meta = payload.meta || {};
      state.coverage = payload.coverage || state.coverage;
      state.targeting = payload.targeting || null;
      document.getElementById('syncStatus').textContent = 'Served from this computer by server.js.';
      document.querySelector('.fresh-dot').classList.add('live');
      initFacets();
      renderFreshbar();
      render();
    }).catch(function (err) {
      document.getElementById('syncStatus').textContent = err.message || 'No roles yet. Click Refresh now to collect them.';
    });
  }

  // --- on-demand refresh, polling the same server ---
  var refreshBtn = document.getElementById('refreshBtn');
  var refreshStatusEl = document.getElementById('refreshStatus');
  var pollTimer = null;
  var wasRunning = false;
  var wasScoring = false;
  var wasTailoringDone = null;
  var lastLiveReload = Date.now();  // loadRoles() runs at page load
  var reloadedAt = null;            // progress key of the last live reload

  function pollRefreshStatus() {
    fetch('/api/refresh/status').then(function (r) { return r.json(); }).then(function (s) {
      state.refreshRunning = Boolean(s.running);
      state.refreshScoring = Boolean(s.scoring);
      state.refreshProgress = s.running ? (s.progress || null) : null;
      renderRefreshCompleteness();
      if (s.running) {
        wasRunning = true;
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing…';
        refreshStatusEl.textContent = progressText(s.progress) + '. The refresh started ' + relativeTime(s.lastStartedAt) + '.';
        // Each finished employer is already on the board: reload the roles
        // when the employer count (or the stage) moved since the last
        // reload, at most once a minute.
        var p = s.progress;
        var key = p ? p.stage + ':' + (p.stage === 'scrape' ? p.done : '') : null;
        if (key && reloadedAt === null) reloadedAt = key;
        if (key && key !== reloadedAt && Date.now() - lastLiveReload > 60000) {
          lastLiveReload = Date.now();
          reloadedAt = key;
          loadRoles();
        }
        if (!pollTimer) pollTimer = setInterval(pollRefreshStatus, 15000);
      } else {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh now';
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (wasRunning) { wasRunning = false; loadRoles(); }
        // autoscore.js runs after a successful refresh; keep polling until
        // it ends, then load the new scores.
        if (s.scoring) {
          wasScoring = true;
          var sp = s.scoringProgress;
          refreshStatusEl.textContent = sp && sp.total
            ? 'Scoring the new roles with Claude Code: ' + sp.done + ' of ' + sp.total + ' done, ' + sp.scored + ' scored, '
              + sp.rejected + ' rejected, ' + Math.max(0, sp.total - sp.done) + ' left' + (sp.model ? ' (' + sp.model + ').' : '.')
            : 'Scoring the new roles with Claude Code…';
          if (!pollTimer) pollTimer = setInterval(pollRefreshStatus, 15000);
          return;
        }
        if (wasScoring) { wasScoring = false; loadRoles(); }
        // tailor.js runs after the scoring: one role takes about 3 minutes,
        // so reload the roles after each finished role.
        if (s.tailoring) {
          var tp = s.tailoringProgress;
          refreshStatusEl.textContent = tp && tp.total
            ? 'Making tailored resumes with career-ops: ' + tp.done + ' of ' + tp.total + ' roles done, ' + tp.ready + ' Word resumes made'
              + (tp.failed ? ', ' + tp.failed + ' failed' : '') + '.'
            : 'Making tailored resumes with career-ops…';
          if (tp && tp.done !== wasTailoringDone) { wasTailoringDone = tp.done; loadRoles(); }
          if (!pollTimer) pollTimer = setInterval(pollRefreshStatus, 15000);
          return;
        }
        if (wasTailoringDone !== null) { wasTailoringDone = null; loadRoles(); }
        if (s.paused) {
          refreshStatusEl.textContent = 'Refresh paused: ' + s.paused + '.';
          return;
        }
        refreshStatusEl.textContent = s.lastFinishedAt
          ? 'Last refresh finished ' + relativeTime(s.lastFinishedAt) + (s.lastExitCode ? ' with exit code ' + s.lastExitCode + '.' : '.')
          : '';
      }
    }).catch(function () {});
  }

  refreshBtn.addEventListener('click', function () {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Starting…';
    fetch('/api/refresh', { method: 'POST' }).then(function (r) {
      // 202: started; 409: a refresh already runs. Other answers (for
      // example 403 from the Host or Origin check) show their reason.
      if (r.ok || r.status === 409) { pollRefreshStatus(); return; }
      return r.json().catch(function () { return {}; }).then(function (body) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh now';
        refreshStatusEl.textContent = 'The refresh did not start: ' + String(body.error || 'error ' + r.status).replace(/\.$/, '') + '.';
      });
    }).catch(function () {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh now';
      refreshStatusEl.textContent = 'The refresh did not start: the server did not answer.';
    });
  });

  // --- refresh schedule: daily at a time, or on demand only ---
  var scheduleMode = document.getElementById('scheduleMode');
  var scheduleTime = document.getElementById('scheduleTime');
  var scheduleNote = document.getElementById('scheduleNote');

  function showSchedule(s) {
    scheduleMode.value = s.mode;
    scheduleTime.value = s.time;
    scheduleTime.hidden = s.mode !== 'daily';
    scheduleNote.textContent = s.mode === 'daily' ? '(' + s.timezone + ')' : '';
  }

  var saveSeq = 0;
  function saveSchedule() {
    var seq = ++saveSeq;
    scheduleTime.hidden = scheduleMode.value !== 'daily';
    scheduleNote.textContent = 'Saving…';
    fetch('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: scheduleMode.value, time: scheduleTime.value || '06:00' }),
    }).then(function (r) {
      return r.json().then(function (body) { if (!r.ok) throw new Error(body.error || 'The schedule was not saved.'); return body; });
    }).then(function (s) {
      if (seq !== saveSeq) return; // a newer change is on its way
      showSchedule(s);
      scheduleNote.textContent = 'Saved';
      // Only the note changes back; never redraw an older setting.
      setTimeout(function () { if (seq === saveSeq) showSchedule(s); }, 1500);
    }).catch(function (err) { if (seq === saveSeq) scheduleNote.textContent = err.message; });
  }

  fetch('/api/schedule').then(function (r) { return r.json(); }).then(showSchedule).catch(function () {
    scheduleNote.textContent = 'Schedule not available';
  });
  scheduleMode.addEventListener('change', saveSchedule);
  scheduleTime.addEventListener('change', saveSchedule);

  pollRefreshStatus();
  loadRoles();
  loadServerMarks();
})();
