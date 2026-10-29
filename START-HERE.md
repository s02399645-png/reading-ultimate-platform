# Start here (GitHub → Cloudflare, free, no terminal)

1. **GitHub:** create a new **private** repository and upload everything from this folder (Add file → Upload files).
2. **Cloudflare:** dash.cloudflare.com → **Workers & Pages → Create → Import a repository** → pick your repo.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (the default)
   - Click **Save and deploy**. The database is created automatically.
3. Open the new Worker → **Settings → Variables and secrets → Add**, then deploy again:
   - `INVITE_CODE` (Secret): what students type to join
   - `PASSWORD_PEPPER` (Secret): 40+ random characters
   - `TEACHER_EMAIL` (Text): your email, in lowercase
4. Open your address (`https://marginalia.<you>.workers.dev`), **Join** with that email and the invite code. You are the teacher.
5. Send students the address and the invite code.

Every change you push to GitHub redeploys automatically.
If sign-in errors with "Exceeded CPU", lower `PBKDF2_ITERATIONS` to `10000` under Variables.
