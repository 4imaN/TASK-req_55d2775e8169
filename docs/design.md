# StudyRoomOps Design

## Overview

StudyRoomOps is a Docker-first local-network study room operations platform with three primary runtimes:

- `apps/api`: Express + TypeScript backend
- `apps/web`: React + TypeScript frontend
- `apps/vision-worker`: Python/OpenCV vision service

Supporting shared packages:
- `packages/shared-types`
- `packages/shared-policy`

The system is organized around operational workflows for study-room access and administration:
- authentication and RBAC
- zone and room management
- business hours and reservation lifecycle
- favorites and share links
- notifications and audit logging
- lead intake and attachments
- reviews, Q&A, and moderation
- membership, wallet, disputes, and blacklist
- analytics and exports
- face-recognition enrollment/events/camera management

## Product Boundaries

### User-facing roles

- regular user
- creator
- moderator
- administrator

Role behavior is hierarchical in practice:
- administrators inherit creator and moderator capabilities in backend middleware

Evidence:
- `apps/api/src/middleware/auth.ts`
- `apps/web/src/contexts/AuthContext.tsx`

### Deployment assumptions

The repo is designed for local or controlled-network deployment:
- MongoDB replica set
- web app and API on localhost ports
- optional vision worker
- no cloud dependency in the normal architecture

Evidence:
- `README.md`
- `apps/api/src/config/index.ts`

## High-Level Architecture

```text
Browser
  -> React SPA (`apps/web`)
      -> fetch `/api/v1/...` with session cookies + CSRF
          -> Express API (`apps/api`)
              -> MongoDB
              -> optional Vision Worker proxy (`apps/vision-worker`)
```

### Frontend

The React app is route-driven and centered around an authenticated shell:
- public routes: login, register
- protected authenticated routes: dashboard, rooms, reservations, favorites, leads, reviews, notifications
- staff routes: creator/moderator surfaces
- admin routes: user, policy, membership, blacklist, disputes, analytics, exports, audit, vision

Evidence:
- `apps/web/src/App.tsx`

### Backend

The Express app applies:
- security headers via `helmet`
- cookie parsing
- JSON/urlencoded body parsing
- request ID middleware
- CSRF protection for mutating `/api/v1` requests
- structured logging via `morgan`
- centralized error handling

Evidence:
- `apps/api/src/app.ts`

### Vision integration

Vision routes in the API do two different things:
- proxy some requests to the Python vision worker
- read/write enrollment metadata directly in MongoDB for selected admin flows

Evidence:
- `apps/api/src/routes/vision.routes.ts`

## Frontend Design

### Application shell

The SPA uses:
- `AuthProvider` to bootstrap current user state
- `ProtectedRoute` to gate authenticated or role-specific pages
- `Layout` as the main authenticated shell

The frontend assumes cookie-based auth and keeps a client-side CSRF token cache.

Evidence:
- `apps/web/src/contexts/AuthContext.tsx`
- `apps/web/src/utils/api.ts`
- `apps/web/src/components/ProtectedRoute.tsx`

### Frontend API integration model

The frontend always calls the backend through `/api/v1`.

Behavior:
- `GET /auth/csrf` is used to fetch the CSRF token
- mutating methods automatically attach `x-csrf-token`
- `credentials: 'include'` is always enabled
- JSON response handling assumes the backend `ok/data/meta` envelope

Evidence:
- `apps/web/src/utils/api.ts`

### UI module grouping

The UI is grouped by responsibility:
- core user pages
- staff operational pages
- admin governance/ops pages

This mirrors the backend route segmentation closely and keeps authorization boundaries visible in routing.

Evidence:
- `apps/web/src/App.tsx`

## Backend Design

### Route composition

All API routes are mounted under `/api/v1`.

Major domains:
- `/auth`
- `/users`
- `/zones`
- `/rooms`
- `/business-hours`
- `/reservations`
- `/favorites`
- `/share-links`
- `/notifications`
- `/audit-logs`
- `/leads`
- `/reviews`
- `/qa-threads`
- `/moderation`
- `/membership`
- `/wallet`
- `/wallet/disputes`
- `/blacklist`
- `/analytics`
- `/exports`
- `/vision`
- `/policies`

Evidence:
- `apps/api/src/app.ts`

### Auth and authorization model

Authentication:
- cookie-based session token
- request middleware validates session and injects `userId`, `sessionId`, and `userRoles`

Authorization:
- route-level role guards
- admin role inherits creator and moderator permissions
- optional-auth mode exists for routes that allow anonymous reads with richer staff behavior

Evidence:
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/routes/review.routes.ts`
- `apps/api/src/routes/qa.routes.ts`

### CSRF model

The API uses double-submit CSRF protection for mutating requests:
- CSRF token is issued in a readable cookie
- frontend sends the same value in `x-csrf-token`
- server verifies equality and HMAC signature

Safe methods bypass CSRF checks:
- `GET`
- `HEAD`
- `OPTIONS`

Evidence:
- `apps/api/src/middleware/csrf.ts`

### Response contract

Success:
- `ok: true`
- `data`
- `meta`

Error:
- `ok: false`
- `error.code`
- `error.message`
- `error.details`
- `error.requestId`

Paginated responses include:
- `page`
- `pageSize`
- `total`

Evidence:
- `apps/api/src/utils/response.ts`

## Data Design

### Primary datastore

MongoDB is the system of record.

The API layer uses:
- standard collections for mutable business entities
- an append-only proxy guard for audit logs

Evidence:
- `apps/api/src/config/db.ts`

### Important collections and design intent

- `users`: account records and roles
- `sessions`: login sessions, idle/absolute expiry state
- `zones`: physical site subdivisions
- `rooms`: reservable resources
- `business_hours`: effective operating windows at site/zone/room scope
- `reservation_slices`: unique-slot conflict prevention layer
- `reservations`: booking records
- `favorite_rooms`: user favorites
- `reservation_share_links`: shareable reservation access tokens
- `leads`: inbound lead/request workflow
- `lead_status_history`: workflow history
- `reviews`: post-usage feedback
- `review_media`: media linked to reviews
- `qa_threads` and `qa_posts`: discussion model
- `content_reports`: moderation reports
- `ledger_entries`: wallet accounting
- `membership_accounts`: user membership state
- `face_events`: vision events with TTL cleanup
- `face_enrollments`: enrollment metadata
- `notifications`: user notifications with TTL cleanup
- `policy_versions`: policy history

Evidence:
- `apps/api/src/config/db.ts`

### Integrity patterns

Notable integrity mechanisms:

- append-only audit guard
  - blocks updates/deletes on audit collections
- unique reservation slices
  - prevents double-booking at slot granularity
- idempotency keys
  - used in reservations, leads, and wallet flows
- TTL indexes
  - sessions
  - face events
  - notifications

Evidence:
- `apps/api/src/config/db.ts`

## Domain Design

### Reservations

Reservations sit at the center of the core product flow:
- rooms exist inside zones
- business hours determine operating constraints
- reservation slices prevent conflicts
- reservations can be canceled and checked in
- reservations feed reviews, share links, analytics, and user history

### Governance and safety

The platform includes a governance layer beyond room booking:
- append-only audit logs
- policy versioning
- moderation reports and appeals
- blacklist actions
- dispute management

This indicates the system is designed as an operational platform, not only a booking app.

### Vision subsystem

The vision subsystem is intentionally isolated:
- Python worker handles CV-heavy logic
- API gateway enforces auth, consent, and safe response shaping
- enrollment metadata and event retention remain part of the main operational data model

## Security Design

Security controls visible in the repo:

- session-cookie authentication
- CSRF protection for mutating routes
- role-based access control
- security headers via `helmet`
- request ID propagation
- append-only audit protection
- production secret validation
- field/file encryption configuration

Evidence:
- `apps/api/src/app.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/middleware/csrf.ts`
- `apps/api/src/config/index.ts`
- `apps/api/src/config/db.ts`

## Runtime Configuration

Config domains include:
- MongoDB
- JWT/session timing
- CSRF
- encryption keys
- timezone/site metadata
- server port/environment
- lockout thresholds
- spam limits
- vision worker settings
- wallet risk limits
- log level

Evidence:
- `apps/api/src/config/index.ts`

Design implication:
- the system is configurable enough for multiple local deployments but still opinionated around a single-site operational environment

## Testing Design

### Current strengths

The repo now has broad backend integration coverage through real HTTP tests:
- Express app bootstrapped from the production app factory
- real DB access in test environment
- route-family test files for most domains
- additional infrastructure tests for config, retention, audit immutability, and TTL/index behavior

There is also a backend journey-style integration test:
- `apps/api/tests/integration/fullstack.test.ts`

### Current limitation

The frontend test layer remains primarily mocked component testing.

This means:
- backend contract confidence is high
- browser-executed UI integration confidence is still lower than backend confidence

## Design Strengths

- clear separation between web, API, and vision runtime concerns
- route organization mirrors product domains well
- auth, RBAC, CSRF, and audit concerns are first-class
- data model includes explicit operational integrity controls
- good backend integration test depth across route families
- Docker-first operational model is coherent with the README and app config

## Design Risks And Remaining Improvement Area

### Main remaining gap

The main design-validation gap is browser-level fullstack verification.

The current tests demonstrate:
- API correctness
- route protection
- domain behavior

They do not yet fully demonstrate:
- UI rendering against the real backend in a browser
- navigation wiring
- real user interaction across rendered pages

Recommended next step:
- add one Playwright-style E2E path covering login, room discovery, reservation creation, and reservation visibility

## Conclusion

StudyRoomOps is not a thin CRUD app. It is a multi-domain operational platform with:
- a strong backend contract
- explicit governance and security patterns
- a coherent local deployment model
- an optional specialized vision subsystem

Its architecture is already mature on the backend side. The next meaningful design-quality improvement is true browser-level end-to-end validation rather than more route-surface expansion.
