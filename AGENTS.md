# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

INEXC is a static Arabic (RTL) website and training management platform for a UAE-based professional development company. There is **no build step**, **no bundler**, and **no package manager** — all dependencies are loaded via CDN. The backend is fully hosted on Supabase (PostgreSQL + Edge Functions).

### Running the Dev Server

Serve the project root with any static HTTP server on port 8080:

```bash
http-server /workspace -p 8080 -c-1 --cors
```

Alternatively, `python3 -m http.server 8080` works but lacks CORS headers.

All HTML pages are at the repository root (e.g., `index.html`, `admin.html`, `register.html`).

### Key Pages

| Page | URL Path | Purpose |
|------|----------|---------|
| Homepage | `/index.html` | Marketing landing page with course catalog |
| Registration | `/register.html` | Course registration (Stripe payments) |
| Admin | `/admin.html` | Admin command center (password-protected) |
| Trainee Login | `/login.html` | OTP-based trainee authentication |
| Trainee Portal | `/account.html` | Student dashboard |
| Certificate Verify | `/certificate.html` | Public certificate verification |
| Digital ID | `/digital-id.html` | Public trainee identity card |
| Attendance | `/attendance-checkin.html` | QR/code-based attendance |

### Linting

- **HTML**: `htmlhint /workspace/*.html` (globally installed)
- **JS/CSS**: No formal linting configuration exists in this project. ESLint can be used ad-hoc but requires an `eslint.config.js` to be created.

### Backend (Supabase)

- The Supabase project URL and anon key are in `supabase-config.js` (cloud-hosted, not local).
- Edge Functions live in `supabase/functions/` (Deno/TypeScript) — they run on Supabase's infrastructure, not locally.
- SQL migration files at the root (`*.sql`) are meant for the Supabase SQL Editor.

### Gotchas

- Opening HTML files via `file://` protocol will cause CORS failures with Supabase and CDN scripts. Always use an HTTP server.
- The site is fully RTL (Arabic) — be mindful of text direction when making UI changes.
- `admin-backup.html` is a partial HTML fragment (not a standalone page) and will fail HTML linting — this is expected.
- There is no `package.json` or formal dependency manifest. Node.js scripts in `scripts/` are standalone utilities.
