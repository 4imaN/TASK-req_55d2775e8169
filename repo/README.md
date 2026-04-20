Project Type: Fullstack

# StudyRoomOps Reservation & Member Engagement Portal

A local-network reservation, access oversight, community feedback, lead intake, moderation, membership, and reporting system for study-room operations.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- No other dependencies required

### Start the System

```bash
docker-compose up
```

or equivalently:

```bash
docker compose up -d
```

That's it. Everything is automatic:

1. A `.env` file with random secrets is generated on first run
2. MongoDB replica set initializes itself (3 nodes)
3. Database collections and indexes are created
4. Demo data is seeded (4 users, 3 zones, 7 rooms, policies, membership tiers)
5. API server starts with all defaults baked in
6. Web frontend starts and connects to the API
7. Nginx reverse proxy starts with auto-generated self-signed TLS certificates

Once all containers are healthy (~30-60 seconds on first build):
- **Web UI**: http://localhost:3000 (default access path for validation)
- **API Health**: http://localhost:3001/api/v1/health

No manual setup is needed. On subsequent starts the existing `.env` is reused, so your data stays decryptable. To customize settings, edit the generated `.env` or see `.env.example` for reference.

### Demo Credentials

| Role | Username | Password |
|---|---|---|
| Regular User | `alice` | `AlicePass12345` |
| Creator (Staff) | `bob_creator` | `BobCreator12345` |
| Moderator (Staff) | `carol_mod` | `CarolMod123456` |
| Administrator | `admin` | `AdminPass12345!` |

### URLs and Ports

| Service | URL | Port |
|---|---|---|
| Web Frontend | http://localhost:3000 | 3000 |
| API Server | http://localhost:3001 | 3001 |
| HTTPS (nginx proxy) | https://localhost | 443 |
| MongoDB Primary | mongodb://localhost:27017 | 27017 |
| Vision Worker | http://localhost:5000 | 5000 (optional) |

Use `http://localhost:3000` as the default validation path. HTTPS uses a self-signed cert; your browser will warn.

## Verification

### Minimum Verification (API)

```bash
# 1. Health check (no auth needed)
curl http://localhost:3001/api/v1/health
# Expected: {"ok":true,"service":"studyroomops-api","timestamp":"..."}

# 2. Get a CSRF token — copy the csrfToken value from the response
curl -c cookies.txt http://localhost:3001/api/v1/auth/csrf
# Expected: {"ok":true,"data":{"csrfToken":"<TOKEN>"}}

# 3. Login — paste the csrfToken from step 2 into the x-csrf-token header
curl -c cookies.txt -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <TOKEN>" \
  -d '{"username":"admin","password":"AdminPass12345!"}' \
  http://localhost:3001/api/v1/auth/login
# Expected: {"ok":true,"data":{"user":{"username":"admin","roles":["administrator"],...},...}}

# 4. Authenticated request — list zones (use cookies from login)
curl -b cookies.txt http://localhost:3001/api/v1/zones
# Expected: {"ok":true,"data":[{"name":"Ground Floor",...},...],"meta":{"total":3,...}}

# 5. List rooms
curl -b cookies.txt http://localhost:3001/api/v1/rooms
# Expected: {"ok":true,"data":[{"name":"Open Study A",...},...],"meta":{"total":7,...}}
```

### Minimum Verification (UI)

1. Open http://localhost:3000
2. Log in with `admin` / `AdminPass12345!`
3. **Staff > Zones** — 3 seeded zones visible
4. **Staff > Room Setup** — 7 seeded rooms visible
5. **Staff > Business Hours** — 7-day schedule shown
6. **Admin > Users** — 4 demo users listed
7. **Admin > Audit Logs** — login events appear

### Extended Verification

8. Log out, log in as `alice` / `AlicePass12345` — staff/admin sections hidden
9. **Rooms** — browse rooms, click "Book Now" to see booking form
10. **Leads** — click "New Request" to see lead intake form
11. **Admin > Analytics** — KPI cards render (needs reservation data)
12. **Admin > Membership** — tier listing and member accounts
13. **Admin > Exports** — create a reservations CSV export
14. **Staff > Moderation** — reports and appeals queues load

### Test Commands

```bash
# Run all tests in containers
./run_tests.sh all

# Run only API tests
./run_tests.sh api

# Run only frontend tests
./run_tests.sh web
```

## Architecture

```
StudyRoomOps
├── apps/api          # Express + TypeScript API server
├── apps/web          # React + TypeScript frontend
├── apps/vision-worker # Python + OpenCV face detection/recognition
├── packages/shared-types   # Shared TypeScript type definitions
├── packages/shared-policy  # Shared business rule constants
├── docker/           # Dockerfiles and init scripts
└── scripts/          # Operational scripts (backup, restore, certs, audit)
```

### Tech Stack

- **Backend**: Node.js 20 + Express + TypeScript
- **Frontend**: React 18 + TypeScript + Vite
- **Database**: MongoDB 7 (3-node replica set)
- **Vision**: Python 3.11 + OpenCV
- **Auth**: Argon2id + JWT + CSRF tokens
- **Deployment**: Docker Compose

### Key Design Decisions

- **Transactional conflict prevention**: 15-minute reservation slices with unique index prevent double-booking
- **Hash-chained audit logs**: Append-only with SHA-256 chain for tamper evidence
- **Field-level encryption**: AES-256-GCM for sensitive profile data
- **Local-only**: No cloud services, no runtime internet dependency
- **Policy versioning**: All admin policy changes create versioned records

## Implementation Phases

| Phase | Status | Description |
|---|---|---|
| 1 - Foundation | Complete | Auth, RBAC, audit, zones, rooms, business hours |
| 2 - Reservations | Complete | Calendar, booking, conflict engine, check-in, favorites, share links |
| 3 - Leads | Complete | Lead intake, workflow, attachments, SLA reminders |
| 4 - Community | Complete | Reviews, Q&A, moderation, reputation tiers |
| 5 - Membership | Complete | Wallet, points, analytics, exports, blacklist, disputes |
| 6 - Vision | Complete | Face detection/recognition worker, access oversight UI, encrypted embeddings, event retention. Worker requires connected camera or sample images for live testing. |

## Advanced Usage

### Backup & Restore

```bash
./scripts/backup.sh
./scripts/restore.sh ./backups/20260418_120000
```

### Audit Chain Verification

```bash
./scripts/verify-audit-chain.sh
```

### Vision Worker

```bash
docker compose --profile vision up -d
```

### HTTPS Certificate Regeneration

```bash
./scripts/generate-certs.sh
docker compose restart nginx
```

## Environment Variables

See `.env.example` for all configuration options.

## License

Internal use only.
