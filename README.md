# 10Blocuri Neighbourhood App (Next.js + Node)

This project now runs on **Next.js (Node runtime)** with PostgreSQL (Neon on Vercel).

## Defaults

- 10 buildings (`bloc1` .. `bloc10`)
- 16 apartment users per building (`bloc1_apt1` .. `bloc10_apt16`)
- Default resident password: `10blocuri`
- Admin user: `admin`
- Admin password: `adex123#`
- Usernames are normalized to lowercase automatically.
- Avizier permission classes: `none`, `reprezentant_bloc`, `comitet` (admin is always super user)

## Stack

- Next.js App Router
- Node.js route handlers (`/app/api/...`)
- PostgreSQL (`pg`)
- Luxon (Bucharest timezone conversions for poll dates)

## Required Environment Variables

Set one of:

- `POSTGRES_URL` (recommended, pooled Neon URL)
- `DATABASE_URL`
- `POSTGRES_URL_NON_POOLING`

Optional:

- `FLASK_SECRET_KEY` (used as session signing secret for compatibility)

## Cloudflare R2 (Photos/Attachments)

To enable file uploads for poll attachments, set:

- `R2_ACCOUNT_ID` (or `R2_ENDPOINT`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

The app uses:

- `POST /api/uploads/direct` for same-origin uploads (no browser CORS issues)
- `POST /api/uploads/presign` to generate signed upload URLs (optional advanced flow)
- `GET /api/uploads/view?key=...` to serve signed download links
- For Avizier uploads: only JPG/PDF, max 10MB per file

### Push R2 settings to Vercel

1. Copy `.env.example` to your local `.env` and fill values.
2. Export vars in your shell (or source `.env`).
3. Run:

```bash
./scripts/push-vercel-r2-env.sh
```

This pushes env vars to `production`, `preview`, and `development` scopes.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Deploy (Vercel)

```bash
vercel
vercel --prod
```

Vercel auto-detects Next.js. No custom `vercel.json` is required.

## API Surface

- `GET /api`
- `GET /health`
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/profile/overview`
- `POST /api/profile/password`
- `GET /api/dashboard`
- `POST /api/slots`
- `GET /api/slots/open`
- `POST /api/slots/auto-reserve`
- `POST /api/slots/claim`
- `POST /api/slots/:slot_id/delete`
- `GET /api/buildings/stats`
- `GET /api/users` (admin)
- `POST /api/users` (admin)
- `POST /api/admin/slots` (admin)
- `GET /api/marketplace/dashboard`
- `GET /api/marketplace/posts`
- `GET /api/marketplace/posts/:post_id`
- `POST /api/marketplace/posts` (resident)
- `POST /api/marketplace/posts/:post_id/claim` (resident, donation only)
- `POST /api/marketplace/posts/:post_id/complete` (owner/admin)
- `POST /api/marketplace/posts/:post_id/delete` (owner/admin)
- `GET /api/avizier`
- `POST /api/avizier` (admin, comitet, reprezentant_bloc with building scope only)
- `GET /api/avizier/:announcement_id`
- `POST /api/avizier/:announcement_id/update` (author/admin)
- `POST /api/avizier/:announcement_id/delete` (author/admin)
- `GET /api/polls`
- `POST /api/polls` (admin)
- `GET /api/polls/:poll_id`
- `POST /api/polls/:poll_id/attachments` (admin)
- `POST /api/polls/:poll_id/activate` (admin)
- `POST /api/polls/:poll_id/close` (admin)
- `POST /api/polls/:poll_id/archive` (admin)
- `POST /api/polls/:poll_id/vote`
- `GET /api/polls/:poll_id/results`
- `POST /api/uploads/direct`
- `POST /api/uploads/presign`
- `GET /api/uploads/view?key=...`

## Marketplace Listing Page

- `GET /marketplace/listings/:id` (full listing details + photo gallery)
- `GET /profile` (profile management with activity + quick actions)
