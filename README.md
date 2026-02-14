# Neighbourhood Parking Dashboard (Auth + Admin)

This project is a Vercel-ready Flask app for parking spot sharing between neighbours.

## Defaults

- 10 buildings (`Bloc1` .. `Bloc10`)
- 16 apartment users per building (`Bloc1_Apt1` .. `Bloc10_Apt16`)
- Default resident password: `10blocuri`
- Admin user: `Admin`
- Admin password: `adex123#`
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
- Admin-only user management:
  - List users
  - Create resident/admin users

## API

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard` (login required)
- `POST /api/slots` (login required)
- `GET /api/slots/open` (login required)
- `POST /api/slots/auto-reserve` (login required)
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

SQLite on Vercel (`/tmp`) is ephemeral. Use managed Postgres for persistent production data.
