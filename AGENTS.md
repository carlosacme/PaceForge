# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

PaceForge (RunningApexFlow) is a running coaching and training platform built as a React 19 + Vite 8 SPA. It uses Supabase (cloud-hosted) for auth and database, and has serverless API functions in `/api/` designed for Vercel deployment.

### Running the dev server

```
npm run dev
```

Starts Vite on port 5173 with HMR. The Vite config proxies `/api` requests to `http://127.0.0.1:3000` (for local API function development via `vercel dev` or similar).

### Lint / Build / Preview

- **Lint:** `npm run lint` — runs ESLint. Note: there are ~26 pre-existing lint errors (mostly `no-undef` in `/api/` files referencing `process`, `react-hooks/set-state-in-effect` in `App.jsx`, and service worker globals in `public/sw.js`). These are not regressions.
- **Build:** `npm run build` — Vite production build to `dist/`.
- **Preview:** `npm run preview` — serves the production build locally.

### Key caveats

- The main app component is a monolithic `src/App.jsx` (~10,600 lines). Changes here are high-risk for merge conflicts.
- The `/api/` directory contains Vercel-style serverless functions. They are NOT served by the Vite dev server. To test them locally, use `npx vercel dev` (requires Vercel CLI, not included in `package.json` dependencies) or a compatible local server on port 3000.
- Supabase is cloud-hosted — no local database setup needed. The `.env` file contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`.
- The lockfile is `package-lock.json`; use `npm` as the package manager.
- No test framework is configured in the project.
