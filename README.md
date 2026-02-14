# Neighbourhood Parking Dashboard (Auth + Admin)

This project is a Vercel-ready Flask app for parking spot sharing between neighbours.

## Defaults

- 10 buildings (`bloc1` .. `bloc10`)
- 16 apartment users per building (`bloc1_apt1` .. `bloc10_apt16`)
- Default resident password: `10blocuri`
- Admin user: `admin`
- Admin password: `adex123#`
- Usernames are normalized to lowercase automatically.
- If a username starts with `blocN` (example: `bloc3_maria`), building is auto-assigned to that building.
- Building capacity shown in dashboard:
  - 10 underground spots
  - 6 above-ground spots

## What changed

- Authentication required for all parking actions.
- Free-text parking spot number when sharing (no fixed slot lookup).
- Dashboard sections:
  - Shared parking spots
  - My shared spots
  - My shared spots claimed by neighbours (+ claimed period)
  - My claimed spots (+ claimed period)
- Claim flow:
  - choose from currently available shared spots
  - claim a selected spot for an exact period
- Admin-only user management:
  - List users
  - Create resident/admin users (with phone number)

## API

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard` (login required)
- `POST /api/slots` (login required)
- `GET /api/slots/open` (login required)
- `POST /api/slots/auto-reserve` (login required)
- `POST /api/slots/claim` (login required, selected slot)
- `GET /api/buildings/stats` (login required)
- `GET /api/users` (admin)
- `POST /api/users` (admin)
- `POST /api/admin/slots` (admin, create slot for any resident)

## Local run

```bash
pip install -r requirements.txt
python api/index.py
```

Open `http://localhost:8000`.

## Deploy

```bash
vercel
vercel --prod
```

## Production note

This app supports persistent Postgres via `DATABASE_URL` / `POSTGRES_URL`.
If no Postgres URL is configured, it falls back to SQLite (`/tmp` on Vercel, which is ephemeral).
