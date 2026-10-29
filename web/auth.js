/* Stage 2 views: sign in / sign up, account, teacher dashboard. Only used when APP_CONFIG.MODE === 'api'. */
(function () {
  'use strict';
  var A = window.App, $ = A.$, $$ = A.$$, esc = A.esc, V = A.ExtraViews;

  function goHome() { var same = location.hash === '#/' || location.hash === ''; location.hash = '#/'; if (same) A.route(); }
  function enter() { return A.loadAll().then(goHome); }
  function field(label, name, type, extra) {
    return '<label class="field"><span class="eyebrow">' + label + '</span><input name="' + name + '" type="' + type + '" required ' + (extra || '') + '></label>';
  }
  function busy(btn, on) { btn.disabled = on; btn.textContent = on ? '…' : btn.dataset.label; }

  /* ---------- sign in ---------- */
  V.login = function (app) {
    app.innerHTML = '<div class="auth reveal"><span class="eyebrow">Private reading room</span><h1>Welcome back.</h1><p class="lede" style="margin:0 0 30px">Sign in to continue your practice.</p>' +
      '<form id="f" novalidate>' + field('Email', 'email', 'email', 'autocomplete="username" inputmode="email"') + field('Password', 'password', 'password', 'autocomplete="current-password"') +
      '<div class="err" id="err" role="alert"></div><button class="btn accent" data-label="Sign in">Sign in</button></form>' +
      '<p class="muted" style="margin-top:28px">New here? <a href="#/signup">Join with your invite code</a></p></div>';
    $('#f').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, b = $('button', f); b.dataset.label = 'Sign in'; busy(b, true); $('#err').textContent = '';
      Backend.login(f.email.value, f.password.value).then(enter).catch(function (er) { $('#err').textContent = er.message; busy(b, false); });
    };
  };

  /* ---------- sign up ---------- */
  V.signup = function (app) {
    app.innerHTML = '<div class="auth reveal"><span class="eyebrow">By invitation</span><h1>Join the reading room.</h1><p class="lede" style="margin:0 0 30px">We keep only your name, email and results. <a href="#/privacy">Privacy note</a></p>' +
      '<form id="f" novalidate>' + field('Name', 'name', 'text', 'autocomplete="name" maxlength="60"') + field('Email', 'email', 'email', 'autocomplete="username" inputmode="email"') +
      field('Password (10+ characters)', 'password', 'password', 'autocomplete="new-password" minlength="10"') + field('Invite code', 'invite', 'text', 'autocomplete="off" autocapitalize="off"') +
      '<div class="err" id="err" role="alert"></div><button class="btn accent" data-label="Create account">Create account</button></form>' +
      '<p class="muted" style="margin-top:28px">Already have an account? <a href="#/login">Sign in</a></p></div>';
    $('#f').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, b = $('button', f); b.dataset.label = 'Create account'; busy(b, true); $('#err').textContent = '';
      Backend.signup(f.name.value, f.email.value, f.password.value, f.invite.value).then(enter).catch(function (er) { $('#err').textContent = er.message; busy(b, false); });
    };
  };

  /* ---------- account ---------- */
  V.account = function (app) {
    var u = Backend.user;
    app.innerHTML = '<div class="wrap"><section class="passage-head reveal"><span class="eyebrow">Account</span><h1>' + esc(u.name) + '</h1><p class="muted">' + esc(u.email) + (u.role === 'teacher' ? ' · teacher' : '') + '</p></section>' +
      '<section class="block reveal"><span class="eyebrow">Change password</span><form id="pw" style="margin-top:14px;max-width:420px" novalidate>' + field('Current password', 'cur', 'password', 'autocomplete="current-password"') + field('New password (10+ characters)', 'nxt', 'password', 'autocomplete="new-password" minlength="10"') + '<div class="err" id="pwerr" role="alert"></div><button class="btn ghost" data-label="Update password">Update password</button></form></section>' +
      '<section class="block reveal"><div class="row"><button class="btn ghost" id="out">Sign out</button><a class="btn ghost" href="#/privacy">Privacy note</a></div></section>' +
      (u.role === 'teacher' ? '' : '<section class="block reveal"><span class="eyebrow">Delete my account</span><p class="muted">Permanently removes your name, email, results and review deck. This cannot be undone.</p><form id="del" style="max-width:420px" novalidate>' + field('Confirm with your password', 'p', 'password', 'autocomplete="current-password"') + '<div class="err" id="delerr" role="alert"></div><button class="btn ghost" style="border-color:var(--bad);color:var(--bad)" data-label="Delete everything">Delete everything</button></form></section>') + '</div>';
    $('#out').onclick = function () { Backend.logout().then(function () { location.hash = '#/login'; A.route(); }); };
    $('#pw').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, b = $('button', f); b.dataset.label = 'Update password'; busy(b, true); $('#pwerr').textContent = '';
      Backend.changePassword(f.cur.value, f.nxt.value).then(function () { f.reset(); A.toast('Password updated'); busy(b, false); }).catch(function (er) { $('#pwerr').textContent = er.message; busy(b, false); });
    };
    var d = $('#del'); if (d) d.onsubmit = function (e) {
      e.preventDefault(); if (!confirm('Delete your account and all results permanently?')) return;
      var f = e.target, b = $('button', f); b.dataset.label = 'Delete everything'; busy(b, true);
      Backend.deleteAccount(f.p.value).then(function () { location.hash = '#/login'; A.route(); A.toast('Account deleted'); }).catch(function (er) { $('#delerr').textContent = er.message; busy(b, false); });
    };
  };

  /* ---------- teacher: grid ---------- */
  function ago(ts) {
    if (!ts) return 'never';
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 3) return 'online now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' h ' + (m % 60) + ' min ago';
    var d = Math.floor(h / 24);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }
  // keep the grid fresh while the teacher is looking at it
  setInterval(function () { if (!document.hidden && location.hash === '#/teacher') A.route(); }, 30000);

  V.teacher = function (app, id) {
    if (!Backend.user || Backend.user.role !== 'teacher') { app.innerHTML = '<div class="wrap" style="padding-top:80px"><h2>Teachers only</h2></div>'; return; }
    if (id) return studentDetail(app, id);
    return Backend.teacherStudents().then(function (list) {
      var active = list.filter(function (s) { return !s.inactive; }).length;
      app.innerHTML = '<div class="wrap wide"><section class="passage-head reveal"><span class="eyebrow">Teacher</span><h1>Your students</h1><p class="lede">' + active + ' of ' + list.length + ' active this week.</p></section>' +
        (list.length ? '<div class="scroll-x reveal"><table class="grid"><thead><tr><th>Student</th><th>Last active</th><th>Accuracy</th><th>Trend</th><th>Answered</th><th>Deck</th></tr></thead><tbody>' +
          list.map(function (s) {
            return '<tr class="click" data-id="' + esc(s.id) + '" tabindex="0"><td><strong>' + esc(s.name) + '</strong><br><span class="muted" style="font-size:12px">' + esc(s.email) + '</span></td>' +
              '<td>' + (ago(s.lastActive) === 'online now' ? '<span class="chip ok">● online now</span>' : ago(s.lastActive)) + (s.inactive ? ' <span class="chip bad">inactive</span>' : '') + '</td><td><span class="num-l" style="font-size:1.8rem">' + s.accuracy + '<small>%</small></span></td>' +
              '<td style="min-width:110px"><div style="display:flex;align-items:center;gap:8px"><div style="width:70px">' + A.sparkline(s.series, 70, 28) + '</div>' + A.trendArrow(s.trend) + '</div></td><td>' + s.answered + '</td><td>' + s.deckSize + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="card"><p class="lede" style="margin:0">No students yet. Share the invite code with them.</p></div>') + '</div>';
      $$('tr.click', app).forEach(function (tr) {
        var go = function () { location.hash = '#/teacher/' + tr.dataset.id; };
        tr.onclick = go; tr.onkeydown = function (e) { if (e.key === 'Enter') go(); };
      });
    });
  };

  /* ---------- teacher: student detail ---------- */
  function studentDetail(app, id) {
    return Backend.teacherStudent(id).then(function (d) {
      var s = d.student, o = d.overall, causeN = d.causes || {};
      app.innerHTML = '<div class="wrap wide"><a class="muted" href="#/teacher">← All students</a>' +
        '<section class="passage-head reveal"><span class="eyebrow">Student</span><h1>' + esc(s.name) + '</h1><p class="muted">' + esc(s.email) + ' · last active ' + ago(s.lastActive) + '</p></section>' +
        '<div class="stat-grid reveal"><div class="stat"><span class="eyebrow">Overall accuracy</span><div class="num-xl">' + o.accuracy + '<small>%</small></div><p class="muted" style="margin:6px 0 0">' + o.right + ' of ' + o.answered + '</p></div>' +
        '<div class="stat"><span class="eyebrow">Trend ' + A.trendArrow(o.trend) + '</span>' + A.sparkline(o.series) + '</div>' +
        '<div class="stat"><span class="eyebrow">Vocab deck</span><div class="num-xl">' + d.deckSize + '</div><p class="muted" style="margin:6px 0 0">words to review</p></div></div>' +
        '<section class="block reveal"><span class="eyebrow">Top weakness</span><h2 style="margin-top:8px">' + (d.weakness ? esc(A.typeLabel(d.weakness.type)) + ' — ' + d.weakness.right + ' of ' + d.weakness.n : 'Not enough data yet') + '</h2></section>' +
        '<section class="block reveal"><span class="eyebrow">Accuracy and time by question type</span><div class="scroll-x"><table class="grid" style="margin-top:10px"><thead><tr><th>Type</th><th>Correct</th><th>Accuracy</th><th>Avg time</th><th>Total time</th><th>Evidence found</th></tr></thead><tbody>' +
        d.byType.map(function (t) { return '<tr><td>' + esc(A.typeLabel(t.type)) + '</td><td>' + t.right + ' of ' + t.n + '</td><td>' + t.accuracy + '%</td><td>' + A.fmtDur(t.avgSecs) + '</td><td>' + A.fmtDur(t.totalSecs) + '</td><td>' + (t.evidenceTapped ? t.evidenceHit + ' of ' + t.evidenceTapped : '—') + '</td></tr>'; }).join('') + '</tbody></table></div></section>' +
        '<section class="block reveal"><span class="eyebrow">Why answers went wrong (self-reported)</span><div class="row" style="margin-top:10px"><span class="chip">couldn’t find · ' + (causeN.notfind || 0) + '</span><span class="chip">misread · ' + (causeN.misread || 0) + '</span><span class="chip">ran out of time · ' + (causeN.time || 0) + '</span></div></section>' +
        '<section class="block reveal"><span class="eyebrow">Wrong questions (' + d.wrong.length + ')</span>' +
        (d.wrong.length ? '<div class="scroll-x"><table class="grid" style="margin-top:10px"><thead><tr><th>Passage</th><th>Q</th><th>Type</th><th>Gave</th><th>Answer</th><th>Cause</th><th>When</th></tr></thead><tbody>' +
          d.wrong.map(function (w) { return '<tr><td>' + esc(w.passageTitle) + '</td><td title="' + esc(w.prompt || '') + '">' + esc(w.number || w.questionId) + '</td><td>' + esc(A.typeLabel(w.qtype)) + '</td><td>' + esc(w.given) + '</td><td>' + esc(w.answer || '') + '</td><td>' + esc(w.cause || '—') + '</td><td>' + A.fmtDate(w.ts) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">None yet.</p>') + '</section>' +
        '<section class="block reveal"><span class="eyebrow">Account</span><p class="muted">Forgotten password? Set a new one, or leave it blank to generate a temporary one. Their other sessions are signed out.</p><div class="row"><input class="input" id="npw" type="text" placeholder="New password (optional, 10+ chars)" autocomplete="off" style="max-width:320px"><button class="btn ghost" id="reset">Reset password</button></div><div class="err" id="reseterr" role="alert"></div><div id="resetout"></div></section></div>';
      $('#reset').onclick = function () {
        if (!confirm('Reset ' + s.name + '’s password?')) return;
        Backend.teacherResetPassword(id, $('#npw').value.trim()).then(function (r) {
          $('#reseterr').textContent = '';
          $('#resetout').innerHTML = r.password ? '<div class="card" style="margin-top:14px"><span class="eyebrow">Temporary password — shown once</span><p class="num-l" style="font-size:2rem;margin:8px 0;user-select:all">' + esc(r.password) + '</p><p class="muted" style="margin:0">Send it privately, then ask ' + esc(s.name) + ' to change it under Account.</p></div>' : '<p class="chip ok">Password updated</p>';
          $('#npw').value = '';
        }).catch(function (er) { $('#reseterr').textContent = er.message; });
      };
    });
  }
})();
