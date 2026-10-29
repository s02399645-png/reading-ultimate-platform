# FREE version (recommended): no domain, no card

Everything runs on Cloudflare's free plan: one Worker serves the website **and** the API at `https://marginalia.YOURNAME.workers.dev`. Free limits (100,000 requests/day, 5 GB database) are far above what 4 students need.

```bash
npm install
npx wrangler login                                   # free account, no card
npx wrangler d1 create marginalia                    # copy database_id into worker/wrangler.free.toml
cd worker
npx wrangler d1 execute marginalia --remote --file=schema.sql
npx wrangler secret put INVITE_CODE                  # you must deploy once first if it says the Worker doesn't exist: run step below, then repeat
npx wrangler secret put PASSWORD_PEPPER              # openssl rand -base64 48
cd ..
npm run deploy:free                                  # prints your https://marginalia.xxx.workers.dev address
```

If `secret put` complains that the Worker does not exist, run `npm run deploy:free` first, then set both secrets, then deploy once more.
Then follow section 6 (make yourself teacher; add `--remote`) and share the address with students.

Free-plan note: Workers allow about 10 ms of CPU per request. If sign-in shows an "Exceeded CPU" error, uncomment `PBKDF2_ITERATIONS = "20000"` in `wrangler.free.toml` and redeploy; the secret pepper keeps passwords safe.

The paid-style setup below (Pages + custom domain) is optional.

---

# Deploying Marginalia to Cloudflare

Architecture: **Cloudflare Pages** serves the static site, a **Worker** serves `/api/*` on the **same domain**, and **D1** holds the data. Same domain means the session cookie is first-party and can be `SameSite=Strict`.

You need: a Cloudflare account, a domain on Cloudflare (a cheap one is fine), Node 20+.

## 1. One-time setup

```bash
cd ielts-reader
npm install
npx wrangler login
```

## 2. Create the database

```bash
npx wrangler d1 create marginalia
```

Copy the `database_id` it prints into `worker/wrangler.toml`. In the same file replace every `YOURDOMAIN.com` with your domain.

Create the tables:

```bash
cd worker
npx wrangler d1 execute marginalia --remote --file=schema.sql
cd ..
```

## 3. Set the two secrets

```bash
cd worker
npx wrangler secret put INVITE_CODE        # what students type to join, e.g. a 3-word phrase
npx wrangler secret put PASSWORD_PEPPER    # 40+ random characters; generate with: openssl rand -base64 48
cd ..
```

Keep a copy of `PASSWORD_PEPPER` in your password manager. If it is lost or changed, every password stops working and must be reset.

## 4. Deploy the API

```bash
npm run deploy:api
```

This bundles the passages from `worker/passages/` into the Worker (they are never static files) and publishes it on `YOURDOMAIN.com/api/*`.

## 5. Deploy the site

```bash
npx wrangler pages project create marginalia --production-branch main   # first time only
npm run deploy:site
```

`deploy:site` builds `dist/` **without** the `data/` folder (the sample passages used for offline mode) and switches the app to API mode.

In the Cloudflare dashboard: **Workers & Pages → marginalia → Custom domains → add `YOURDOMAIN.com`**.

Check that the Worker route wins for `/api`:

```bash
curl -i https://YOURDOMAIN.com/api/me        # expect 401 JSON, not an HTML page
curl -i https://YOURDOMAIN.com/data/passage-001.json   # expect 404
```

## 6. Create the teacher account

1. Open the site, go to **Join**, and sign up yourself with the invite code.
2. Promote your account (once, from your terminal):

```bash
cd worker
npx wrangler d1 execute marginalia --remote --command "UPDATE users SET role='teacher' WHERE email='you@example.com'"
```

3. Sign out and in again. A **Teacher** tab appears. Students sign up with the same invite code.

## 7. Add more passages

1. Copy `worker/passages/passage-001.json`, change the content and set a new `id` that matches the filename (e.g. `passage-002`).
2. Run `npm run passages` — it checks that every `evidence` id exists, each answer is among its options, and each question has EN and RU explanations.
3. `npm run deploy:api`.

## 8. Local development

```bash
cp worker/.dev.vars.example worker/.dev.vars
npm run build
npm run db:local
npm run dev            # http://localhost:8787 — site and API on one origin
```

To try the student app with no server at all (stage 1, data in browser only): `cd web && python3 -m http.server 8000`.

## 9. Rotating the headline messages

Edit the `HERO` array near the top of `web/app.js` (10 EN/RU pairs). Tapping the headline moves to the next one and flips the language; it also changes by itself every 3 minutes.

---

# Security checklist

Tick these before sharing the invite code.

**Secrets and access**
- [ ] `INVITE_CODE` and `PASSWORD_PEPPER` set with `wrangler secret put` (not in `wrangler.toml`, not in git).
- [ ] `.dev.vars` is git-ignored and uses a different pepper from production.
- [ ] Cloudflare account has 2FA on, and only you can deploy.
- [ ] After all students have joined, change the invite code (`wrangler secret put INVITE_CODE`) so a leaked code is useless.

**Passwords and sessions**
- [ ] Passwords stored as PBKDF2-SHA256 (100,000 iterations, the Workers maximum) with a per-user salt, plus an HMAC pepper from the secret. Plaintext is never stored or logged.
- [ ] Session cookie is `__Host-session; HttpOnly; Secure; SameSite=Strict; Path=/`. Only a SHA-256 of the token is in D1.
- [ ] Login: 5 failures per account+IP and 30 per IP in 15 minutes, then 429. Signup: 8 per IP per hour.
- [ ] Teacher password reset signs the student out everywhere.

**Server-side checks**
- [ ] Every `/api/teacher/*` route checks `role = 'teacher'` from the database row. Test it: while signed in as a student, `GET /api/teacher/students` must return 403.
- [ ] `correct` is graded by the Worker from the stored answer key; the browser cannot fake accuracy.
- [ ] State-changing requests require header `X-Requested-With: marginalia` and a matching `Origin` (`ALLOWED_ORIGIN` in `wrangler.toml` must be your real domain).
- [ ] All SQL uses bound parameters.

**Content**
- [ ] `https://YOURDOMAIN.com/data/passage-001.json` returns 404 and `GET /api/passages` returns 401 when signed out.
- [ ] Note: signed-in students receive each passage's answer key (needed for instant coaching). That is acceptable for a small trusted group, not for an exam.

**Browser hardening** (`web/_headers`)
- [ ] CSP forbids inline scripts, framing and third-party connections; HSTS, nosniff, no-referrer, `noindex` set.
- [ ] Look at the response headers of the live site once: `curl -I https://YOURDOMAIN.com`.

**Optional extras (recommended)**
- [ ] Cloudflare **Access** (free for up to 50 users) in front of the whole site for a second gate.
- [ ] A WAF rate-limiting rule on `/api/login` and `/api/signup`.
- [ ] **Self-host the fonts.** The site loads Fraunces, Inter and Newsreader from Google Fonts, which sends visitors' IP addresses to Google. For UK GDPR the cleaner option is to install `@fontsource-variable/fraunces`, `@fontsource-variable/inter` and `@fontsource/newsreader`, copy the `.woff2` files into `web/fonts/`, add `@font-face` rules, and remove the Google URLs from `index.html` and `_headers`.
- [ ] D1 Time Travel gives point-in-time restore (30 days). To export: `wrangler d1 export marginalia --remote --output=backup.sql`.

---

# Privacy and UK GDPR notes

What the app collects: name, email, a password hash, and practice results (answers, timings, review words). No analytics, ads, or third-party scripts apart from the fonts above. The in-app privacy page says this in plain language.

- **Delete my account**: Account → Delete everything (password required) removes the user, answers, deck and sessions.
- **Access and correction**: the teacher can see and, if asked, fix or export a student's data directly in D1.
- **Cookies**: one strictly necessary session cookie, so no consent banner is needed.
- **If any students are under 18**, keep the data minimal as you have, tell them and (if under 13) their parents what is stored, and consider whether you need parental consent.
- **Registration**: check whether you need to register with the ICO as a data controller for tutoring; this is a legal question I can't settle for you.
