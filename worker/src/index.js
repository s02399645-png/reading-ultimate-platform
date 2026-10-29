// Marginalia API — Cloudflare Worker + D1.
// Every route except /signup, /login and /me requires a valid session; /teacher/* also requires role = teacher,
// checked on the server from the database row, never from anything the browser sends.
import { PASSAGES } from './passages.generated.js';
import { SCHEMA } from './schema.js';
import { hashPassword, verifyPassword, newToken, sha256Hex, timingSafeEqual, tempPassword } from './crypto.js';

const SESSION_DAYS = 30;
const COOKIE = '__Host-session';
const DAY = 86400000;
// Free Workers plans allow ~10 ms CPU per request. If logins fail with error 1102, set PBKDF2_ITERATIONS lower (e.g. 20000).
const iters = (env) => Math.min(100000, Math.max(10000, parseInt(env.PBKDF2_ITERATIONS, 10) || 100000));
const CAUSES = new Set(['notfind', 'misread', 'time']);

class HttpError extends Error { constructor(status, message, headers) { super(message); this.status = status; this.headers = headers; } }
const fail = (status, message, headers) => { throw new HttpError(status, message, headers); };

/* ---------------- plumbing ---------------- */
const baseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...baseHeaders, ...extra } });

function cookies(request) {
  const out = {};
  (request.headers.get('Cookie') || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
const setCookie = (token, maxAgeSec) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Strict`;

async function readJson(request, limit = 200_000) {
  const len = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (len > limit) fail(413, 'Request too large');
  const text = await request.text();
  if (text.length > limit) fail(413, 'Request too large');
  try { return text ? JSON.parse(text) : {}; } catch { fail(400, 'Invalid JSON'); }
}

// CSRF: SameSite=Strict cookie + custom header + Origin check on every state-changing request.
function checkCsrf(request, env) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('X-Requested-With') !== 'marginalia') fail(403, 'Bad request');
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  if (origin && origin !== allowed) fail(403, 'Bad origin');
}

/* ---------------- rate limiting (D1) ---------------- */
async function rateCheck(env, key, limit, windowMs) {
  const row = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first();
  if (row && Date.now() - row.window_start < windowMs && row.count >= limit) {
    const wait = Math.ceil((row.window_start + windowMs - Date.now()) / 1000);
    fail(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`, { 'Retry-After': String(wait) });
  }
}
async function rateHit(env, key, windowMs) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`
  ).bind(key, now, windowMs).run();
}
const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';

/* ---------------- sessions ---------------- */
async function createSession(env, userId) {
  const token = newToken(), now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * DAY).run();
  return token;
}
async function authenticate(request, env) {
  const token = cookies(request)[COOKIE];
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).bind(hash).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run(); return null; }
  if (!row.last_seen_at || Date.now() - row.last_seen_at > 60 * 1000) {
    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, tokenHash: hash };
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const requireUser = (u) => { if (!u) fail(401, 'Please sign in'); return u; };
const requireTeacher = (u) => { requireUser(u); if (u.role !== 'teacher') fail(403, 'Teachers only'); return u; };

/* ---------------- validation ---------------- */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
function validPassword(p) {
  if (typeof p !== 'string' || p.length < 10) fail(400, 'Password must be at least 10 characters');
  if (p.length > 200) fail(400, 'Password is too long');
}
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/* ---------------- passage index (answers live only on the server side of the DB logic) ---------------- */
const qCache = {};
function qIndex(pid) {
  if (qCache[pid]) return qCache[pid];
  const p = PASSAGES[pid]; if (!p) return null;
  const idx = {};
  for (const g of p.groups) for (const q of g.questions) idx[q.id] = { ...q, type: g.type };
  return (qCache[pid] = idx);
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
function gradeAnswer(q, given) {
  if (q.options) return given === q.answer;
  return [q.answer, ...(q.accept || [])].map(norm).includes(norm(given));
}

/* ---------------- stats helpers (shared by teacher endpoints) ---------------- */
function trendDir(series) {
  if (series.length < 2) return 'flat';
  const half = Math.ceil(series.length / 2), avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const d = avg(series.slice(-half)) - avg(series.slice(0, series.length - half));
  return d > 4 ? 'up' : d < -4 ? 'down' : 'flat';
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) schemaReady = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}
// The teacher is whoever signs up (or signs in) with the email stored in the TEACHER_EMAIL variable.
const isTeacherEmail = (env, email) => !!env.TEACHER_EMAIL && email === String(env.TEACHER_EMAIL).trim().toLowerCase();

/* ---------------- handlers ---------------- */
async function signup(request, env) {
  const ip = clientIp(request);
  await rateCheck(env, `signup:${ip}`, 8, 60 * 60 * 1000);
  await rateHit(env, `signup:${ip}`, 60 * 60 * 1000);
  const b = await readJson(request);
  const name = cleanText(b.name, 60), email = cleanText(b.email, 254).toLowerCase();
  if (!name) fail(400, 'Please enter your name');
  if (!EMAIL_RE.test(email)) fail(400, 'Please enter a valid email');
  validPassword(b.password);
  if (!env.INVITE_CODE) fail(500, 'Server is not configured');
  const a = await sha256Hex(String(b.invite || '').trim()), c = await sha256Hex(env.INVITE_CODE);
  if (!timingSafeEqual(a, c)) fail(403, 'That invite code is not right');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) fail(409, 'An account with this email already exists');
  const id = crypto.randomUUID(), now = Date.now();
  const hash = await hashPassword(b.password, env.PASSWORD_PEPPER, iters(env));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, name, email, pw_hash, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, name, email, hash, isTeacherEmail(env, email) ? 'teacher' : 'student', now, now),
    env.DB.prepare('INSERT INTO user_state (user_id, updated_at) VALUES (?, ?)').bind(id, now)
  ]);
  const token = await createSession(env, id);
  return json({ user: { id, name, email, role: isTeacherEmail(env, email) ? 'teacher' : 'student' } }, 201, { 'Set-Cookie': setCookie(token, SESSION_DAYS * 86400) });
}

// A real-looking hash so unknown emails cost the same time as known ones (no user enumeration by timing).
let DUMMY;
async function login(request, env) {
  const ip = clientIp(request), b = await readJson(request);
  const email = cleanText(b.email, 254).toLowerCase(), password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const acctKey = `login:acct:${await sha256Hex(email)}:${ip}`, ipKey = `login:ip:${ip}`, W = 15 * 60 * 1000;
  await rateCheck(env, acctKey, 5, W);
  await rateCheck(env, ipKey, 30, W);
  const user = await env.DB.prepare('SELECT id, name, email, role, pw_hash FROM users WHERE email = ?').bind(email).first();
  if (!DUMMY) DUMMY = await hashPassword('dummy-password-for-timing', env.PASSWORD_PEPPER, iters(env));
  const ok = await verifyPassword(password, user ? user.pw_hash : DUMMY, env.PASSWORD_PEPPER);
  if (!user || !ok) {
    await rateHit(env, acctKey, W); await rateHit(env, ipKey, W);
    fail(401, 'Incorrect email or password');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(acctKey).run();
  if (Math.random() < 0.05) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
      env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ?').bind(Date.now() - DAY)
    ]);
  }
  if (isTeacherEmail(env, email) && user.role !== 'teacher') { await env.DB.prepare("UPDATE users SET role = 'teacher' WHERE id = ?").bind(user.id).run(); user.role = 'teacher'; }
  const token = await createSession(env, user.id);
  await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': setCookie(token, SESSION_DAYS * 86400) });
}

async function logout(request, env, me) {
  if (me) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.tokenHash).run();
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) });
}

async function deleteMe(request, env, me) {
  const b = await readJson(request);
  const row = await env.DB.prepare('SELECT pw_hash FROM users WHERE id = ?').bind(me.id).first();
  await rateCheck(env, `del:${me.id}`, 5, 15 * 60 * 1000);
  if (!(await verifyPassword(String(b.password || ''), row.pw_hash, env.PASSWORD_PEPPER))) { await rateHit(env, `del:${me.id}`, 15 * 60 * 1000); fail(403, 'Password is not correct'); }
  if (me.role === 'teacher') fail(400, 'The teacher account cannot be deleted from the app');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM user_state WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) });
}

async function changePassword(request, env, me) {
  const b = await readJson(request);
  await rateCheck(env, `pw:${me.id}`, 5, 15 * 60 * 1000);
  const row = await env.DB.prepare('SELECT pw_hash FROM users WHERE id = ?').bind(me.id).first();
  if (!(await verifyPassword(String(b.current || ''), row.pw_hash, env.PASSWORD_PEPPER))) { await rateHit(env, `pw:${me.id}`, 15 * 60 * 1000); fail(403, 'Current password is not correct'); }
  validPassword(b.next);
  const hash = await hashPassword(b.next, env.PASSWORD_PEPPER, iters(env));
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').bind(hash, me.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(me.id, me.tokenHash)
  ]);
  return json({ ok: true });
}

/* ---- passages ---- */
function listPassages() {
  return Object.values(PASSAGES).map((p) => ({ id: p.id, title: p.title, subtitle: p.subtitle, level: p.level, minutes: p.minutes, questions: p.groups.reduce((n, g) => n + g.questions.length, 0) }));
}

/* ---- answers ---- */
async function saveAnswer(request, env, me) {
  const b = await readJson(request, 20_000);
  const passageId = cleanText(b.passageId, 60), attemptId = cleanText(b.attemptId, 40), qid = cleanText(b.questionId, 40);
  const idx = qIndex(passageId); if (!idx || !idx[qid]) fail(400, 'Unknown question');
  if (!attemptId) fail(400, 'Missing attempt');
  const q = idx[qid];
  const existing = await env.DB.prepare('SELECT id, evidence FROM answers WHERE user_id = ? AND attempt_id = ? AND question_id = ?').bind(me.id, attemptId, qid).first();

  let evidence = null;
  if (b.evSid) evidence = b.evSid === q.evidence ? 'hit' : 'miss';
  else if (b.evidence === 'skipped') evidence = 'skipped';
  const cause = CAUSES.has(b.cause) ? b.cause : null;
  const words = b.wordsMattered === true ? 1 : b.wordsMattered === false ? 0 : null;

  if (!existing) {
    const given = cleanText(b.given, 200); if (!given) fail(400, 'Missing answer');
    const secs = Math.min(3600, Math.max(0, Math.round(Number(b.secs) || 0)));
    const ts = Math.min(Date.now(), Math.max(Date.now() - DAY, Number(b.ts) || Date.now()));
    await env.DB.prepare(
      `INSERT INTO answers (user_id, passage_id, attempt_id, question_id, qtype, correct, given, secs, cause, evidence, words_mattered, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(me.id, passageId, attemptId, qid, q.type, gradeAnswer(q, given) ? 1 : 0, given, secs, cause, evidence, words, ts).run();
  } else {
    // Later coaching steps only fill in cause / evidence / words-mattered. "correct" is never changed.
    await env.DB.prepare(
      `UPDATE answers SET cause = COALESCE(?, cause), evidence = COALESCE(?, evidence), words_mattered = COALESCE(?, words_mattered) WHERE id = ?`
    ).bind(cause, evidence, words, existing.id).run();
  }
  return json({ ok: true });
}

async function myAnswers(env, me) {
  const { results } = await env.DB.prepare(
    `SELECT passage_id AS passageId, attempt_id AS attemptId, question_id AS questionId, qtype, correct, secs, cause, evidence, words_mattered AS wordsMattered, ts
     FROM answers WHERE user_id = ? ORDER BY ts ASC LIMIT 5000`
  ).bind(me.id).all();
  return json(results.map((r) => ({ ...r, correct: !!r.correct, wordsMattered: r.wordsMattered == null ? null : !!r.wordsMattered })));
}

/* ---- state (deck, settings, attempt summaries) ---- */
async function getState(env, me) {
  const row = await env.DB.prepare('SELECT deck, settings, attempts FROM user_state WHERE user_id = ?').bind(me.id).first();
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  return json({ deck: parse(row?.deck, []), settings: parse(row?.settings, {}), attempts: parse(row?.attempts, []) });
}
async function putState(request, env, me) {
  const b = await readJson(request, 150_000);
  const s = (v, n) => cleanText(v, n);
  const deck = (Array.isArray(b.deck) ? b.deck : []).slice(0, 500).map((d) => ({
    word: s(d.word, 60), def_en: s(d.def_en, 240), synonym: s(d.synonym, 60), ru: s(d.ru, 120),
    streak: Math.min(2, Math.max(0, parseInt(d.streak, 10) || 0)), due: Number(d.due) || Date.now(), added: Number(d.added) || Date.now()
  })).filter((d) => d.word);
  const attempts = (Array.isArray(b.attempts) ? b.attempts : []).slice(-300).map((a) => ({
    id: s(a.id, 40), passageId: s(a.passageId, 60), ts: Number(a.ts) || 0, score: parseInt(a.score, 10) || 0, total: parseInt(a.total, 10) || 0, secs: parseInt(a.secs, 10) || 0,
    byType: (Array.isArray(a.byType) ? a.byType : []).slice(0, 12).map((t) => ({ type: s(t.type, 24), n: parseInt(t.n, 10) || 0, right: parseInt(t.right, 10) || 0 }))
  }));
  const st = b.settings && typeof b.settings === 'object' ? b.settings : {};
  const settings = { lang: ['en', 'ru', 'both'].includes(st.lang) ? st.lang : 'both', anchors: typeof st.anchors === 'boolean' ? st.anchors : null };
  await env.DB.prepare(
    `INSERT INTO user_state (user_id, deck, settings, attempts, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET deck = ?2, settings = ?3, attempts = ?4, updated_at = ?5`
  ).bind(me.id, JSON.stringify(deck), JSON.stringify(settings), JSON.stringify(attempts), Date.now()).run();
  return json({ ok: true });
}

/* ---- teacher ---- */
async function teacherStudents(env) {
  const [students, attempts, decks] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.created_at AS createdAt, u.last_seen_at AS lastSeen, COUNT(a.id) AS n, COALESCE(SUM(a.correct), 0) AS right, MAX(a.ts) AS lastAnswer
       FROM users u LEFT JOIN answers a ON a.user_id = u.id WHERE u.role = 'student' GROUP BY u.id ORDER BY u.name COLLATE NOCASE`
    ).all(),
    env.DB.prepare(`SELECT user_id, attempt_id, MIN(ts) AS t, COUNT(*) AS n, SUM(correct) AS c FROM answers GROUP BY user_id, attempt_id ORDER BY t`).all(),
    env.DB.prepare(`SELECT user_id, deck FROM user_state`).all()
  ]);
  const series = {}; attempts.results.forEach((r) => { (series[r.user_id] ||= []).push(pct(r.c, r.n)); });
  const deckSize = {}; decks.results.forEach((r) => { try { deckSize[r.user_id] = JSON.parse(r.deck).length; } catch { deckSize[r.user_id] = 0; } });
  const inactiveMs = (parseInt(env.INACTIVE_DAYS, 10) || 5) * DAY;
  return json(students.results.map((s) => {
    const last = Math.max(s.lastAnswer || 0, s.lastSeen || 0) || null;
    const sr = (series[s.id] || []).slice(-12);
    return { id: s.id, name: s.name, email: s.email, createdAt: s.createdAt, lastActive: last, answered: s.n, accuracy: pct(s.right, s.n), trend: trendDir(sr), series: sr, deckSize: deckSize[s.id] || 0, inactive: !last || Date.now() - last > inactiveMs };
  }));
}

async function teacherStudent(env, id) {
  const u = await env.DB.prepare(`SELECT id, name, email, created_at AS createdAt, last_seen_at AS lastSeen FROM users WHERE id = ? AND role = 'student'`).bind(id).first();
  if (!u) fail(404, 'Student not found');
  const [types, wrong, attempts, st, causes] = await Promise.all([
    env.DB.prepare(`SELECT qtype AS type, COUNT(*) AS n, SUM(correct) AS right, SUM(secs) AS secs, SUM(CASE WHEN evidence IN ('hit','miss') THEN 1 ELSE 0 END) AS evN, SUM(CASE WHEN evidence = 'hit' THEN 1 ELSE 0 END) AS evHit FROM answers WHERE user_id = ? GROUP BY qtype`).bind(id).all(),
    env.DB.prepare(`SELECT passage_id AS passageId, question_id AS questionId, qtype, given, secs, cause, evidence, ts FROM answers WHERE user_id = ? AND correct = 0 ORDER BY ts DESC LIMIT 100`).bind(id).all(),
    env.DB.prepare(`SELECT attempt_id, passage_id, MIN(ts) AS t, COUNT(*) AS n, SUM(correct) AS c, SUM(secs) AS secs FROM answers WHERE user_id = ? GROUP BY attempt_id ORDER BY t`).bind(id).all(),
    env.DB.prepare(`SELECT deck FROM user_state WHERE user_id = ?`).bind(id).first(),
    env.DB.prepare(`SELECT cause, COUNT(*) AS n FROM answers WHERE user_id = ? AND correct = 0 AND cause IS NOT NULL GROUP BY cause`).bind(id).all()
  ]);
  const byType = types.results.map((t) => ({ type: t.type, n: t.n, right: t.right, accuracy: pct(t.right, t.n), avgSecs: t.n ? Math.round(t.secs / t.n) : 0, totalSecs: t.secs, evidenceTapped: t.evN, evidenceHit: t.evHit }));
  const weak = byType.filter((t) => t.n >= 2).sort((a, b) => a.accuracy - b.accuracy)[0] || null;
  let deckSize = 0; try { deckSize = JSON.parse(st?.deck || '[]').length; } catch {}
  const wrongList = wrong.results.map((w) => { const q = qIndex(w.passageId)?.[w.questionId]; return { ...w, passageTitle: PASSAGES[w.passageId]?.title || w.passageId, number: q?.n, prompt: q?.prompt, answer: q?.answer }; });
  const series = attempts.results.map((a) => ({ ts: a.t, passageId: a.passage_id, accuracy: pct(a.c, a.n), n: a.n, secs: a.secs }));
  const total = byType.reduce((n, t) => n + t.n, 0), right = byType.reduce((n, t) => n + t.right, 0);
  const last = Math.max(u.lastSeen || 0, ...wrong.results.map((w) => w.ts), ...series.map((s) => s.ts)) || null;
  return json({
    student: { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, lastActive: last },
    overall: { answered: total, right, accuracy: pct(right, total), trend: trendDir(series.slice(-12).map((s) => s.accuracy)), series: series.slice(-12).map((s) => s.accuracy) },
    byType, weakness: weak, deckSize, causes: Object.fromEntries(causes.results.map((c) => [c.cause, c.n])), wrong: wrongList, attempts: series
  });
}

async function teacherReset(request, env, id) {
  const b = await readJson(request, 2000);
  const target = await env.DB.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'student'`).bind(id).first();
  if (!target) fail(404, 'Student not found');
  let pw = b.password; let generated = false;
  if (pw === undefined || pw === null || pw === '') { pw = tempPassword(12); generated = true; } else validPassword(pw);
  const hash = await hashPassword(pw, env.PASSWORD_PEPPER, iters(env));
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').bind(hash, id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)
  ]);
  return json({ ok: true, name: target.name, password: generated ? pw : undefined });
}

/* ---------------- router ---------------- */
async function handle(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
  const path = url.pathname.slice(4).replace(/\/+$/, '') || '/', m = request.method;
  checkCsrf(request, env);
  if (!env.PASSWORD_PEPPER) fail(500, 'Server is not configured');
  await ensureSchema(env);

  if (path === '/signup' && m === 'POST') return signup(request, env);
  if (path === '/login' && m === 'POST') return login(request, env);

  const me = await authenticate(request, env);
  if (path === '/logout' && m === 'POST') return logout(request, env, me);
  if (path === '/me' && m === 'GET') return me ? json({ user: publicUser(me) }) : json({ error: 'Not signed in' }, 401);

  requireUser(me);
  if (path === '/me' && m === 'DELETE') return deleteMe(request, env, me);
  if (path === '/me/password' && m === 'POST') return changePassword(request, env, me);
  if (path === '/passages' && m === 'GET') return json(listPassages());
  let r;
  if ((r = path.match(/^\/passages\/([a-z0-9-]{1,60})$/i)) && m === 'GET') { const p = PASSAGES[r[1]]; return p ? json(p) : json({ error: 'Not found' }, 404); }
  if (path === '/answers' && m === 'POST') return saveAnswer(request, env, me);
  if (path === '/answers' && m === 'GET') return myAnswers(env, me);
  if (path === '/state' && m === 'GET') return getState(env, me);
  if (path === '/state' && m === 'PUT') return putState(request, env, me);

  if (path.startsWith('/teacher')) {
    requireTeacher(me);
    if (path === '/teacher/students' && m === 'GET') return teacherStudents(env);
    if ((r = path.match(/^\/teacher\/students\/([0-9a-f-]{36})$/)) && m === 'GET') return teacherStudent(env, r[1]);
    if ((r = path.match(/^\/teacher\/students\/([0-9a-f-]{36})\/password$/)) && m === 'POST') return teacherReset(request, env, r[1]);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.headers || {});
      console.error('Unhandled', e && e.stack || e);
      return json({ error: 'Something went wrong' }, 500);
    }
  }
};
