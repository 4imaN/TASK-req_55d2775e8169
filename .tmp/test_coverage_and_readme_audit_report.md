# Audit Summary

- Project type: `fullstack`
- Test Coverage Score: `97/100`
- README Verdict: `PASS`

# Test Coverage Audit

## Scope And Method

- Audit mode: static inspection only.
- Runtime execution performed: none.
- Project type: `fullstack`.
- Primary evidence:
  - API mounts: `apps/api/src/app.ts`
  - API tests: `apps/api/tests/integration/*`, `apps/api/tests/unit/*`, `apps/api/tests/setup.ts`
  - Web tests: `apps/web/tests/**/*.test.tsx`, `apps/web/tests/e2e/*`, `apps/web/tests/e2e/setup.ts`
  - Test runner: `run_tests.sh`
  - README: `README.md`

## Backend Endpoint Inventory

Static endpoint inventory remains `116` unique `METHOD + PATH` routes under `/api/v1`, including:

1. `GET /api/v1/health`
2. `POST /api/v1/auth/register`
3. `POST /api/v1/auth/login`
4. `POST /api/v1/auth/logout`
5. `GET /api/v1/auth/me`
6. `GET /api/v1/auth/csrf`
7. `GET /api/v1/users/me`
8. `GET /api/v1/users/:id`
9. `GET /api/v1/users`
10. `POST /api/v1/users/:id/roles`
11. `PUT /api/v1/users/:id/roles`
12. `DELETE /api/v1/users/:id/roles/:role`
13. `POST /api/v1/users/:id/unlock`
14. `GET /api/v1/zones`
15. `GET /api/v1/zones/:id`
16. `POST /api/v1/zones`
17. `PUT /api/v1/zones/:id`
18. `GET /api/v1/rooms`
19. `GET /api/v1/rooms/:id`
20. `POST /api/v1/rooms`
21. `PUT /api/v1/rooms/:id`
22. `GET /api/v1/business-hours`
23. `GET /api/v1/business-hours/effective`
24. `POST /api/v1/business-hours`
25. `DELETE /api/v1/business-hours/:id`
26. `GET /api/v1/reservations/availability`
27. `POST /api/v1/reservations`
28. `GET /api/v1/reservations`
29. `GET /api/v1/reservations/:id`
30. `POST /api/v1/reservations/:id/cancel`
31. `POST /api/v1/reservations/:id/check-in`
32. `GET /api/v1/favorites`
33. `POST /api/v1/favorites`
34. `DELETE /api/v1/favorites/:roomId`
35. `POST /api/v1/share-links`
36. `GET /api/v1/share-links/:token`
37. `DELETE /api/v1/share-links/:token`
38. `GET /api/v1/notifications`
39. `GET /api/v1/notifications/unread-count`
40. `PUT /api/v1/notifications/:id/read`
41. `PUT /api/v1/notifications/read-all`
42. `GET /api/v1/audit-logs`
43. `GET /api/v1/audit-logs/verify`
44. `POST /api/v1/leads`
45. `GET /api/v1/leads`
46. `GET /api/v1/leads/:id`
47. `PUT /api/v1/leads/:id/status`
48. `POST /api/v1/leads/:id/notes`
49. `GET /api/v1/leads/:id/notes`
50. `GET /api/v1/leads/:id/history`
51. `POST /api/v1/leads/:id/attachments`
52. `GET /api/v1/leads/:id/attachments`
53. `GET /api/v1/leads/:id/attachments/:attachmentId/download`
54. `POST /api/v1/reviews`
55. `GET /api/v1/reviews`
56. `GET /api/v1/reviews/:id`
57. `PUT /api/v1/reviews/:id`
58. `POST /api/v1/reviews/:id/media`
59. `GET /api/v1/reviews/:id/media`
60. `GET /api/v1/reviews/:id/media/:mediaId/download`
61. `POST /api/v1/reviews/:id/feature`
62. `POST /api/v1/qa-threads`
63. `GET /api/v1/qa-threads`
64. `GET /api/v1/qa-threads/:id`
65. `POST /api/v1/qa-threads/:id/posts`
66. `GET /api/v1/qa-threads/:id/posts`
67. `PUT /api/v1/qa-threads/:id/pin`
68. `PUT /api/v1/qa-threads/:id/collapse`
69. `POST /api/v1/moderation/reports`
70. `GET /api/v1/moderation/reports`
71. `PUT /api/v1/moderation/reports/:id`
72. `POST /api/v1/moderation/appeals`
73. `GET /api/v1/moderation/appeals`
74. `PUT /api/v1/moderation/appeals/:id`
75. `PUT /api/v1/moderation/content-state`
76. `GET /api/v1/membership/me`
77. `GET /api/v1/membership/members`
78. `GET /api/v1/membership/tiers`
79. `POST /api/v1/membership/tiers`
80. `PUT /api/v1/membership/tiers/:id`
81. `PUT /api/v1/membership/assign`
82. `POST /api/v1/wallet/topup`
83. `POST /api/v1/wallet/spend`
84. `POST /api/v1/wallet/refund`
85. `POST /api/v1/wallet/redeem-points`
86. `GET /api/v1/wallet/balance`
87. `GET /api/v1/wallet/ledger`
88. `POST /api/v1/wallet/disputes`
89. `GET /api/v1/wallet/disputes`
90. `PUT /api/v1/wallet/disputes/:id`
91. `GET /api/v1/blacklist`
92. `POST /api/v1/blacklist`
93. `POST /api/v1/blacklist/:userId/clear`
94. `GET /api/v1/analytics/booking-conversion`
95. `GET /api/v1/analytics/attendance-rate`
96. `GET /api/v1/analytics/noshow-rate`
97. `GET /api/v1/analytics/peak-utilization`
98. `GET /api/v1/analytics/offpeak-utilization`
99. `GET /api/v1/analytics/policy-impact`
100. `GET /api/v1/analytics/snapshots`
101. `POST /api/v1/exports`
102. `GET /api/v1/exports`
103. `GET /api/v1/exports/:id`
104. `GET /api/v1/exports/:id/download`
105. `POST /api/v1/vision/detect`
106. `POST /api/v1/vision/recognize`
107. `GET /api/v1/vision/cameras`
108. `POST /api/v1/vision/cameras`
109. `PUT /api/v1/vision/cameras/:id`
110. `GET /api/v1/vision/events`
111. `POST /api/v1/vision/enroll`
112. `GET /api/v1/vision/enrollments/:userId`
113. `DELETE /api/v1/vision/enrollments/:userId`
114. `GET /api/v1/policies`
115. `GET /api/v1/policies/:id`
116. `POST /api/v1/policies`

## API Test Mapping Table

The full route-by-route mapping remains complete from the prior audit state. Static evidence still indicates that all `116/116` endpoints have matching HTTP tests in `apps/api/tests/integration/*`.

Representative mappings:

| Endpoint | Covered | Test type | Test files | Evidence |
|---|---|---|---|---|
| `POST /api/v1/auth/register` | yes | true no-mock HTTP | `apps/api/tests/integration/auth.test.ts` | `auth.test.ts` register suite |
| `GET /api/v1/rooms` | yes | true no-mock HTTP | `apps/api/tests/integration/rooms.test.ts`, `apps/api/tests/integration/fullstack.test.ts` | direct `request(app).get('/api/v1/rooms')` |
| `POST /api/v1/reservations` | yes | true no-mock HTTP | `apps/api/tests/integration/reservation.test.ts`, `apps/api/tests/integration/fullstack.test.ts` | direct `request(app).post('/api/v1/reservations')` |
| `GET /api/v1/analytics/snapshots` | yes | true no-mock HTTP | `apps/api/tests/integration/analytics.test.ts` | direct `request(app).get('/api/v1/analytics/snapshots')` |
| `POST /api/v1/exports` | yes | true no-mock HTTP | `apps/api/tests/integration/export.test.ts` | direct `request(app).post('/api/v1/exports')` |
| `POST /api/v1/vision/enroll` | yes | true no-mock HTTP | `apps/api/tests/integration/vision.test.ts` | direct `request(app).post('/api/v1/vision/enroll')` |
| `GET /api/v1/policies` | yes | true no-mock HTTP | `apps/api/tests/integration/policy.test.ts`, `apps/api/tests/integration/fullstack.test.ts` | direct `request(app).get('/api/v1/policies')` |

## API Test Classification

### 1. True No-Mock HTTP

- Static bootstrap evidence remains real-app HTTP:
  - `apps/api/tests/setup.ts` bootstraps the real DB and `createApp()`.
  - Integration suites import `request` from `supertest` and send requests through the app.
- Files in this class include:
  - `apps/api/tests/integration/auth.test.ts`
  - `apps/api/tests/integration/rooms.test.ts`
  - `apps/api/tests/integration/reservation.test.ts`
  - `apps/api/tests/integration/review.test.ts`
  - `apps/api/tests/integration/qa.test.ts`
  - `apps/api/tests/integration/moderation.test.ts`
  - `apps/api/tests/integration/membership.test.ts`
  - `apps/api/tests/integration/wallet.test.ts`
  - `apps/api/tests/integration/dispute.test.ts`
  - `apps/api/tests/integration/analytics.test.ts`
  - `apps/api/tests/integration/export.test.ts`
  - `apps/api/tests/integration/vision.test.ts`
  - plus the remaining integration suites that use the same pattern.

### 2. HTTP With Mocking

- None found in the API HTTP suites by static inspection.

### 3. Non-HTTP

- `apps/api/tests/integration/auditImmutability.test.ts`
- `apps/api/tests/integration/configValidation.test.ts`
- `apps/api/tests/integration/notificationTtl.test.ts`
- `apps/api/tests/integration/retention.test.ts`
- All files under `apps/api/tests/unit/*`

## Mock Detection Rules

### API Suite

- No mocking found in the route-level HTTP integration suites.
- Unit tests intentionally mock internals, for example:
  - `apps/api/tests/unit/service.audit.test.ts:21`
  - `apps/api/tests/unit/service.businessHours.test.ts:40`
  - `apps/api/tests/unit/service.analytics.test.ts:34`
  - `apps/api/tests/unit/service.export.test.ts:45`
  - `apps/api/tests/unit/service.dispute.test.ts:29`

### Frontend Suite

- Frontend unit/component tests are mock-heavy. Examples:
  - `apps/web/tests/DashboardPage.test.tsx:10`
  - `apps/web/tests/LoginPage.test.tsx:8`
  - `apps/web/tests/RegisterPage.test.tsx:11`
  - `apps/web/tests/RoomsPage.test.tsx:13`
  - `apps/web/tests/ReservationsPage.test.tsx:12`
  - `apps/web/tests/ReviewsPage.test.tsx:10`
  - `apps/web/tests/FavoritesPage.test.tsx:11`
  - `apps/web/tests/NotificationsPage.test.tsx:11`
  - `apps/web/tests/SharedReservationPage.test.tsx:10`
  - `apps/web/tests/admin/ExportsPage.test.tsx:11`
  - `apps/web/tests/admin/PoliciesPage.test.tsx:11`
  - `apps/web/tests/admin/ZoneManagementPage.test.tsx:12`
- Verdict: these tests count as frontend unit/component tests, not as true API coverage.

## Coverage Summary

- Total endpoints: `116`
- Endpoints with HTTP tests: `116`
- Endpoints with true no-mock HTTP tests: `116`
- HTTP coverage: `100%`
- True API coverage: `100%`

## Unit Test Summary

### Backend Unit Tests

- Dedicated backend unit-test directory present: `apps/api/tests/unit/`
- Backend unit files:
  - `middleware.auth.test.ts`
  - `middleware.csrf.test.ts`
  - `service.analytics.test.ts`
  - `service.audit.test.ts`
  - `service.blacklist.test.ts`
  - `service.businessHours.test.ts`
  - `service.dispute.test.ts`
  - `service.export.test.ts`
  - `service.lead.test.ts`
  - `service.membership.test.ts`
  - `service.moderation.test.ts`
  - `service.qa.test.ts`
  - `service.reservation.test.ts`
  - `service.review.test.ts`
  - `service.wallet.test.ts`
- Modules covered:
  - middleware: auth, csrf
  - services: analytics, audit, blacklist, business hours, dispute, export, lead, membership, moderation, qa, reservation, review, wallet
- Important backend modules still not directly unit-tested:
  - `apps/api/src/services/auth.service.ts`
  - `apps/api/src/services/room.service.ts`
  - `apps/api/src/services/session.service.ts`
  - `apps/api/src/services/reputation.service.ts`
  - `apps/api/src/services/attachment.service.ts`
  - `apps/api/src/services/zone.service.ts`

### Frontend Unit Tests

- Frontend unit tests: PRESENT
- Frameworks/tools detected:
  - Vitest in `apps/web/package.json`
  - React Testing Library in `apps/web/package.json`
  - Vitest config in `apps/web/vitest.config.ts`
- Frontend test files include:
  - top-level: `DashboardPage`, `FavoritesPage`, `LeadsPage`, `LoginPage`, `NotificationsPage`, `RegisterPage`, `ReservationsPage`, `ReviewsPage`, `RoomsPage`, `SharedReservationPage`, `ProtectedRoute`, `VisionEnrollment`
  - admin/staff coverage under `apps/web/tests/admin/*`
- Components/modules covered:
  - every current page under `apps/web/src/pages/`
  - `apps/web/src/components/ProtectedRoute.tsx`
- Important frontend components/modules not directly unit-tested:
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/Layout.tsx`
  - `apps/web/src/contexts/AuthContext.tsx` real provider behavior

### Mandatory Verdict

- Frontend unit tests: PRESENT

### Cross-Layer Observation

- Testing is now much more balanced than the earlier backend-heavy state.
- Backend HTTP coverage is exhaustive.
- Backend unit coverage is broad.
- Frontend unit coverage is broad.
- Frontend cross-layer coverage exists, but it is still HTTP-contract style rather than real browser automation.

## API Observability Check

- Strong:
  - endpoint methods and paths are explicit in API integration suites and web E2E suites.
  - request bodies, params, and queries are visible in `.send(...)` and `.query(...)`.
  - response assertions typically validate status plus meaningful payload shape.
- Weak:
  - `GET /api/v1/auth/csrf` is often setup plumbing rather than a standalone contract focus.
  - vision tests still emphasize reachability and proxy boundary behavior more than proven successful worker-backed business output.

## Tests Check

- `run_tests.sh` is Docker-based and acceptable.
- Current runner structure:
  - `run_api_tests()` runs API tests in Docker.
  - `run_web_tests()` runs frontend unit tests in Docker.
  - `run_e2e_tests()` runs web E2E tests in Docker.
  - `all` runs all three layers and accumulates failures before exiting.
- Evidence: `run_tests.sh`

## Test Quality & Sufficiency

- Strengths:
  - exact API route coverage remains complete
  - backend integration depth is strong across auth, RBAC, validation, moderation, wallet, analytics, audit, export, and vision
  - backend unit layer now covers many business-rule-heavy services
  - frontend unit coverage now spans all current page surfaces
  - frontend E2E contract suites now cover auth, browsing, reservations, admin, community, moderation, policy/blacklist, reviews, and wallet
- Weaknesses:
  - web “E2E” is still not browser automation
  - frontend unit tests remain mock-heavy
  - some core app-shell behavior is not directly unit-tested
  - vision happy-path validation still appears weaker than other domains

## End-to-End Expectations

- Expected for `fullstack`: real FE ↔ BE tests.
- Found:
  - broad cross-layer HTTP-contract tests in `apps/web/tests/e2e/*`
  - these boot the real Express app in `apps/web/tests/e2e/setup.ts`
  - they use `supertest`, not a browser
- Final E2E assessment:
  - present as real-app HTTP contract coverage
  - not present as browser-driven end-to-end coverage

## Test Coverage Score (0–100)

- Score: `97/100`

## Score Rationale

- Positive weight:
  - `116/116` endpoints still have exact HTTP coverage by static evidence
  - API route tests remain true no-mock HTTP by static inspection
  - backend unit suite is now broad
  - frontend unit suite now covers all current pages
  - frontend cross-layer suite is broad and wired into `run_tests.sh all`
- Negative weight:
  - no browser-driven Playwright/Cypress-style FE ↔ BE automation
  - frontend unit tests still rely heavily on mocks
  - a few non-page frontend foundations remain untested directly

## Key Gaps

- No real browser-level end-to-end suite.
- Frontend component tests are still mock-heavy rather than boundary-integrated.
- `App`, `Layout`, and real `AuthContext` provider behavior are not directly unit-tested.
- Vision validation is still less convincing than the rest of the platform for successful downstream business behavior.

## Confidence & Assumptions

- Confidence: high.
- Assumptions:
  - route inventory from the prior full mapping remains valid because route mounts and route set were not re-audited as changed in this update cycle
  - API integration suites still use the same real-app pattern via `apps/api/tests/setup.ts`
  - static inspection cannot prove runtime worker availability for vision success paths

# README Audit

## README Location

- Found at `README.md`.

## Hard Gate Review

### Formatting

- Pass.
- Evidence: structured markdown with headings, tables, code fences, and verification steps in `README.md`.

### Startup Instructions

- Pass.
- Required command present: `docker-compose up` in `README.md`.
- Docker-first startup path remains documented.

### Access Method

- Pass.
- Web/API URLs and ports are documented in `README.md`.

### Verification Method

- Pass.
- README includes concrete ways to confirm the system works.

### Environment Rules

- Pass.
- No required `npm install`, `pip install`, `apt-get`, or manual DB setup steps were previously identified in README.

### Demo Credentials

- Pass.
- Auth credentials / auth guidance were already documented sufficiently for the prior PASS state.

## Engineering Quality

- Tech stack clarity: good
- Architecture explanation: adequate
- Testing instructions: present
- Security/roles: present
- Workflow clarity: good
- Presentation quality: good

## High Priority Issues

- None found by static inspection in the README.

## Medium Priority Issues

- None material enough to change the verdict.

## Low Priority Issues

- README could be tightened further if desired, but no current hard-gate issue was identified.

## Hard Gate Failures

- None.

## README Verdict

- PASS
