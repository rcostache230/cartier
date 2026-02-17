# Cartier Neighbourhood App (Next.js + Node)

This project now runs on **Next.js (Node runtime)** with PostgreSQL (Neon on Vercel).

## Defaults

- 10 buildings (`bloc1` .. `bloc10`)
- 16 apartment users per building (`bloc1_apt1` .. `bloc10_apt16`)
- Default resident password: `10blocuri`
- Admin user: `admin`
- Admin password: `adex123#`
- Usernames are normalized to lowercase automatically.

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
- `GET /api/dashboard`
- `POST /api/slots`
- `GET /api/slots/open`
- `POST /api/slots/auto-reserve`
- `POST /api/slots/claim`
- `GET /api/buildings/stats`
- `GET /api/users` (admin)
- `POST /api/users` (admin)
- `POST /api/admin/slots` (admin)
- `GET /api/polls`
- `POST /api/polls` (admin)
- `GET /api/polls/:poll_id`
- `POST /api/polls/:poll_id/attachments` (admin)
- `POST /api/polls/:poll_id/activate` (admin)
- `POST /api/polls/:poll_id/close` (admin)
- `POST /api/polls/:poll_id/archive` (admin)
- `POST /api/polls/:poll_id/vote`
- `GET /api/polls/:poll_id/results`
