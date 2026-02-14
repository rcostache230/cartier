# Neighbourhood Parking Hub (Vercel Ready)

Parking sharing platform for 10 buildings, with apartment-based users and a building parking inventory.

## What is implemented

- UI dashboard (served at `/`) for:
  - User management
  - Share parking availability
  - Auto-reserve slots
  - Building stats and open slots overview
- User model:
  - Default seed: `Bloc1_Apt1` ... `Bloc10_Apt16` (160 users)
- Parking inventory model:
  - Per building: `10` underground (`U01..U10`) + `6` above-ground (`A01..A06`)
  - Total default spaces: `160`
- Slot sharing logic:
  - User can only publish availability for the space assigned to their apartment
  - Exact datetime intervals (`YYYY-MM-DDTHH:MM`)
  - Building-scoped auto-reservation (defaults to requester's building)

## API endpoints

- `GET /api/health`
- `GET /api/users`
- `POST /api/users`
- `POST /api/users/seed`
- `GET /api/parking-spaces`
- `POST /api/parking-spaces/seed`
- `GET /api/buildings/stats`
- `POST /api/slots`
- `GET /api/slots/open`
- `POST /api/slots/auto-reserve`

## Local run

```bash
pip install -r requirements.txt
python api/index.py
```

Open [http://localhost:8000](http://localhost:8000).

## Deploy to Vercel

```bash
vercel
vercel --prod
```

## Notes

- On Vercel, SQLite is stored in `/tmp` and is ephemeral.
- For persistent production data, move to managed Postgres.
