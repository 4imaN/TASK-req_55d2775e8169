# API Specs

## Base Contract

### Base URL

- `/api/v1`

### Transport and session model

- session authentication uses cookies
- frontend and API communicate with `credentials: include`
- mutating requests require CSRF

Relevant files:
- `apps/api/src/app.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/middleware/csrf.ts`
- `apps/web/src/utils/api.ts`

### CSRF

Mutating methods require:
- `x-csrf-token` header
- matching `csrf_token` cookie

Token bootstrap endpoint:
- `GET /api/v1/auth/csrf`

Safe methods bypass CSRF:
- `GET`
- `HEAD`
- `OPTIONS`

### Standard response envelope

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

Paginated success:

```json
{
  "ok": true,
  "data": [],
  "meta": {
    "requestId": "...",
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "SOME_CODE",
    "message": "Human-readable message",
    "details": {},
    "requestId": "..."
  }
}
```

Evidence:
- `apps/api/src/utils/response.ts`

## Auth Model

### Roles

- user
- creator
- moderator
- administrator

Authorization behavior:
- administrator inherits creator and moderator access

Evidence:
- `apps/api/src/middleware/auth.ts`

## Route Surface

Route mounts are defined in:
- `apps/api/src/app.ts`

### Health

- `GET /health`
  - auth: public
  - purpose: service liveness

### Auth

- `POST /auth/register`
  - auth: public
  - body: username, password, displayName, phone?
  - returns: user + csrfToken, sets session cookie

- `POST /auth/login`
  - auth: public
  - body: username, password
  - returns: user + csrfToken, sets session cookie

- `POST /auth/logout`
  - auth: authenticated
  - behavior: revokes session, clears cookies

- `GET /auth/me`
  - auth: authenticated
  - returns: current user

- `GET /auth/csrf`
  - auth: public
  - returns: csrfToken and sets CSRF cookie

### Users

- `GET /users/me`
  - auth: authenticated

- `GET /users/:id`
  - auth: administrator

- `GET /users`
  - auth: administrator
  - query: page, pageSize, search

- `POST /users/:id/roles`
  - auth: administrator
  - body: role

- `PUT /users/:id/roles`
  - auth: administrator
  - body: roles[]

- `DELETE /users/:id/roles/:role`
  - auth: administrator

- `POST /users/:id/unlock`
  - auth: administrator

### Zones

- `GET /zones`
  - auth: authenticated
  - query: page, pageSize, isActive

- `GET /zones/:id`
  - auth: authenticated

- `POST /zones`
  - auth: creator or administrator
  - body: name, description

- `PUT /zones/:id`
  - auth: creator or administrator
  - body: name, description, isActive, version

### Rooms

- `GET /rooms`
  - auth: authenticated
  - query: page, pageSize, zoneId, isActive, search

- `GET /rooms/:id`
  - auth: authenticated

- `POST /rooms`
  - auth: creator or administrator
  - body: zoneId, name, description, capacity, amenities

- `PUT /rooms/:id`
  - auth: creator or administrator
  - body: name, description, capacity, amenities, isActive, version

### Business Hours

- `GET /business-hours`
  - auth: authenticated
  - query: scope, scopeId

- `GET /business-hours/effective`
  - auth: authenticated
  - query: roomId, zoneId, dayOfWeek

- `POST /business-hours`
  - auth: creator or administrator
  - body: scope, scopeId, dayOfWeek, openTime, closeTime

- `DELETE /business-hours/:id`
  - auth: creator or administrator

### Reservations

- `GET /reservations/availability`
  - auth: authenticated
  - query: roomId, startDate, endDate

- `POST /reservations`
  - auth: authenticated
  - body: roomId, startAtUtc, endAtUtc, idempotencyKey, notes?

- `GET /reservations`
  - auth: authenticated
  - query: page, pageSize, status, startDate, endDate, mine, userId, roomId, zoneId
  - note: staff callers can see broader results

- `GET /reservations/:id`
  - auth: authenticated

- `POST /reservations/:id/cancel`
  - auth: authenticated
  - body: reason?

- `POST /reservations/:id/check-in`
  - auth: authenticated

### Favorites

- `GET /favorites`
  - auth: authenticated

- `POST /favorites`
  - auth: authenticated
  - body: roomId

- `DELETE /favorites/:roomId`
  - auth: authenticated

### Share Links

- `POST /share-links`
  - auth: authenticated
  - body: reservationId

- `GET /share-links/:token`
  - auth: authenticated

- `DELETE /share-links/:token`
  - auth: authenticated

### Notifications

- `GET /notifications`
  - auth: authenticated
  - query: page, pageSize, unreadOnly

- `GET /notifications/unread-count`
  - auth: authenticated

- `PUT /notifications/:id/read`
  - auth: authenticated

- `PUT /notifications/read-all`
  - auth: authenticated

### Audit Logs

- `GET /audit-logs`
  - auth: administrator
  - query: page, pageSize, objectType, actorUserId, action, startDate, endDate

- `GET /audit-logs/verify`
  - auth: administrator

### Leads

- `POST /leads`
  - auth: authenticated
  - header: `idempotency-key`

- `GET /leads`
  - auth: authenticated
  - query: page, pageSize, status, type

- `GET /leads/:id`
  - auth: authenticated

- `PUT /leads/:id/status`
  - auth: creator or administrator
  - body: status, quoteAmountCents?, closeReason?

- `POST /leads/:id/notes`
  - auth: creator or administrator
  - body: content

- `GET /leads/:id/notes`
  - auth: creator or administrator

- `GET /leads/:id/history`
  - auth: authenticated with lead visibility

- `POST /leads/:id/attachments`
  - auth: authenticated
  - multipart: `file`

- `GET /leads/:id/attachments`
  - auth: authenticated

- `GET /leads/:id/attachments/:attachmentId/download`
  - auth: authenticated

### Reviews

- `POST /reviews`
  - auth: authenticated
  - body: reservationId, rating, text, idempotencyKey?

- `GET /reviews`
  - auth: optional
  - query: roomId, state, pinned, authorId, dateFrom, dateTo, page, pageSize

- `GET /reviews/:id`
  - auth: authenticated

- `PUT /reviews/:id`
  - auth: authenticated
  - body: rating, text

- `POST /reviews/:id/media`
  - auth: authenticated
  - multipart array field: `media`
  - note: current tests also exercise attachment-style upload expectations around this route family

- `GET /reviews/:id/media`
  - auth: authenticated

- `GET /reviews/:id/media/:mediaId/download`
  - auth: authenticated

- `POST /reviews/:id/feature`
  - auth: moderator or administrator
  - body: featured

### Q&A Threads

- `POST /qa-threads`
  - auth: authenticated
  - body: roomId, title, body

- `GET /qa-threads`
  - auth: optional
  - query: roomId, state, page, pageSize

- `GET /qa-threads/:id`
  - auth: authenticated

- `POST /qa-threads/:id/posts`
  - auth: authenticated
  - body: body

- `GET /qa-threads/:id/posts`
  - auth: authenticated
  - query: page, pageSize

- `PUT /qa-threads/:id/pin`
  - auth: moderator or administrator
  - body: isPinned

- `PUT /qa-threads/:id/collapse`
  - auth: moderator or administrator

### Moderation

- `POST /moderation/reports`
  - auth: authenticated
  - body: contentType, contentId, reason

- `GET /moderation/reports`
  - auth: moderator or administrator
  - query: status, contentType, page, pageSize

- `PUT /moderation/reports/:id`
  - auth: moderator or administrator
  - body: status

- `POST /moderation/appeals`
  - auth: authenticated
  - body: contentType, contentId, moderationActionId, reason

- `GET /moderation/appeals`
  - auth: moderator or administrator
  - query: status, contentType, page, pageSize

- `PUT /moderation/appeals/:id`
  - auth: moderator or administrator
  - body: status

- `PUT /moderation/content-state`
  - auth: moderator or administrator
  - body: contentType, contentId, state

### Membership

- `GET /membership/me`
  - auth: authenticated

- `GET /membership/members`
  - auth: administrator
  - query: page, pageSize, search

- `GET /membership/tiers`
  - auth: authenticated

- `POST /membership/tiers`
  - auth: administrator
  - body: name, description, benefits

- `PUT /membership/tiers/:id`
  - auth: administrator
  - body: name, description, benefits, isActive, version

- `PUT /membership/assign`
  - auth: administrator
  - body: userId, tierId

### Wallet

- `POST /wallet/topup`
  - auth: administrator
  - body: userId, amountCents, description, idempotencyKey

- `POST /wallet/spend`
  - auth: administrator
  - body: userId, amountCents, description, referenceType?, referenceId?, idempotencyKey

- `POST /wallet/refund`
  - auth: administrator
  - body: userId, amountCents, originalEntryId, description, idempotencyKey

- `POST /wallet/redeem-points`
  - auth: authenticated
  - body: pointsToRedeem, idempotencyKey

- `GET /wallet/balance`
  - auth: authenticated
  - query: userId? for admin

- `GET /wallet/ledger`
  - auth: authenticated
  - query: page, pageSize, type, startDate, endDate, userId?

### Disputes

- `POST /wallet/disputes`
  - auth: authenticated
  - body: ledgerEntryId, reason, idempotencyKey

- `GET /wallet/disputes`
  - auth: administrator
  - query: page, pageSize, userId, status, startDate, endDate

- `PUT /wallet/disputes/:id`
  - auth: administrator
  - body: status, internalNotes?

### Blacklist

- `GET /blacklist`
  - auth: administrator
  - query: page, pageSize, userId, triggeredBy, active

- `POST /blacklist`
  - auth: administrator
  - body: userId, reason, expiresAt?

- `POST /blacklist/:userId/clear`
  - auth: administrator

### Analytics

- `GET /analytics/booking-conversion`
  - auth: administrator
  - query: grain, roomId, zoneId, startDate, endDate

- `GET /analytics/attendance-rate`
  - auth: administrator
  - query: grain, roomId, zoneId, startDate, endDate

- `GET /analytics/noshow-rate`
  - auth: administrator
  - query: grain, roomId, zoneId, startDate, endDate

- `GET /analytics/peak-utilization`
  - auth: administrator
  - query: grain, roomId, zoneId, startDate, endDate

- `GET /analytics/offpeak-utilization`
  - auth: administrator
  - query: grain, roomId, zoneId, startDate, endDate

- `GET /analytics/policy-impact`
  - auth: administrator
  - query: policyVersionId, kpiName, windowDays

- `GET /analytics/snapshots`
  - auth: administrator
  - query: page, pageSize, kpiName, grain, roomId, zoneId, startDate, endDate

### Exports

- `POST /exports`
  - auth: administrator
  - body: exportType, filters

- `GET /exports`
  - auth: administrator
  - query: page, pageSize, userId, status

- `GET /exports/:id`
  - auth: administrator

- `GET /exports/:id/download`
  - auth: administrator

### Vision

Vision routes are mixed:
- some proxy to the Python worker
- some operate against MongoDB metadata directly

- `POST /vision/detect`
  - auth: creator or administrator
  - multipart: `frame`

- `POST /vision/recognize`
  - auth: creator or administrator
  - body: worker-specific recognition payload

- `GET /vision/cameras`
  - auth: creator or administrator

- `POST /vision/cameras`
  - auth: creator or administrator
  - body: device_identifier, name, location?, zone_id?, room_id?, is_active?

- `PUT /vision/cameras/:id`
  - auth: creator or administrator
  - body: name, location, zone_id, room_id, is_active

- `GET /vision/events`
  - auth: administrator
  - query: page, pageSize, camera_id, decision, date_from, date_to

- `POST /vision/enroll`
  - auth: administrator
  - body: user_id, image_samples[], consent_metadata, overwrite?

- `GET /vision/enrollments/:userId`
  - auth: administrator

- `DELETE /vision/enrollments/:userId`
  - auth: administrator

### Policies

- `GET /policies`
  - auth: administrator
  - query: page, pageSize, policyArea

- `GET /policies/:id`
  - auth: administrator

- `POST /policies`
  - auth: administrator
  - body: policyArea, settings, effectiveAt

## Current Testing Note

The backend route surface is now broadly covered through integration tests in `apps/api/tests/integration`.

The main remaining project-level validation gap is not route documentation, but browser-level fullstack execution coverage for the React app.
