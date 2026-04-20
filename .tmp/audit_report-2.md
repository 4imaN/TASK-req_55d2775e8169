# StudyRoomOps Static Delivery Acceptance & Architecture Audit

## 1. Verdict

- Overall conclusion: **Partial Pass**

The repository is a real multi-module full-stack delivery that maps closely to the StudyRoomOps prompt, but the static audit found one booking-integrity blocker and several high-severity contract/reliability defects in explicit prompt flows. Static evidence is also insufficient to confirm some runtime-only claims such as HTTPS deployment, vision-worker behavior, and full UI rendering quality.

## 2. Scope and Static Verification Boundary

- Reviewed: documentation, env/config, route registration, auth/session/CSRF middleware, reservation/lead/community/membership/export/vision services and routes, representative frontend pages, and all checked-in API/frontend tests (`README.md:7-171`, `apps/api/src/app.ts:10-103`, `apps/api/tests/integration/*`, `apps/web/tests/*`).
- Not reviewed: runtime container behavior, browser rendering, Docker/network setup, camera/OpenCV execution, Mongo replica-set behavior under real load.
- Intentionally not executed: project startup, Docker, tests, external services, browsers, and any runtime verification per audit boundary.
- Manual verification required for: local HTTPS behavior, live conflict handling under concurrent kiosks, actual camera/device integration, file-upload UX, and end-to-end frontend rendering.

## 3. Repository / Requirement Mapping Summary

- Prompt core goal: a staff-operated local-network portal covering reservation booking/conflict handling, favorites/share links, reviews/Q&A/moderation, lead intake with attachments and status workflow, roles/RBAC, reminders, wallet/membership/reporting, and local face-oversight with encrypted embeddings and retention.
- Main implementation areas mapped: Express API with separate route/service layers, React SPA with role-gated pages, Mongo collections/index bootstrap, Python vision worker, shared policy/types packages, and API/frontend test suites (`README.md:84-113`, `apps/api/src/app.ts:77-99`, `apps/web/src/App.tsx:45-85`).
- The codebase is materially aligned with the prompt, but a few explicit flows are broken or only partially evidenced.

## 4. Section-by-section Review

### 4.1 Hard Gates

#### 1.1 Documentation and static verifiability

- Conclusion: **Partial Pass**
- Rationale: The repo includes a clear README, architecture summary, env example, assumptions, and test commands, so a reviewer can statically navigate the system. However, startup and verification are documented almost entirely through Docker/manual runtime steps, which this audit cannot execute, and many verification steps depend on seeded live services rather than static proofs.
- Evidence: `README.md:7-82`, `README.md:84-113`, `README.md:146-167`, `ASSUMPTIONS.md:1-69`, `apps/api/jest.config.js:1-11`, `apps/web/vitest.config.ts:1-10`
- Manual verification note: Docker-based startup, seeded data, HTTPS, and vision-worker integration remain manual.

#### 1.2 Material deviation from the Prompt

- Conclusion: **Pass**
- Rationale: The implementation centers on the prompt’s business domain rather than an unrelated sample. Reservation slices/conflict handling, leads, moderation/appeals, membership/wallet, exports, and vision oversight are all present as first-class modules.
- Evidence: `README.md:160-167`, `apps/api/src/app.ts:77-99`, `apps/web/src/App.tsx:51-81`

### 4.2 Delivery Completeness

#### 2.1 Core requirement coverage

- Conclusion: **Partial Pass**
- Rationale: Most explicit requirements are implemented, including local accounts, room browsing, 15-minute slots, conflict alternatives, favorites/share links, review/Q&A/moderation, role separation, lead workflow, reminders, wallet/points/blacklist, analytics/exports, and vision endpoints. But one reservation-integrity defect breaks the prompt’s strong-consistency requirement, and the admin vision enrollment flow is statically miswired. Attachment/photo-review flows also do not reliably surface upload failure.
- Evidence: `apps/api/src/services/reservation.service.ts:195-244`, `apps/api/src/services/reservation.service.ts:404-425`, `apps/api/src/routes/vision.routes.ts:319-352`, `apps/web/src/pages/admin/VisionPage.tsx:230-235`, `apps/web/src/pages/LeadsPage.tsx:154-170`, `apps/web/src/pages/ReviewsPage.tsx:212-229`
- Manual verification note: Real kiosk concurrency and upload/browser behavior require runtime checks.

#### 2.2 Basic end-to-end deliverable vs partial example

- Conclusion: **Partial Pass**
- Rationale: The repo is a full product-shaped monorepo with API, frontend, vision worker, shared packages, scripts, docs, and tests. It is not a code fragment. Still, several core UI-to-API paths are incomplete or fragile enough that the end-to-end deliverable is not acceptance-safe.
- Evidence: `README.md:84-95`, `apps/api/src/app.ts:10-103`, `apps/web/src/App.tsx:6-30`, `README.md:160-167`

### 4.3 Engineering and Architecture Quality

#### 3.1 Engineering structure and module decomposition

- Conclusion: **Pass**
- Rationale: The project uses sensible decomposition by app, route, service, shared policy, and shared types. Core domains are separated instead of being collapsed into a single file.
- Evidence: `README.md:86-95`, `apps/api/src/app.ts:10-103`, `apps/web/src/App.tsx:6-30`

#### 3.2 Maintainability and extensibility

- Conclusion: **Partial Pass**
- Rationale: Many services are reasonably isolated and policy-driven, but there are frontend/backend contract mismatches and retention/immutability claims that are only partially enforced. Those reduce confidence in extension safety.
- Evidence: `ASSUMPTIONS.md:24-52`, `apps/api/src/services/audit.service.ts:32-63`, `apps/api/src/config/db.ts:195-199`, `apps/web/src/pages/staff/LeadManagementPage.tsx:37-42`, `apps/api/src/services/lead.service.ts:427-435`

### 4.4 Engineering Details and Professionalism

#### 4.1 Error handling, logging, validation, API design

- Conclusion: **Partial Pass**
- Rationale: The API has auth/session middleware, CSRF, structured error responses, request IDs, validation, and meaningful route protections. However, critical booking cancellation is not atomic, production-secret validation only logs warnings, and some frontend flows swallow upload failures instead of reporting them.
- Evidence: `apps/api/src/middleware/auth.ts:15-76`, `apps/api/src/app.ts:61-70`, `apps/api/src/middleware/errorHandler.ts:11-55`, `apps/api/src/utils/response.ts:15-31`, `apps/api/src/config/index.ts:59-76`, `apps/api/src/services/reservation.service.ts:404-425`, `apps/web/src/pages/LeadsPage.tsx:161-170`, `apps/web/src/pages/ReviewsPage.tsx:221-229`

#### 4.2 Product/service quality vs demo level

- Conclusion: **Partial Pass**
- Rationale: The repository looks like a real internal product rather than a toy demo, with multiple business modules and admin/staff surfaces. The remaining blocker/high issues prevent treating it as acceptance-ready.
- Evidence: `README.md:160-167`, `apps/web/src/App.tsx:51-81`, `apps/web/src/components/Layout.tsx:21-45`

### 4.5 Prompt Understanding and Requirement Fit

#### 5.1 Business-goal understanding and semantic fit

- Conclusion: **Partial Pass**
- Rationale: The repository shows strong prompt understanding overall. The main semantic miss is that the prompt’s “strong consistency so two kiosks cannot book the same seat” is undermined by a cancellation path that can release slices before the reservation state update succeeds.
- Evidence: `apps/api/src/services/reservation.service.ts:195-244`, `apps/api/src/config/db.ts:77-81`, `apps/api/src/services/reservation.service.ts:404-425`

### 4.6 Aesthetics

#### 6.1 Visual and interaction quality

- Conclusion: **Cannot Confirm Statistically**
- Rationale: Static code shows differentiated sections, protected navigation, tables, modals, badges, filters, pagination, and copy-to-clipboard interactions, which suggests a structured UI. Actual rendering quality, spacing consistency, hover/click polish, responsive behavior, and visual correctness cannot be proven without running the frontend.
- Evidence: `apps/web/src/components/Layout.tsx:9-67`, `apps/web/src/pages/ReservationsPage.tsx:164-292`, `apps/web/src/pages/RoomsPage.tsx:500-558`, `apps/web/src/pages/staff/ModerationPage.tsx:151-220`
- Manual verification note: Browser-based review required.

## 5. Issues / Suggestions (Severity-Rated)

### Blocker

- Severity: **Blocker**
- Title: Reservation cancellation can release capacity before version-guarded update succeeds
- Conclusion: **Fail**
- Evidence: `apps/api/src/services/reservation.service.ts:404-425`
- Impact: The service deletes future reservation slices first, then performs the optimistic-concurrency update. If the update loses its version race, the reservation remains active while the slices are already removed, reopening the slot and violating the prompt’s strong-consistency requirement.
- Minimum actionable fix: Move cancellation state change and slice release into a single transaction, or update the reservation with the version guard first and only release slices in the same atomic unit after the status change succeeds.

### High

- Severity: **High**
- Title: Vision enrollment UI sends the wrong consent contract to the API
- Conclusion: **Fail**
- Evidence: `apps/api/src/routes/vision.routes.ts:319-352`, `apps/web/src/pages/admin/VisionPage.tsx:230-235`
- Impact: The API requires `consent_metadata.consent_given`, while the UI sends `{ given: true, recordedAt: ... }`. Static evidence shows the admin biometric enrollment flow will be rejected.
- Minimum actionable fix: Align frontend payload keys with the backend contract and include the actor/timestamp fields expected by the API and audit log.

- Severity: **High**
- Title: Lead attachments can fail silently after the UI reports success
- Conclusion: **Fail**
- Evidence: `apps/web/src/pages/LeadsPage.tsx:150-170`
- Impact: Local file attachments are an explicit prompt requirement. The page marks the request successful before uploads finish, ignores non-2xx responses, and swallows exceptions, so staff/users can believe attachments were stored when they were not.
- Minimum actionable fix: Check each attachment response, surface partial-failure state, and avoid reporting full success until uploads are confirmed or clearly marked partial.

- Severity: **High**
- Title: Review photo uploads can fail silently after the UI reports success
- Conclusion: **Fail**
- Evidence: `apps/web/src/pages/ReviewsPage.tsx:210-231`
- Impact: Photo reviews are an explicit prompt flow. The code creates the review first, then performs a raw fetch for media without checking response status and treats all upload failures as non-fatal, so users can receive “Review submitted!” without the photos actually being stored.
- Minimum actionable fix: Validate media upload responses and show explicit partial-success or rollback behavior when uploads fail.

### Medium

- Severity: **Medium**
- Title: Lead history API and staff UI use incompatible field names
- Conclusion: **Fail**
- Evidence: `apps/web/src/pages/staff/LeadManagementPage.tsx:37-42`, `apps/api/src/services/lead.service.ts:427-435`
- Impact: The staff page expects `note` and `changedAt`, while the service returns `quoteAmountCents`, `closeReason`, and `createdAt`. Status history rendering is likely incomplete or incorrect.
- Minimum actionable fix: Unify the DTO shape between the service and the frontend component, and add tests for rendered lead history details.

- Severity: **Medium**
- Title: Notification retention is implemented by scheduled deletion rather than durable TTL enforcement
- Conclusion: **Partial Fail**
- Evidence: `apps/api/src/config/db.ts:195-199`, `apps/api/src/routes/notification.routes.ts:93-106`, `apps/api/src/jobs/retentionJobs.ts:55-75`
- Impact: Notifications store an `expiresAt` field, but no TTL index exists. Retention depends on the scheduler running reliably, which is weaker than the prompt/assumption’s retention posture and weaker than the face-event TTL approach.
- Minimum actionable fix: Add a Mongo TTL index on the appropriate notification expiry field and keep the scheduled cleanup only as a backstop.

- Severity: **Medium**
- Title: Audit logs are tamper-evident but not statically proven immutable
- Conclusion: **Partial Fail**
- Evidence: `README.md:108-110`, `ASSUMPTIONS.md:39`, `apps/api/src/services/audit.service.ts:32-63`, `apps/api/src/services/audit.service.ts:80-112`
- Impact: The implementation provides hash-chaining and verification, which is useful, but static evidence does not show append-only database controls or immutability guarantees matching the prompt’s “immutable operation audit logs”.
- Minimum actionable fix: Enforce append-only behavior at the persistence layer or operational policy level and document the immutability mechanism explicitly.

- Severity: **Medium**
- Title: Production secret validation only warns instead of hard-failing insecure startup
- Conclusion: **Partial Fail**
- Evidence: `apps/api/src/config/index.ts:59-76`
- Impact: In production mode, default/weak secrets produce warnings only. This weakens the stated security posture for JWT/CSRF/encryption configuration.
- Minimum actionable fix: Fail startup in production when default insecure secrets are detected.

### Low

- Severity: **Low**
- Title: Reservation notes are exposed in the UI but not persisted by the API
- Conclusion: **Fail**
- Evidence: `apps/web/src/pages/RoomsPage.tsx:539-546`, `apps/web/src/pages/ReservationsPage.tsx:262`, `apps/api/src/routes/reservation.routes.ts:37-44`
- Impact: The user sees a reservation-notes field and a detail view that expects `selected.notes`, but the reservation create API does not accept/store notes. This is misleading, although notes were not an explicit prompt requirement.
- Minimum actionable fix: Either persist reservation notes end-to-end or remove the field from the UI.

## 6. Security Review Summary

- Authentication entry points: **Pass**. Cookie-backed session validation is centralized in auth middleware, and protected routes reject missing/invalid sessions (`apps/api/src/middleware/auth.ts:15-35`, `apps/api/tests/integration/auth.test.ts:192-219`).
- Route-level authorization: **Partial Pass**. Role gates are explicit and broadly applied across staff/admin routes, with RBAC tests for key admin/staff endpoints (`apps/api/src/middleware/auth.ts:38-76`, `apps/api/src/app.ts:77-99`, `apps/api/tests/integration/rbac.test.ts:209-228`). Coverage is not comprehensive for every privileged route.
- Object-level authorization: **Partial Pass**. Several sensitive resources enforce owner-or-staff checks, including reservations, leads, reviews, Q&A, and attachments (`apps/api/src/routes/reservation.routes.ts:140-145`, `apps/api/src/services/lead.service.ts:365-372`, `apps/api/src/services/review.service.ts:88-103`, `apps/api/src/services/qa.service.ts:64-75`, `apps/api/src/services/attachment.service.ts:98-105`). Test coverage for cross-user negative cases is limited.
- Function-level authorization: **Partial Pass**. Service logic enforces semantic restrictions such as reviewing only one’s own checked-in reservations and appealing only one’s own moderated content (`apps/api/src/services/review.service.ts:88-103`, `apps/api/src/services/moderation.service.ts:242-273`). Static tests cover some, not all, of these checks.
- Tenant / user data isolation: **Partial Pass**. Per-user lead and reservation access checks exist (`apps/api/src/services/lead.service.ts:365-372`, `apps/api/src/routes/reservation.routes.ts:140-145`), but the checked-in test suite does not provide broad cross-user isolation coverage across attachments, share links, and moderation objects.
- Admin / internal / debug protection: **Pass**. Admin/staff pages and routes are explicitly role-gated, and there are no obvious unauthenticated debug endpoints in the inspected route registration (`apps/web/src/App.tsx:60-77`, `apps/api/src/app.ts:77-99`, `apps/api/tests/integration/rbac.test.ts:209-228`).

## 7. Tests and Logging Review

- Unit tests: **Fail**. No dedicated unit-test suite was found; the checked-in backend tests are integration-style Jest tests, and the frontend tests are shallow component tests (`apps/api/jest.config.js:1-11`, `apps/api/tests/integration/*.test.ts`, `apps/web/tests/*.test.tsx`).
- API / integration tests: **Partial Pass**. Integration tests exist for auth, RBAC, reservations, leads, moderation, reviews, wallet, analytics, exports, and retention, but there are no checked-in tests for vision, notifications, membership admin flows, disputes, blacklist management, or cross-user authorization edge cases (`apps/api/tests/integration/auth.test.ts`, `apps/api/tests/integration/reservation.test.ts`, `apps/api/tests/integration/lead.test.ts`, `apps/api/tests/integration/moderation.test.ts`, `apps/api/tests/integration/wallet.test.ts`, `apps/api/tests/integration/export.test.ts`, `apps/api/tests/integration/analytics.test.ts`, `apps/api/tests/integration/retention.test.ts`, `find apps/api/tests/integration -maxdepth 1 -type f` inventory).
- Logging categories / observability: **Partial Pass**. The app uses request IDs, structured logger helpers, morgan access logs, and structured error responses/logging (`apps/api/src/app.ts:61-70`, `apps/api/src/utils/logger.ts:17-38`, `apps/api/src/middleware/errorHandler.ts:11-21`, `apps/api/src/utils/response.ts:3-31`).
- Sensitive-data leakage risk in logs / responses: **Partial Pass**. Audit values redact password/token/embedding fields before storage, and error logging avoids request bodies (`apps/api/src/services/audit.service.ts:58-77`, `apps/api/src/middleware/errorHandler.ts:11-21`). Static review did not find obvious response-body leaks, but console/error usage is not fully standardized.

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview

- Unit tests and API/frontend tests exist, but the backend suite is integration-only and depends on a live Mongo URI (`apps/api/jest.config.js:1-11`, `apps/api/tests/setup.ts:9-29`).
- Backend framework: Jest + ts-jest (`apps/api/jest.config.js:1-11`).
- Frontend framework: Vitest + jsdom (`apps/web/vitest.config.ts:1-10`).
- Test entry points are documented only via the Docker wrapper script, not native local commands (`README.md:71-82`).
- Checked-in API test files: auth, analytics, export, lead, moderation, RBAC, reservation, retention, review, wallet (`find apps/api/tests/integration -maxdepth 1 -type f` inventory).
- Checked-in frontend test files: login, protected route, reservations page, rooms page (`find apps/web/tests -maxdepth 1 -type f` inventory).

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Registration/login/session/CSRF | `apps/api/tests/integration/auth.test.ts:28-219` | Rejects missing CSRF and unauthenticated protected access (`apps/api/tests/integration/auth.test.ts:177-219`) | basically covered | No idle/absolute expiry path coverage | Add session-expiry and revoked-session API tests |
| RBAC on admin/staff routes | `apps/api/tests/integration/rbac.test.ts:72-228` | Creator/admin allowed, regular/moderator denied on selected routes; audit route 403/200 (`apps/api/tests/integration/rbac.test.ts:209-228`) | basically covered | Many privileged routes remain untested | Add coverage for analytics/export/vision/membership/dispute/blacklist routes |
| Reservation creation, conflict feedback, alternatives, idempotency | `apps/api/tests/integration/reservation.test.ts:131-299` | 201 create, 409 conflict, alternatives property, invalid alignment/business hours, idempotency reuse (`apps/api/tests/integration/reservation.test.ts:150-283`) | sufficient | Does not test concurrent cancellation/update races | Add transaction/race regression test for cancel/check-in/version conflicts |
| Reservation cancel/check-in | `apps/api/tests/integration/reservation.test.ts:302-337` | Owner cancel happy path and check-in path only (`apps/api/tests/integration/reservation.test.ts:302-337`) | insufficient | No negative/cross-user/version-conflict coverage; blocker bug would pass | Add tests for stale-version cancel, cross-user cancel, staff reason requirement |
| Lead workflow and attachments | `apps/api/tests/integration/lead.test.ts:88-322` | Required-field checks, valid transition chain, internal notes hidden from users, attachment upload/list (`apps/api/tests/integration/lead.test.ts:184-318`, `apps/api/tests/integration/lead.test.ts:321-322`) | basically covered | No tests for attachment failure reporting or cross-user attachment access | Add owner-vs-nonowner attachment auth and frontend upload-failure tests |
| Reviews and moderation | `apps/api/tests/integration/review.test.ts:123-307`, `apps/api/tests/integration/moderation.test.ts:94-278` | Checked-in-only review, duplicate prevention, removed review visibility, report/appeal lifecycle (`apps/api/tests/integration/review.test.ts:124-214`, `apps/api/tests/integration/moderation.test.ts:238-278`) | basically covered | No frontend tests for photo-upload success/failure or pinned/collapsed thread behavior | Add API/media tests plus UI tests for upload error handling and moderation actions |
| Wallet, points, daily risk limit | `apps/api/tests/integration/wallet.test.ts:75-338` | Balance changes, idempotency, insufficient balance, daily limit, 100-point blocks, ledger persistence (`apps/api/tests/integration/wallet.test.ts:220-245`, `apps/api/tests/integration/wallet.test.ts:249-316`) | sufficient | No dispute/blacklist admin coverage in same domain | Add dispute and blacklist workflow tests |
| Analytics and exports | `apps/api/tests/integration/analytics.test.ts:74-174`, `apps/api/tests/integration/export.test.ts:75-267` | Admin-only access, filtered analytics, export processing/download with file hash (`apps/api/tests/integration/analytics.test.ts:120-174`, `apps/api/tests/integration/export.test.ts:184-245`) | basically covered | No verification of PII minimization in CSV contents | Add assertions on CSV columns/content policy |
| Vision enrollment/oversight | No checked-in vision tests in API or web inventories | N/A | missing | Broken UI/API contract is undetected by tests | Add API contract tests and frontend integration test for enrollment payload |
| Notifications/SLA reminders | No checked-in notification tests in API or web inventories | N/A | missing | Reminder creation, retention, and read/unread behavior are untested | Add API tests for notification creation/listing/read state and retention behavior |

### 8.3 Security Coverage Audit

- Authentication: **Basically covered**. Auth tests cover registration, login, missing CSRF, valid-session access, and unauthenticated 401s (`apps/api/tests/integration/auth.test.ts:28-219`).
- Route authorization: **Basically covered** for selected routes only. RBAC tests cover zones/rooms/audit, but not the full privileged route surface (`apps/api/tests/integration/rbac.test.ts:72-228`).
- Object-level authorization: **Insufficient**. The code contains owner checks, but the tests do not broadly exercise cross-user failures on reservations, leads, attachments, share links, and Q&A.
- Tenant / data isolation: **Insufficient**. User-vs-staff lead note visibility is tested (`apps/api/tests/integration/lead.test.ts:273-318`), but broad tenant-isolation regression coverage is missing.
- Admin / internal protection: **Basically covered** for a subset of endpoints via RBAC and export/analytics tests (`apps/api/tests/integration/rbac.test.ts:209-228`, `apps/api/tests/integration/export.test.ts:93-171`, `apps/api/tests/integration/analytics.test.ts:174-174`). Severe defects could still remain on untested privileged routes such as vision or membership admin operations.

### 8.4 Final Coverage Judgment

- **Partial Pass**

Major business flows such as auth, reservations, leads, moderation, wallet, analytics, and exports have static test evidence. However, the uncovered areas are material: vision, notifications, several admin domains, and cross-user authorization edge cases. The current suites could still pass while severe defects remain in biometric enrollment, reminder retention, object-level access control, and the reservation cancellation race.

## 9. Final Notes

- The repository is materially aligned with the prompt and is not a superficial demo.
- The acceptance blockers are not about missing polish; they are about booking integrity and broken explicit flows.
- Runtime-only claims were intentionally not promoted beyond what the static evidence supports.
