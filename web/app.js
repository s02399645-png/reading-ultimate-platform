/* Marginalia — IELTS Academic Reading practice. Vanilla JS, no build step. */
(function () {
  'use strict';

  /* ================= helpers ================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var DAY = 86400000;
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  var pct = function (a, b) { return b ? Math.round((a / b) * 100) : 0; };
  var fmtDate = function (ts) { return ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  var fmtDur = function (s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  var TYPE_LABEL = { tfng: 'T/F/NG', ynng: 'Y/N/NG', mcq: 'Multiple choice', completion: 'Sentence completion', matching: 'Matching', heading: 'Headings', summary: 'Summary completion' };
  var typeLabel = function (t) { return TYPE_LABEL[t] || t; };

  /* ================= i18n ================= */
  var UI = {
    practice: { en: 'Practice', ru: 'Практика' }, review: { en: 'Review', ru: 'Повторение' }, progress: { en: 'Progress', ru: 'Прогресс' },
    teacher: { en: 'Teacher', ru: 'Учитель' }, account: { en: 'Account', ru: 'Профиль' }, signout: { en: 'Sign out', ru: 'Выйти' },
    start: { en: 'Begin passage', ru: 'Начать текст' }, keywords: { en: 'Key words first', ru: 'Сначала ключевые слова' },
    guess: { en: 'What do you think it means?', ru: 'Как думаешь, что это значит?' }, reveal: { en: 'Reveal', ru: 'Показать' },
    iknew: { en: 'I knew it', ru: 'Я знал(а)' }, didnt: { en: 'Not quite', ru: 'Не совсем' },
    check: { en: 'Check answer', ru: 'Проверить' }, finish: { en: 'Finish & see verdict', ru: 'Завершить и увидеть итог' },
    anchors: { en: 'Anchors', ru: 'Якоря' }, correct: { en: 'Correct', ru: 'Верно' }, notquite: { en: 'Not quite', ru: 'Не совсем' },
    answerIs: { en: 'Answer', ru: 'Ответ' }, tapEvidence: { en: 'Where is the proof? Tap the sentence in the passage.', ru: 'Где доказательство? Нажми на предложение в тексте.' },
    skip: { en: 'Skip', ru: 'Пропустить' }, paraphrase: { en: 'The paraphrase', ru: 'Перефразирование' }, why: { en: 'Why', ru: 'Почему' },
    whyNot: { en: 'Why the other options are wrong', ru: 'Почему остальные варианты неверны' }, cause: { en: 'What went wrong?', ru: 'Что пошло не так?' },
    matter: { en: 'Did the words matter?', ru: 'Помешали ли слова?' }, wordsYes: { en: 'Yes, a word blocked me', ru: 'Да, слово помешало' }, wordsNo: { en: 'No, the words were fine', ru: 'Нет, слова были понятны' },
    cNotFind: { en: "Couldn't find it", ru: 'Не нашёл(а)' }, cMisread: { en: 'Misread it', ru: 'Неверно прочитал(а)' }, cTime: { en: 'Ran out of time', ru: 'Не хватило времени' },
    nextStep: { en: 'Your next step', ru: 'Следующий шаг' }
  };
  var ui = function (k) { var o = UI[k]; return S.lang === 'ru' ? o.ru : o.en; };
  var tx = function (o) {
    if (!o) return '';
    if (typeof o === 'string') return esc(o);
    if (S.lang === 'en') return esc(o.en);
    if (S.lang === 'ru') return esc(o.ru || o.en);
    return esc(o.en) + (o.ru ? '<span class="bi-ru">' + esc(o.ru) + '</span>' : '');
  };

  /* ================= app state ================= */
  var S = { lang: 'both', theme: null, anchors: null, state: { deck: [], settings: {}, attempts: [] }, answers: [], passages: [], user: null };
  var run = null; // active passage session

  function loadSettings() {
    var s = S.state.settings || {};
    S.lang = s.lang || 'both';
    S.anchors = typeof s.anchors === 'boolean' ? s.anchors : null;
  }
  function persist() {
    S.state.settings = Object.assign({}, S.state.settings, { lang: S.lang, anchors: S.anchors });
    return Backend.setState(S.state).catch(function () {});
  }
  var persistSoon = (function () { var t; return function () { clearTimeout(t); t = setTimeout(persist, 600); }; })();
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 2400); }

  /* ================= stats ================= */
  function computeStats(answers) {
    var by = {}, causes = { notfind: 0, misread: 0, time: 0 };
    var total = 0, right = 0;
    answers.forEach(function (a) {
      var b = by[a.qtype] || (by[a.qtype] = { type: a.qtype, n: 0, right: 0, secs: 0, evN: 0, evHit: 0 });
      b.n++; total++; b.secs += a.secs || 0;
      if (a.correct) { b.right++; right++; }
      else if (a.cause && causes[a.cause] != null) causes[a.cause]++;
      if (a.evidence === 'hit' || a.evidence === 'miss') { b.evN++; if (a.evidence === 'hit') b.evHit++; }
    });
    var types = Object.keys(by).map(function (k) { var b = by[k]; b.acc = pct(b.right, b.n); b.avg = b.n ? b.secs / b.n : 0; return b; });
    var weak = types.filter(function (t) { return t.n >= 2; }).sort(function (a, b) { return a.acc - b.acc; })[0] || null;
    return { total: total, right: right, acc: pct(right, total), types: types, weak: weak, causes: causes };
  }
  function trendSeries(attempts) { return attempts.slice(-12).map(function (a) { return pct(a.score, a.total); }); }
  function trendDir(series) {
    if (series.length < 2) return 'flat';
    var half = Math.ceil(series.length / 2);
    var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / (a.length || 1); };
    var d = avg(series.slice(-half)) - avg(series.slice(0, series.length - half));
    return d > 4 ? 'up' : d < -4 ? 'down' : 'flat';
  }
  function trendArrow(dir) { return '<span class="trend ' + dir + '" title="' + dir + '">' + (dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→') + '</span>'; }
  function sparkline(vals, w, h) {
    w = w || 240; h = h || 56;
    if (!vals.length) return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"></svg>';
    if (vals.length === 1) vals = [vals[0], vals[0]];
    var step = w / (vals.length - 1), pts = vals.map(function (v, i) { return [i * step, h - 6 - (v / 100) * (h - 12)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var last = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z"/><path d="' + d + '" vector-effect="non-scaling-stroke"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3"/></svg>';
  }
  function typeBars(st, avgTime) {
    if (!st.types.length) return '<p class="muted">Answer a few questions and your pattern will appear here.</p>';
    return st.types.slice().sort(function (a, b) { return a.acc - b.acc; }).map(function (t) {
      return '<div class="bar-row"><div><span class="eyebrow">' + esc(typeLabel(t.type)) + '</span><div>' + t.right + ' of ' + t.n + (avgTime ? ' · <span class="muted">' + fmtDur(t.avg) + ' avg</span>' : '') + '</div></div><div class="val">' + t.acc + '%</div><div class="meter"><i class="' + (t.acc < 60 ? 'low' : '') + '" data-w="' + t.acc + '"></i></div></div>';
    }).join('');
  }

  /* ---- scaffolding fade ---- */
  function scaffoldLevel() {
    var recent = S.answers.slice(-20), n = recent.length;
    if (n < 10) return 0;
    var acc = recent.filter(function (a) { return a.correct; }).length / n;
    if (n >= 20 && acc >= 0.85) return 2;
    if (acc >= 0.75) return 1;
    return 0;
  }
  var SCAF_NAME = ['Full support', 'Lighter support', 'Minimal support'];
  function anchorsOn() { return S.anchors == null ? scaffoldLevel() === 0 : S.anchors; }

  /* ================= rotating headline ================= */
  var HERO = [
    { en: 'Band 7 is a <em>habit</em>, not a gift.', ru: 'Седьмой балл — это <em>привычка</em>, а не талант.' },
    { en: 'Read like you are <em>looking</em> for something.', ru: 'Читай так, будто что-то <em>ищешь</em>.' },
    { en: 'The answer is already on the page. <em>Go and find it.</em>', ru: 'Ответ уже на странице. <em>Иди и найди.</em>' },
    { en: '<em>Not Given</em> is not a trick. It is a skill.', ru: '<em>Not Given</em> — не подвох, а навык.' },
    { en: 'Today’s passage is waiting. It thinks you <em>won’t finish</em>.', ru: 'Сегодняшний текст ждёт. Он думает, что ты <em>не дочитаешь</em>.' },
    { en: 'Every wrong answer is a <em>map</em>. Follow it.', ru: 'Каждая ошибка — это <em>карта</em>. Иди по ней.' },
    { en: 'Bet you can’t beat <em>yesterday’s</em> score.', ru: 'Спорим, ты не побьёшь <em>вчерашний</em> результат?' },
    { en: 'The examiner loves a paraphrase. <em>Love it back.</em>', ru: 'Экзаменатор обожает перефразирование. <em>Полюби его в ответ.</em>' },
    { en: 'Slow is smooth. Smooth is <em>fast</em>.', ru: 'Медленно — значит чётко. Чётко — значит <em>быстро</em>.' },
    { en: 'Small words, big marks. Watch the <em>“however”</em>.', ru: 'Маленькие слова — большие баллы. Следи за <em>«however»</em>.' }
  ];
  var hero = { i: Math.floor(Math.random() * HERO.length), lang: Math.random() < 0.5 ? 'en' : 'ru', timer: null };
  function heroAdvance(manual) {
    var el = $('#heroLine'); if (!el) return;
    el.classList.add('out');
    setTimeout(function () {
      hero.i = (hero.i + 1) % HERO.length;
      hero.lang = hero.lang === 'en' ? 'ru' : 'en'; // every change flips the language
      if (!$('#heroLine')) return;
      $('#heroLine').innerHTML = HERO[hero.i][hero.lang];
      $('#heroLine').parentNode.className = hero.lang === 'ru' ? 'ru' : '';
      $$('.hero-dots i').forEach(function (d, k) { d.classList.toggle('on', k === hero.i); });
      $('#heroLine').classList.remove('out');
    }, 380);
    heroSchedule();
  }
  function heroSchedule() { clearTimeout(hero.timer); hero.timer = setTimeout(function () { if (document.hidden) heroSchedule(); else heroAdvance(); }, 3 * 60 * 1000); }

  /* ================= router ================= */
  var ExtraViews = (window.ExtraViews = window.ExtraViews || {});
  var Views = {};
  function route() {
    var h = (location.hash || '#/').slice(2).split('/'), name = h[0] || 'home', arg = h[1];
    var needAuth = Backend.mode === 'api' && !Backend.user && name !== 'login' && name !== 'signup' && name !== 'privacy';
    if (needAuth) { location.replace('#/login'); return; }
    if (run && run.timerId && name !== 'passage') { clearInterval(run.timerId); }
    clearTimeout(hero.timer);
    var view = Views[name] || ExtraViews[name] || Views.home;
    renderNav(name);
    window.scrollTo(0, 0);
    var app = $('#app'); app.innerHTML = '';
    Promise.resolve(view(app, arg)).then(function () { observe(); animateBars(); }).catch(function (e) {
      app.innerHTML = '<div class="wrap" style="padding-top:80px"><h2>Something went wrong</h2><p class="muted">' + esc(e.message || e) + '</p><a class="btn ghost" href="#/">Back home</a></div>';
    });
  }
  function renderNav(active) {
    var links = [['', 'practice', 'home'], ['review', 'review', 'review'], ['progress', 'progress', 'progress']];
    if (Backend.user && Backend.user.role === 'teacher') links.push(['teacher', 'teacher', 'teacher']);
    var html = '';
    if (Backend.mode === 'api' && !Backend.user) html = '';
    else {
      html = links.map(function (l) { return '<a href="#/' + l[0] + '"' + (active === l[2] ? ' aria-current="page"' : '') + '>' + ui(l[1]) + '</a>'; }).join('');
      if (Backend.mode === 'api') html += '<a href="#/account"' + (active === 'account' ? ' aria-current="page"' : '') + '>' + ui('account') + '</a>';
    }
    $('#nav').innerHTML = html;
    $$('#langSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)); });
  }
  function observe() {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .08 });
    $$('.reveal:not(.in)').forEach(function (el) { io.observe(el); });
  }
  function animateBars() { requestAnimationFrame(function () { setTimeout(function () { $$('.meter i[data-w]').forEach(function (i) { i.style.width = i.dataset.w + '%'; }); $$('.big-ring .bar[data-off]').forEach(function (c) { c.style.strokeDashoffset = c.dataset.off; }); }, 60); }); }
  function bigRing(p, label) {
    var r = 66, c = 2 * Math.PI * r, off = c * (1 - p / 100);
    return '<div class="big-ring"><svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="2"/><circle class="bar" cx="75" cy="75" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '" data-off="' + off + '"/></svg><div class="mid"><div class="num-l">' + p + '<small>%</small></div></div></div>';
  }

  /* ================= views: home ================= */
  Views.home = function (app) {
    var st = computeStats(S.answers), series = trendSeries(S.state.attempts), due = dueCount();
    var name = (Backend.user && Backend.user.name) || '';
    var first = name ? name.split(' ')[0] : '';
    var dots = HERO.map(function (_, k) { return '<i class="' + (k === hero.i ? 'on' : '') + '"></i>'; }).join('');
    app.innerHTML =
      '<div class="wrap wide">' +
      '<section class="hero reveal"><span class="eyebrow">' + (first ? 'Welcome back, ' + esc(first) : 'Welcome') + '</span>' +
      '<button class="hero-btn" id="heroBtn" aria-label="Next message"><span class="' + (hero.lang === 'ru' ? 'ru' : '') + '"><h1 id="heroLine" class="hero-line" aria-live="polite">' + HERO[hero.i][hero.lang] + '</h1></span>' +
      '<span class="hero-meta"><span class="hero-dots" aria-hidden="true">' + dots + '</span><span class="eyebrow hero-hint">tap · нажми</span></span></button></section>' +
      '<section class="block reveal"><span class="eyebrow">Today’s reading</span><div id="plist" style="display:grid;gap:18px;margin-top:16px"><div class="skeleton"></div></div></section>' +
      '<section class="block reveal"><div class="stat-grid">' +
      '<div class="stat"><span class="eyebrow">Accuracy</span><div class="num-xl">' + st.acc + '<small>%</small></div><p class="muted" style="margin:6px 0 0">' + st.right + ' of ' + st.total + ' answered correctly</p></div>' +
      '<div class="stat"><span class="eyebrow">Trend</span>' + sparkline(series) + '<p class="muted" style="margin:6px 0 0">' + (series.length ? 'Last ' + series.length + ' attempts ' : 'No attempts yet ') + trendArrow(trendDir(series)) + '</p></div>' +
      '<div class="stat"><span class="eyebrow">Review deck</span><div class="num-xl">' + due + '<small>due</small></div><p class="muted" style="margin:6px 0 0">' + S.state.deck.length + ' words in your deck</p></div>' +
      '</div><div class="row" style="margin-top:10px"><span class="chip gold">Scaffolding · ' + SCAF_NAME[scaffoldLevel()] + '</span>' + (st.weak ? '<span class="chip">Focus: ' + esc(typeLabel(st.weak.type)) + '</span>' : '') + '</div></section>' +
      '</div>';
    heroSchedule();
    $('#heroBtn').onclick = function () { heroAdvance(true); };
    return Backend.listPassages().then(function (list) {
      S.passages = list;
      $('#plist').innerHTML = list.map(function (p) {
        return '<a class="card passage-card" href="#/passage/' + esc(p.id) + '"><span class="eyebrow">' + esc(p.level || '') + ' · ' + esc(p.minutes || 20) + ' min · ' + esc(p.questions || '') + ' questions</span><h3>' + esc(p.title) + '</h3><p class="lede" style="margin:0">' + esc(p.subtitle || '') + '</p><p style="margin:18px 0 0" class="eyebrow">' + ui('start') + ' <span class="arrow">→</span></p></a>';
      }).join('') || '<p class="muted">No passages yet.</p>';
    });
  };

  /* ================= views: passage ================= */
  var LINKERS = 'however|but|although|though|whereas|while|because|therefore|despite|yet|only|none|never|always|all|some|most|few|not|every|first|initially|later|once|after|before|instead|unless|unlike|rather|nevertheless|moreover|whereas';
  var RE_NUM = /\b\d+(?:[.,]\d+)*(?:\s?(?:per cent|%|decibels))?|\b(?:twentieth|nineteenth|twenty-first|eighteenth) century\b/gi;
  var RE_LINK = new RegExp('\\b(?:' + LINKERS + ')\\b', 'gi');
  var RE_NAME = /\b[A-Z][a-z]{2,}\b/g;

  function markup(text, glossary) {
    var ranges = [];
    function add(re, cls, skipFirst) {
      re.lastIndex = 0; var m;
      while ((m = re.exec(text))) { if (skipFirst && m.index === 0) continue; ranges.push({ s: m.index, e: m.index + m[0].length, c: cls, w: m[0] }); }
    }
    glossary.forEach(function (g) {
      var re = new RegExp('\\b' + g.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:s|es|ed|ing)?\\b', 'gi'); add(re, 'vocab:' + g.word);
    });
    add(RE_NUM, 'a a-num'); add(RE_LINK, 'a a-link'); add(RE_NAME, 'a a-name', true);
    ranges.sort(function (a, b) { return a.s - b.s || (b.c.indexOf('vocab') === 0) - (a.c.indexOf('vocab') === 0); });
    var out = '', pos = 0;
    ranges.forEach(function (r) {
      if (r.s < pos) return;
      out += esc(text.slice(pos, r.s));
      if (r.c.indexOf('vocab:') === 0) out += '<button class="vocab' + (deckHas(r.c.slice(6)) ? '' : '') + '" data-w="' + esc(r.c.slice(6)) + '">' + esc(r.w) + '</button>';
      else out += '<span class="' + r.c + '">' + esc(r.w) + '</span>';
      pos = r.e;
    });
    return out + esc(text.slice(pos));
  }

  Views.passage = function (app, id) {
    return Backend.getPassage(id).then(function (p) {
      run = { p: p, id: p.id, attemptId: uid(), phase: 'pre', answers: {}, picked: {}, startedAt: 0, lastAt: 0, secsLeft: (p.minutes || 20) * 60, timerId: null, evFor: null };
      var level = scaffoldLevel();
      if (level >= 2 && p.glossary.some(function (g) { return g.preteach; })) { run.skipPre = true; }
      var hasPre = p.glossary.some(function (g) { return g.preteach; });
      if (!hasPre || run.skipPre) startReading(app); else preReading(app);
    });
  };

  function preReading(app) {
    var p = run.p, words = p.glossary.filter(function (g) { return g.preteach; });
    app.innerHTML = '<div class="wrap"><section class="passage-head reveal"><span class="eyebrow">Before you read</span><h1>' + ui('keywords') + '</h1><p class="lede">Look at each word. Guess first — then reveal. Guessing is how it sticks.</p></section>' +
      words.map(function (g, i) {
        return '<div class="card reveal" style="margin-bottom:14px" data-i="' + i + '"><span class="eyebrow">' + (i + 1) + ' / ' + words.length + '</span><h3 style="font-size:2rem;margin:8px 0 12px">' + esc(g.word) + '</h3><div class="guess"><input class="input" placeholder="' + esc(ui('guess')) + '" aria-label="Your guess"><div class="q-actions"><button class="btn small" data-act="rev">' + ui('reveal') + '</button></div></div><div class="slot"></div></div>';
      }).join('') +
      '<div class="row reveal" style="margin:30px 0 0"><button class="btn accent" id="goRead">' + ui('start') + ' →</button></div></div>';
    $$('.card[data-i]').forEach(function (card) {
      var g = words[+card.dataset.i];
      $('[data-act="rev"]', card).onclick = function () {
        var guessed = $('input', card).value.trim();
        $('.guess', card).hidden = true;
        $('.slot', card).innerHTML = '<div class="reveal-box">' + defLines(g) + '<div class="q-actions"><button class="btn small ghost" data-k="1">' + ui('iknew') + '</button><button class="btn small" data-k="0">' + ui('didnt') + '</button></div></div>';
        $$('.slot button', card).forEach(function (b) { b.onclick = function () { if (b.dataset.k === '0' || !guessed) addToDeck(g); b.parentNode.innerHTML = '<span class="chip ' + (b.dataset.k === '1' ? 'ok' : '') + '">' + (b.dataset.k === '1' ? '✓' : '＋ added to deck') + '</span>'; }; });
      };
    });
    $('#goRead').onclick = function () { startReading(app); };
  }
  function defLines(g) {
    return '<div class="def-line"><span class="eyebrow">Meaning</span><span>' + esc(g.def_en) + '</span></div><div class="def-line"><span class="eyebrow">Synonym</span><span>' + esc(g.synonym) + '</span></div>' +
      (S.lang !== 'en' ? '<div class="def-line"><span class="eyebrow">По-русски</span><span>' + esc(g.ru) + '</span></div>' : '');
  }

  function startReading(app) {
    var p = run.p, level = scaffoldLevel(), total = p.groups.reduce(function (n, g) { return n + g.questions.length; }, 0);
    run.total = total; run.phase = 'read'; run.startedAt = Date.now(); run.lastAt = Date.now();
    var ringC = 2 * Math.PI * 16;
    app.innerHTML =
      '<div class="readbar"><a class="icon-btn" href="#/" aria-label="Leave passage" style="text-decoration:none">←</a><span class="title">' + esc(p.title) + '</span>' +
      '<button class="toggle" id="anchorBtn" aria-pressed="' + anchorsOn() + '">' + ui('anchors') + '</button>' +
      '<button class="ring" id="ring" aria-label="Time remaining"><svg width="38" height="38" viewBox="0 0 38 38"><circle class="trk" cx="19" cy="19" r="16" fill="none" stroke-width="2"/><circle class="bar" cx="19" cy="19" r="16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="' + ringC + '" stroke-dashoffset="0"/></svg><span id="ringT">' + fmtDur(run.secsLeft) + '</span></button><div class="progress-line" id="pline"></div></div>' +
      '<div class="wrap"><section class="passage-head reveal"><span class="eyebrow">' + esc(p.level || '') + ' · Academic Reading</span><h1>' + esc(p.title) + '</h1><p class="lede">' + esc(p.subtitle || '') + '</p>' +
      (level >= 1 ? '<span class="chip gold">Scaffolding · ' + SCAF_NAME[level] + '</span>' : '') + '</section>' +
      '<div class="legend reveal"><span><i style="background:var(--hl-name)"></i>names</span><span><i style="background:var(--hl-num)"></i>numbers &amp; dates</span><span><i style="background:var(--hl-link)"></i>linking &amp; limiting words</span></div>' +
      '<article class="article ' + (anchorsOn() ? 'anchors-on' : '') + ' ' + (level >= 2 ? 'fade-vocab' : '') + '" id="article">' +
      p.paragraphs.map(function (para) {
        return '<p class="para reveal"><span class="plabel">' + esc(para.label) + '</span>' + para.sentences.map(function (s) { return '<span class="sent" id="s-' + esc(s.id) + '" data-sid="' + esc(s.id) + '">' + markup(s.text, p.glossary) + '</span>'; }).join(' ') + '</p>';
      }).join('') + '</article>' +
      p.groups.map(function (g) {
        return '<section class="qgroup reveal"><span class="eyebrow">' + esc(g.typeLabel || typeLabel(g.type)) + '</span><h2 style="margin-top:8px">' + esc(g.title) + '</h2><p class="instr">' + tx(g.instructions) + '</p>' +
          g.questions.map(function (q) { return questionHTML(g, q); }).join('') + '</section>';
      }).join('') +
      '<div class="row" style="margin:50px 0 0"><button class="btn accent" id="finishBtn">' + ui('finish') + '</button></div></div>' +
      '<div class="ev-banner" id="evBanner"><span>' + ui('tapEvidence') + '</span><button id="evSkip">' + ui('skip') + '</button></div>';

    wireReading(app);
    startTimer();
    observe(); window.scrollTo(0, 0);
  }

  function questionHTML(g, q) {
    var body;
    if (q.options) {
      var three = g.type === 'tfng' || g.type === 'ynng';
      body = '<div class="opts ' + (three ? 'three' : '') + '">' + q.options.map(function (o) { var val = (g.type === 'mcq') ? o.charAt(0) : o; return '<button class="opt" data-val="' + esc(val) + '" aria-pressed="false">' + esc(o) + '</button>'; }).join('') + '</div>';
    } else body = '<input class="input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Your answer" aria-label="Answer for question ' + q.n + '">';
    return '<div class="q" id="q-' + esc(q.id) + '" data-q="' + esc(q.id) + '" data-g="' + esc(g.id) + '"><span class="qn">' + q.n + '</span><p class="qtext">' + esc(q.prompt) + '</p>' + body + '<div class="q-actions"><button class="btn small" data-act="check" disabled>' + ui('check') + '</button></div><div class="coach-slot"></div></div>';
  }
  function findQ(qid) { var out; run.p.groups.forEach(function (g) { g.questions.forEach(function (q) { if (q.id === qid) out = { g: g, q: q }; }); }); return out; }

  function wireReading(app) {
    $('#anchorBtn').onclick = function () { S.anchors = !anchorsOn(); this.setAttribute('aria-pressed', String(S.anchors)); $('#article').classList.toggle('anchors-on', S.anchors); persistSoon(); };
    $('#ring').onclick = function () { this.classList.toggle('show'); };
    $('#evSkip').onclick = function () { endEvidence(null); };
    $('#finishBtn').onclick = finish;
    $('#article').addEventListener('click', function (e) {
      var v = e.target.closest('.vocab'); if (v) { vocabSheet(v.dataset.w); return; }
      if (run.evFor) { var s = e.target.closest('.sent'); if (s) endEvidence(s.dataset.sid); }
    });
    $$('.q').forEach(function (card) {
      var chk = $('[data-act="check"]', card), found = findQ(card.dataset.q);
      $$('.opt', card).forEach(function (b) { b.onclick = function () { $$('.opt', card).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); run.picked[found.q.id] = b.dataset.val; chk.disabled = false; }; });
      var inp = $('input.input', card);
      if (inp) { inp.oninput = function () { chk.disabled = !inp.value.trim(); }; inp.onkeydown = function (e) { if (e.key === 'Enter' && !chk.disabled) chk.click(); }; }
      chk.onclick = function () { submit(card, found); };
    });
  }

  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim(); }
  function isCorrect(g, q, val) {
    if (q.options) return val === q.answer;
    var ok = [q.answer].concat(q.accept || []).map(norm); return ok.indexOf(norm(val)) >= 0;
  }

  function submit(card, f) {
    var q = f.q, g = f.g, inp = $('input.input', card);
    var val = inp ? inp.value.trim() : run.picked[q.id];
    if (!val) return;
    var now = Date.now(), secs = Math.max(1, Math.round((now - run.lastAt) / 1000)); run.lastAt = now;
    var ok = isCorrect(g, q, val);
    var rec = { attemptId: run.attemptId, passageId: run.id, questionId: q.id, qtype: g.type, correct: ok, given: val, secs: secs, cause: null, evidence: null, wordsMattered: null, ts: now };
    run.answers[q.id] = rec; card.classList.add('done');
    $$('input,.opt,[data-act="check"]', card).forEach(function (x) { x.disabled = true; });
    if (q.options) $$('.opt', card).forEach(function (b) { if (b.dataset.val === q.answer) b.classList.add('right'); else if (b.dataset.val === val) b.classList.add('wrong'); });
    S.answers.push(rec); Backend.saveAnswer(rec).catch(function () { toast('Could not save — check connection'); });
    updateProgress();
    var slot = $('.coach-slot', card);
    slot.innerHTML = '<div class="coach ' + (ok ? '' : 'bad') + '"><div class="verdict"><span class="dot"></span><strong>' + (ok ? ui('correct') : ui('notquite')) + '</strong>' + (ok ? '' : '<span class="muted">· ' + ui('answerIs') + ': <b>' + esc(q.answer) + '</b></span>') + '</div>' +
      '<div class="evq"><div>' + ui('tapEvidence') + '</div><div class="row"><button class="btn small accent" data-ev="go">' + (S.lang === 'ru' ? 'Нажать на текст' : 'Tap in passage') + '</button><button class="btn small ghost" data-ev="skip">' + ui('skip') + '</button></div></div><div class="more"></div></div>';
    $('[data-ev="go"]', slot).onclick = function () { beginEvidence(q.id); };
    $('[data-ev="skip"]', slot).onclick = function () { run.evFor = q.id; endEvidence(null); };
  }

  function beginEvidence(qid) {
    run.evFor = qid; $('#article').classList.add('evidence-mode'); $('#evBanner').classList.add('on');
    $('#article').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function endEvidence(sid) {
    var qid = run.evFor; if (!qid) return; run.evFor = null;
    $('#article').classList.remove('evidence-mode'); $('#evBanner').classList.remove('on');
    var f = findQ(qid), rec = run.answers[qid];
    $$('.sent.ev, .sent.miss').forEach(function (s) { s.classList.remove('ev', 'miss'); });
    if (sid) { rec.evidence = sid === f.q.evidence ? 'hit' : 'miss'; if (rec.evidence === 'miss') $('#s-' + sid).classList.add('miss'); } else rec.evidence = 'skipped';
    $('#s-' + f.q.evidence).classList.add('ev');
    Backend.saveAnswer({ attemptId: rec.attemptId, questionId: qid, evidence: rec.evidence, evSid: sid || null, passageId: rec.passageId, qtype: rec.qtype, correct: rec.correct, ts: rec.ts }).catch(function () {});
    var card = $('#q-' + qid); card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showCoaching(card, f, rec, sid);
  }

  function evSentence(id) { var t = ''; run.p.paragraphs.forEach(function (pa) { pa.sentences.forEach(function (s) { if (s.id === id) t = s.text; }); }); return t; }

  function showCoaching(card, f, rec, tappedSid) {
    var q = f.q, level = scaffoldLevel(), slot = $('.coach .more', card);
    var evq = $('.evq', card); if (evq) evq.remove();
    var evNote = rec.evidence === 'hit' ? '<span class="chip ok">You found the evidence ✓</span>' : rec.evidence === 'miss' ? '<span class="chip bad">Different sentence — check the highlight</span>' : '';
    var wrongOpts = q.wrong || {}, keys = Object.keys(wrongOpts);
    var shown = !rec.correct && wrongOpts[rec.given] ? rec.given : null;
    var reasonsHTML = '';
    if (keys.length) {
      var items = keys.map(function (k) { return '<div class="rr"><b>' + esc(k === 'any' ? '' : k) + '</b>' + (k === 'any' ? '' : ' — ') + tx(wrongOpts[k]) + '</div>'; });
      if (level >= 1 && !(shown)) reasonsHTML = '<div class="reasons"><details><summary>' + ui('whyNot') + '</summary>' + items.join('') + '</details></div>';
      else reasonsHTML = '<h4 class="eyebrow">' + ui('whyNot') + '</h4><div class="reasons">' + items.join('') + '</div>';
    }
    slot.innerHTML = '<div>' + evNote + '</div>' +
      '<h4 class="eyebrow">Evidence</h4><blockquote class="evid">' + esc(evSentence(q.evidence)) + '</blockquote>' +
      (q.paraphrase ? '<h4 class="eyebrow">' + ui('paraphrase') + '</h4><div class="pair"><div>' + esc(q.paraphrase.question) + '</div><div class="sep">⇄</div><div>' + esc(q.paraphrase.passage) + '</div></div>' : '') +
      '<h4 class="eyebrow">' + ui('why') + '</h4><p>' + tx(q.explanation) + '</p>' + reasonsHTML +
      (rec.correct ? '' : '<h4 class="eyebrow">' + ui('cause') + '</h4><div class="tags" data-grp="cause"><button class="tag" data-v="notfind">' + ui('cNotFind') + '</button><button class="tag" data-v="misread">' + ui('cMisread') + '</button><button class="tag" data-v="time">' + ui('cTime') + '</button></div>') +
      '<h4 class="eyebrow">' + ui('matter') + '</h4><div class="tags" data-grp="words"><button class="tag" data-v="1">' + ui('wordsYes') + '</button><button class="tag" data-v="0">' + ui('wordsNo') + '</button></div>';
    $$('.tags', slot).forEach(function (grp) {
      $$('.tag', grp).forEach(function (b) {
        b.onclick = function () {
          $$('.tag', grp).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true');
          if (grp.dataset.grp === 'cause') rec.cause = b.dataset.v; else rec.wordsMattered = b.dataset.v === '1';
          var a = S.answers.find(function (x) { return x.attemptId === rec.attemptId && x.questionId === rec.questionId; }); if (a) { a.cause = rec.cause; a.wordsMattered = rec.wordsMattered; a.evidence = rec.evidence; }
          Backend.saveAnswer({ attemptId: rec.attemptId, questionId: rec.questionId, passageId: rec.passageId, qtype: rec.qtype, correct: rec.correct, ts: rec.ts, cause: rec.cause, wordsMattered: rec.wordsMattered, evidence: rec.evidence }).catch(function () {});
        };
      });
    });
  }

  function updateProgress() { var n = Object.keys(run.answers).length; var l = $('#pline'); if (l) l.style.width = pct(n, run.total) + '%'; }
  function startTimer() {
    var C = 2 * Math.PI * 16, full = (run.p.minutes || 20) * 60;
    run.timerId = setInterval(function () {
      run.secsLeft = Math.max(0, run.secsLeft - 1);
      var ring = $('#ring'); if (!ring) { clearInterval(run.timerId); return; }
      $('.bar', ring).style.strokeDashoffset = C * (1 - run.secsLeft / full);
      $('#ringT').textContent = fmtDur(run.secsLeft);
      ring.classList.toggle('late', run.secsLeft < 180);
    }, 1000);
  }

  /* ---- vocab: guess then reveal ---- */
  function vocabSheet(word) {
    var g = run.p.glossary.find(function (x) { return x.word.toLowerCase() === word.toLowerCase(); }); if (!g) return;
    var sh = $('#sheet'); sh.hidden = false;
    sh.innerHTML = '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="' + esc(g.word) + '"><span class="eyebrow">Word</span><h3>' + esc(g.word) + '</h3><div id="vg"><input class="input" id="vguess" placeholder="' + esc(ui('guess')) + '" aria-label="Your guess"><div class="q-actions"><button class="btn small" id="vrev">' + ui('reveal') + '</button><button class="btn small ghost" id="vclose">✕</button></div></div><div id="vout"></div></div>';
    var close = function () { sh.hidden = true; sh.innerHTML = ''; };
    sh.onclick = function (e) { if (e.target === sh) close(); };
    $('#vclose').onclick = close; $('#vguess').focus();
    $('#vrev').onclick = function () {
      var guessed = $('#vguess').value.trim();
      $('#vg').hidden = true;
      $('#vout').innerHTML = '<div class="reveal-box">' + defLines(g) + '<div class="q-actions"><button class="btn small ghost" data-k="1">' + ui('iknew') + '</button><button class="btn small" data-k="0">' + ui('didnt') + '</button></div></div>';
      $$('#vout button').forEach(function (b) { b.onclick = function () { if (b.dataset.k === '0' || !guessed) { addToDeck(g); toast(S.lang === 'ru' ? 'Добавлено в колоду' : 'Added to your review deck'); } close(); }; });
    };
  }

  /* ---- deck ---- */
  function deckHas(w) { return S.state.deck.some(function (d) { return d.word.toLowerCase() === w.toLowerCase(); }); }
  function addToDeck(g) {
    if (deckHas(g.word)) return;
    S.state.deck.push({ word: g.word, def_en: g.def_en, synonym: g.synonym, ru: g.ru, streak: 0, due: Date.now(), added: Date.now() });
    persist();
  }
  function dueCount() { var n = Date.now(); return S.state.deck.filter(function (d) { return d.due <= n; }).length; }

  /* ---- verdict ---- */
  function finish() {
    clearInterval(run.timerId);
    var recs = Object.keys(run.answers).map(function (k) { return run.answers[k]; });
    var score = recs.filter(function (r) { return r.correct; }).length, secs = Math.round((Date.now() - run.startedAt) / 1000);
    var st = computeStats(recs);
    var attempt = { id: run.attemptId, passageId: run.id, ts: Date.now(), score: score, total: run.total, secs: secs, byType: st.types.map(function (t) { return { type: t.type, n: t.n, right: t.right }; }) };
    S.state.attempts.push(attempt); persist();
    var step = nextStep(st, recs);
    var app = $('#app');
    app.innerHTML = '<div class="wrap"><section class="verdict-hero reveal"><span class="eyebrow">Verdict · ' + esc(run.p.title) + '</span><div class="row" style="gap:32px;margin-top:18px">' + bigRing(pct(score, run.total)) + '<div><div class="num-xl">' + score + '<small>/ ' + run.total + '</small></div><p class="muted" style="margin:6px 0 0">' + fmtDur(secs) + ' · ' + recs.length + ' answered</p></div></div></section>' +
      '<section class="block reveal"><span class="eyebrow">By question type</span>' + typeBars(st, true) + '</section>' +
      '<section class="next-step reveal"><span class="eyebrow">' + ui('nextStep') + '</span><p>' + esc(step) + '</p></section>' +
      '<div class="row" style="margin-top:34px"><a class="btn" href="#/">Back to practice</a><a class="btn ghost" href="#/review">Review deck (' + dueCount() + ' due)</a><a class="btn ghost" href="#/progress">Progress</a></div></div>';
    observe(); animateBars(); window.scrollTo(0, 0);
  }
  function nextStep(st, recs) {
    var wrong = recs.filter(function (r) { return !r.correct; });
    if (!wrong.length) return 'Perfect score. Next time, switch the anchors off and read it clean.';
    var c = { notfind: 0, misread: 0, time: 0 }, tagged = 0;
    wrong.forEach(function (r) { if (r.cause && c[r.cause] != null) { c[r.cause]++; tagged++; } });
    var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    if (tagged >= 2 && c[top] / tagged >= 0.5) {
      if (top === 'time') return 'Give each question 90 seconds. If you are still stuck at 90, guess and move on.';
      if (top === 'misread') return 'Before you look at the text, underline the limiting words in each statement: all, some, only, not, never.';
      return 'Find the name, number or date in the question first. Anchors lead you straight to the right sentence.';
    }
    var weak = st.types.slice().sort(function (a, b) { return a.acc - b.acc; })[0];
    var by = {
      tfng: 'Underline the key noun in each statement and find its sentence before deciding. Different meaning means False. No sentence at all means Not Given.',
      mcq: 'Cross out two options by finding a passage word that contradicts them, then choose between the rest.',
      completion: 'Check the word limit first, then copy the words exactly as they appear in the passage.'
    };
    return by[weak.type] || 'Redo your wrong answers and say out loud which sentence proves each one.';
  }

  /* ================= views: review ================= */
  Views.review = function (app) {
    var deck = S.state.deck, now = Date.now(), due = deck.filter(function (d) { return d.due <= now; });
    var queue = due.slice();
    app.innerHTML = '<div class="wrap"><section class="passage-head reveal"><span class="eyebrow">Spaced review</span><h1>' + (queue.length ? queue.length + ' to review' : 'All clear') + '</h1><p class="lede">Two correct answers and a word leaves the deck for good.</p></section><div id="deck"></div>' +
      '<p class="muted reveal" style="margin-top:30px">' + deck.length + ' words in deck</p></div>';
    var box = $('#deck');
    if (!deck.length) { box.innerHTML = '<div class="card reveal"><p class="lede" style="margin:0">Words you miss or mark “not quite” while reading land here.</p></div>'; return; }
    if (!queue.length) { box.innerHTML = '<div class="card reveal"><p class="lede" style="margin:0 0 16px">Nothing is due right now. Come back tomorrow.</p><button class="btn ghost" id="practiceAny">Practise anyway</button></div>'; $('#practiceAny').onclick = function () { queue = deck.slice(); next(); }; return; }
    next();
    function next() {
      if (!queue.length) { box.innerHTML = '<div class="card flash reveal in"><span class="eyebrow">Done</span><h2>Nicely done.</h2><a class="btn" href="#/">Back</a></div>'; persist(); return; }
      var w = queue[0];
      var pool = deck.filter(function (d) { return d.word !== w.word; }).slice(0, 3).map(function (d) { return d.def_en; });
      var extras = ['a type of formal agreement', 'something that happens very quickly', 'a feeling of strong disapproval', 'to make something easier to see'];
      while (pool.length < 3) pool.push(extras[pool.length]);
      var opts = pool.concat([w.def_en]).sort(function () { return Math.random() - .5; });
      box.innerHTML = '<div class="card flash"><span class="eyebrow">' + queue.length + ' left · streak ' + w.streak + '/2</span><h2>' + esc(w.word) + '</h2><div class="choices">' + opts.map(function (o) { return '<button class="opt" data-d="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div><div id="rv"></div></div>';
      $$('.opt', box).forEach(function (b) {
        b.onclick = function () {
          var ok = b.dataset.d === w.def_en;
          $$('.opt', box).forEach(function (x) { x.disabled = true; if (x.dataset.d === w.def_en) x.classList.add('right'); });
          if (!ok) b.classList.add('wrong');
          if (ok) { w.streak++; w.due = Date.now() + DAY * (w.streak === 1 ? 1 : 3); } else { w.streak = 0; w.due = Date.now(); }
          queue.shift();
          if (w.streak >= 2) { S.state.deck = S.state.deck.filter(function (d) { return d.word !== w.word; }); }
          else if (!ok) queue.push(w);
          $('#rv').innerHTML = '<div class="reveal-box">' + defLines(w) + '<div class="q-actions"><button class="btn small accent" id="nx">Next →</button>' + (w.streak >= 2 ? '<span class="chip ok">✓ mastered — left the deck</span>' : '') + '</div></div>';
          $('#nx').onclick = next; persist();
        };
      });
    }
  };

  /* ================= views: progress ================= */
  Views.progress = function (app) {
    var st = computeStats(S.answers), series = trendSeries(S.state.attempts), dir = trendDir(series);
    app.innerHTML = '<div class="wrap"><section class="passage-head reveal"><span class="eyebrow">Progress</span><h1>Your pattern</h1></section>' +
      '<div class="stat-grid reveal"><div class="stat"><span class="eyebrow">Overall</span><div class="num-xl">' + st.acc + '<small>%</small></div><p class="muted" style="margin:6px 0 0">' + st.right + ' of ' + st.total + '</p></div><div class="stat"><span class="eyebrow">Trend ' + trendArrow(dir) + '</span>' + sparkline(series) + '</div></div>' +
      '<section class="block reveal"><span class="eyebrow">By question type</span>' + typeBars(st, true) + '</section>' +
      '<section class="block reveal"><span class="eyebrow">Why answers went wrong</span><div class="stat-grid" style="margin-top:12px"><div class="stat"><div class="num-l">' + st.causes.notfind + '</div><span class="eyebrow">couldn’t find</span></div><div class="stat"><div class="num-l">' + st.causes.misread + '</div><span class="eyebrow">misread</span></div><div class="stat"><div class="num-l">' + st.causes.time + '</div><span class="eyebrow">ran out of time</span></div></div></section>' +
      '<section class="block reveal"><span class="eyebrow">Scaffolding</span><p class="lede">' + SCAF_NAME[scaffoldLevel()] + '. Support fades as your recent accuracy climbs: lighter at 75%, minimal at 85% over your last 20 answers.</p></section></div>';
  };

  /* ================= views: privacy ================= */
  Views.privacy = function (app) {
    var api = Backend.mode === 'api';
    app.innerHTML = '<div class="wrap"><section class="passage-head reveal"><span class="eyebrow">Privacy</span><h1>Short and plain</h1></section><div class="prose reveal">' +
      '<h3>What we keep</h3><p>' + (api ? 'Your name, email address, a salted password hash (never your password), and your practice results: which questions you answered, whether they were right, how long they took, and your review words.' : 'Nothing leaves your device. Your results are stored in this browser only.') + '</p>' +
      '<h3>What we don’t do</h3><p>No advertising, no trackers, no analytics, no selling or sharing data. Passages and explanations are written in advance — nothing you do is sent to an AI service.</p>' +
      (api ? '<h3>Who can see it</h3><p>You, and your teacher, who can see your results and last-active date to help you improve. Hosting is on Cloudflare.</p><h3>Your rights (UK GDPR)</h3><p>You can delete your account and all its data at any time from Account. For anything else — access, correction — ask your teacher.</p><h3>Cookies</h3><p>One strictly necessary, HttpOnly session cookie to keep you signed in.</p>' : '<h3>Delete it</h3><p>Clearing your results removes everything this app stored on this device.</p><button class="btn ghost" id="wipe">Clear my data on this device</button>') +
      '</div></div>';
    var w = $('#wipe'); if (w) w.onclick = function () { if (confirm('Delete all results and settings on this device?')) Backend.deleteAccount().then(function () { location.href = '#/'; location.reload(); }); };
  };

  /* ================= boot ================= */
  window.App = { $: $, $$: $$, esc: esc, tx: tx, ui: ui, S: S, Views: Views, ExtraViews: ExtraViews, computeStats: computeStats, trendSeries: trendSeries, trendDir: trendDir, trendArrow: trendArrow, sparkline: sparkline, typeBars: typeBars, typeLabel: typeLabel, fmtDate: fmtDate, fmtDur: fmtDur, pct: pct, toast: toast, route: route, observe: observe, animateBars: animateBars, bigRing: bigRing, loadAll: loadAll, renderNav: renderNav };

  function loadAll() {
    return Promise.all([Backend.getState(), Backend.getAnswers()]).then(function (r) { S.state = r[0]; S.answers = (r[1] || []).slice().sort(function (a, b) { return a.ts - b.ts; }); loadSettings(); });
  }
  function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('ielts.theme', t); } catch (e) {} }
  function boot() {
    $('#themeBtn').onclick = function () {
      var cur = document.documentElement.dataset.theme, dark = cur === 'dark' || (cur === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      applyTheme(dark ? 'light' : 'dark');
    };
    $('#langSeg').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; S.lang = b.dataset.lang; persist(); if (!run || run.phase !== 'read') route(); else { $$('#langSeg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); toast(S.lang.toUpperCase()); } };
    window.addEventListener('hashchange', route);
    // heartbeat: lets the teacher see "last online" to the minute (api mode only)
    if (Backend.mode === 'api') {
      var beat = function () { if (Backend.user && !document.hidden) Backend.ping(); };
      setInterval(beat, 60000);
      document.addEventListener('visibilitychange', beat);
    }
    Backend.init().then(function (u) { return u ? loadAll() : null; }).then(route).catch(function (e) {
      $('#app').innerHTML = '<div class="wrap" style="padding-top:80px"><h2>Can’t reach the server</h2><p class="muted">' + esc(e.message) + '</p></div>';
    });
  }
  boot();
})();
