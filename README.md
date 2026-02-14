# Neighbourhood Parking API (Vercel Ready)

This repository contains the parking slot sharing module and a Vercel-ready API.

## Features

- Default residents: `Bloc1_Apt1` ... `Bloc10_Apt16` (160 users total).
- Owner shares availability with:
  - `parking_space_number`
  - `parking_type` (`above_ground` or `underground`)
  - exact datetime interval (`available_from`, `available_until`)
- Auto-fill reservation:
  - requester asks for a datetime interval and optional parking type
  - earliest compatible slot is reserved automatically

## API Endpoints

- `GET /health`
- `POST /users/seed`
- `POST /slots`
- `GET /slots/open`
- `POST /slots/auto-reserve`

## Example Requests

Create slot:

```bash
curl -X POST http://localhost:8000/slots \
  -H "Content-Type: application/json" \
  -d '{
    "owner_username": "Bloc1_Apt1",
    "parking_space_number": "A-07",
    "parking_type": "underground",
    "available_from": "2026-02-20T08:00",
    "available_until": "2026-02-20T18:00"
  }'
```

Auto-reserve:

```bash
curl -X POST http://localhost:8000/slots/auto-reserve \
  -H "Content-Type: application/json" \
  -d '{
    "requester_username": "Bloc2_Apt6",
    "requested_from": "2026-02-20T12:00",
    "requested_until": "2026-02-20T16:00",
    "parking_type": "underground"
  }'
```

## Deploy To Vercel

1. Install CLI:
```bash
npm i -g vercel
```

2. Login:
```bash
vercel login
```

3. Deploy from repo root:
```bash
vercel
```

4. Deploy production:
```bash
vercel --prod
```

## Important Note About Database

- On Vercel, local SQLite in `/tmp` is ephemeral.
- Current setup is fine for demo/testing deployments.
- For real production data persistence, move to managed Postgres (e.g. Vercel Postgres, Neon, Supabase).

## Local Run

```bash
pip install -r requirements.txt
python api/index.py
```
