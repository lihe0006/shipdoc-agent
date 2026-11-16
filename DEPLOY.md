# Hosting the POC for other people (Render)

This puts the app on one always-on server with a shared password. People only
need the link and the password: no install and no API key of their own. All
usage is billed to your Anthropic key.

## 1. Put the code on GitHub

Create an empty **private** repository on GitHub (no README), then from this folder:

```bash
git remote add origin https://github.com/<you>/shipdoc-agent.git
git push -u origin main
```

`.env.local` (your key) and `.data/` (uploads) are git-ignored and never pushed.

## 2. Create the service on Render

1. Sign in at https://render.com (GitHub sign-in is easiest).
2. **New → Blueprint**, pick the `shipdoc-agent` repo. Render reads `render.yaml`.
3. It asks for two values:
   - `ANTHROPIC_API_KEY` — your key from https://platform.claude.com/settings/keys
     (a separate key just for this demo makes it easy to revoke later).
   - `APP_PASSWORD` — the password you will share with people.
   `AUTH_SECRET` is generated for you.
4. **Apply**. The first build takes 3–5 minutes. You get a URL like
   `https://shipdoc-agent.onrender.com`.

Plan: `render.yaml` uses **Starter** (always on, small monthly fee). To try it
for free, change `plan: starter` to `plan: free`. The free server sleeps after
15 idle minutes, so the first visit then takes about a minute.

## 3. Share it

Send the URL and the password separately (e.g. URL by email, password by chat).

## 4. Keep costs in check

- Set a monthly spend limit in the Claude Console: **Settings → Limits**.
- Watch usage in **Usage**. One shipment check reads every page of every PDF,
  so scanned multi-page documents cost the most.
- To cut someone off, change `APP_PASSWORD` in Render (**Environment**) and
  change `AUTH_SECRET` too, which signs everyone out.

## Things to know

- **Results are temporary.** Chats and results pages are kept in server memory
  and disappear when the server restarts or redeploys. Export to Excel/PDF to keep them.
- **One server only.** Don't scale to more than one instance. Sessions live in
  memory, so a second instance would not see them.
- **Uploaded documents** are stored on the server's disk until the next deploy.
  Only upload documents the client has cleared for this demo.
- **Updating:** push to `main` on GitHub and Render redeploys automatically.

## Other hosts

Any host that runs a normal Node server works the same way (Railway, Fly.io, a
VM): build with `npm ci && npm run build`, start with `npm start`, and set the
three environment variables. Serverless platforms (Netlify, Vercel functions)
need code changes because a check runs for several minutes.
