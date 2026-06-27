# Outpost Admin UI

A React dashboard for the Outpost control plane. **React + Vite + TypeScript**,
data layer with **TanStack Query**, routing with **TanStack Router**. Auth is a
short-lived **JWT** obtained by logging in with the admin password.

## What it does

- **Login** — exchanges the admin password for a session JWT (`POST /api/admin/login`),
  stored in `localStorage`. A `401` anywhere clears it and bounces back to login.
- **Machines** — live list with online/offline status (polls every 5s).
- **Enroll** — mints a one-time enroll token and shows the ready-to-paste
  `curl … | sh` install command for a new server.
- **Run jobs** — enqueue `healthcheck` / `deploy` / `restart` per machine.
- **Job detail** — status + streamed stdout/stderr logs (polls until terminal).
- **Revoke** — disable a device.

## Configure

```sh
cp .env.example .env
# point at your deployed Worker (no trailing slash):
# VITE_API_BASE_URL=https://outpost.<subdomain>.workers.dev
```

The control plane must be deployed with the admin-JWT + CORS changes
(`cd control-plane && npm run deploy`). Auth uses a Bearer token (no cookies), so
the default permissive CORS is fine; restrict it by setting `ADMIN_UI_ORIGIN` on
the Worker once this app has a fixed origin.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
```

Log in with your `ADMIN_PASSWORD` (defaults to `ADMIN_TOKEN` if you didn't set a
separate password on the Worker).

## Build & deploy

```sh
npm run build      # → dist/
```

`dist/` is a static SPA — host it anywhere (Cloudflare Pages, etc.). For Pages:
set the build command to `npm run build`, output dir `dist`, and the
`VITE_API_BASE_URL` env var to your Worker URL.

## Auth model

The browser never holds the master `ADMIN_TOKEN`. It holds a session JWT (HS256,
~12h) that the Worker verifies on every admin call. The static `ADMIN_TOKEN`
still works for `curl`/CI. See `../ENROLLMENT.md` and `../SECURITY.md`.
