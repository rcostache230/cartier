# AGENTS.md

## Project Overview
10Blocuri is a neighbourhood app for Romanian apartment buildings (10 buildings, 16 apartments each, 160 residents). Built with Next.js App Router on Node.js runtime, deployed on Vercel, using PostgreSQL (Neon) and Cloudflare R2 for file storage.

## Stack
- **Runtime**: Next.js App Router with Node.js route handlers in `/app/api/`
- **Database**: PostgreSQL via `pg` library, connection string in `POSTGRES_URL`
- **File storage**: Cloudflare R2 (uploads via `/api/uploads/direct` and `/api/uploads/presign`)
- **Timezone**: Luxon with `Europe/Bucharest`
- **Frontend**: Vanilla HTML templates in `api/templates/`, vanilla JS in `public/js/`, CSS in `public/css/`
- **No framework**: No React, no Vue — pure HTML + JS + CSS
- **Deploy**: Vercel (auto-detects Next.js, zero config)

## Architecture Patterns
- **API routes**: All in `/app/api/` as Next.js route handlers. `GET` for reads, `POST` for mutations (not PUT/PATCH/DELETE).
- **Auth**: Session-based via `FLASK_SECRET_KEY`. Use `getSession(req)` from `lib/auth.js` to get current user.
- **User model**: Usernames are `bloc1_apt1` through `bloc10_apt16`. Admin is `admin`. Users have `building_id` (e.g., `"bloc3"`) and `permission_class` (`none`, `reprezentant_bloc`, `comitet`).
- **Templates**: Full HTML pages in `api/templates/` served by route handlers. They include the shared sidebar nav and topbar.
- **Modules**: Feature code lives in root-level dirs (`parking_module/`, `voting_module/`) with lib files. API routes go in `/app/api/`.
- **Uploads**: Reuse existing R2 endpoints — `POST /api/uploads/direct` for upload, `GET /api/uploads/view?key=...` for signed download URLs. Whitelist: JPG, PNG, PDF. Max 10MB.

## UI Structure (IMPORTANT — read before touching templates)
- **Layout**: Collapsible left sidebar (dark navy #1C2B3D, ~210px) + top bar + main content area
- **Sidebar nav items**: Home, Parking, Marketplace, Voting, Avizier, Contacte, Recomandări. Bottom: Dark Mode toggle, Profile, user card (avatar + username), Logout button (coral red).
- **Dashboard**: Card grid with colored top borders (blue=Parking, purple=Voting, orange=Marketplace, teal=Avizier, orange=Contacte, teal=Recomandări). "Ce e nou" activity feed card.
- **Font**: Inter (system fallback)
- **Colors**: Background #F0EDE7, cards #FFFFFF with #E8E4DD borders, accent orange #E8883C, radius 12px.
- **Mobile**: Sidebar becomes hamburger drawer. Bottom tab bar with 5 items: Home, Parking, Mesaje (center), Market, Mai mult.

## Existing Modules (for reference)
- `parking_module/` — slot reservations
- `voting_module/` — polls with Luxon date handling
- Marketplace — posts with photo uploads via R2
- Avizier — announcements with permission scoping (comitet, reprezentant_bloc)
- Contacte — useful phone numbers
- Recomandări — local service recommendations

## Commands
- `npm install` — install dependencies
- `npm run dev` — local dev server on :3000
- `npm run build` — production build
- No test runner currently configured

## Conventions
- All SQL uses the `pg` library directly (no ORM)
- All new tables MUST use `msg_` prefix to avoid collisions
- Use `TIMESTAMPTZ` for all dates, convert display with Luxon
- Soft delete with `deleted_at` column, never hard delete user content
- Route handlers export `GET` and `POST` functions (Next.js App Router convention)
- HTML templates are self-contained files with inline `<style>` and `<script>` or refs to `/js/` and `/css/`
- Admin (`username === 'admin'`) always has full access to everything
- Building scope: residents can only see data from their own building unless they have elevated permissions

## Environment Variables (existing)
```
POSTGRES_URL=...
FLASK_SECRET_KEY=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

## New env vars needed for messaging
```
PUSHER_APP_ID=...
PUSHER_KEY=...
PUSHER_SECRET=...
PUSHER_CLUSTER=eu
```
