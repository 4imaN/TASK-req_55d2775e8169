# Test Coverage Audit

## Project Type Detection
- Declared in README: `Project Type: Fullstack` ([README.md:1](README.md:1)).
- Effective type used for audit: `fullstack`.

## API Test Classification
1. **True No-Mock HTTP**
- Evidence of real app + HTTP path: [apps/api/tests/setup.ts:22](apps/api/tests/setup.ts:22), [apps/api/tests/setup.ts:28](apps/api/tests/setup.ts:28), [apps/web/tests/e2e/setup.ts:52](apps/web/tests/e2e/setup.ts:52), [apps/web/tests/e2e/setup.ts:95](apps/web/tests/e2e/setup.ts:95).
- Files: all `apps/api/tests/integration/*.test.ts` and `apps/web/tests/e2e/*.test.ts`.

2. **HTTP with Mocking**
- File: `apps/api/tests/integration/vision.test.ts` worker-mocked suite.
- Mocked dependency: `global.fetch` via `jest.spyOn(global, 'fetch')` at [apps/api/tests/integration/vision.test.ts:670](apps/api/tests/integration/vision.test.ts:670).
- Runtime config mutation for mocked worker path at [apps/api/tests/integration/vision.test.ts:647](apps/api/tests/integration/vision.test.ts:647), [apps/api/tests/integration/vision.test.ts:650](apps/api/tests/integration/vision.test.ts:650).

3. **Non-HTTP (Unit)**
- Files: `apps/api/tests/unit/*.test.ts` (service and middleware unit tests with mocked dependencies).

### Backend Endpoint Inventory
| Endpoint | Route Evidence |
|---|---|
| DELETE /api/v1/business-hours/:id | apps/api/src/routes/businessHours.routes.ts:76 |
| DELETE /api/v1/favorites/:roomId | apps/api/src/routes/favorites.routes.ts:38 |
| DELETE /api/v1/share-links/:token | apps/api/src/routes/shareLinks.routes.ts:42 |
| DELETE /api/v1/users/:id/roles/:role | apps/api/src/routes/user.routes.ts:124 |
| DELETE /api/v1/vision/enrollments/:userId | apps/api/src/routes/vision.routes.ts:415 |
| GET /api/v1/analytics/attendance-rate | apps/api/src/routes/analytics.routes.ts:71 |
| GET /api/v1/analytics/booking-conversion | apps/api/src/routes/analytics.routes.ts:56 |
| GET /api/v1/analytics/noshow-rate | apps/api/src/routes/analytics.routes.ts:86 |
| GET /api/v1/analytics/offpeak-utilization | apps/api/src/routes/analytics.routes.ts:116 |
| GET /api/v1/analytics/peak-utilization | apps/api/src/routes/analytics.routes.ts:101 |
| GET /api/v1/analytics/policy-impact | apps/api/src/routes/analytics.routes.ts:131 |
| GET /api/v1/analytics/snapshots | apps/api/src/routes/analytics.routes.ts:157 |
| GET /api/v1/audit-logs | apps/api/src/routes/audit.routes.ts:10 |
| GET /api/v1/audit-logs/verify | apps/api/src/routes/audit.routes.ts:46 |
| GET /api/v1/auth/csrf | apps/api/src/routes/auth.routes.ts:121 |
| GET /api/v1/auth/me | apps/api/src/routes/auth.routes.ts:107 |
| GET /api/v1/blacklist | apps/api/src/routes/blacklist.routes.ts:10 |
| GET /api/v1/business-hours | apps/api/src/routes/businessHours.routes.ts:15 |
| GET /api/v1/business-hours/effective | apps/api/src/routes/businessHours.routes.ts:33 |
| GET /api/v1/exports | apps/api/src/routes/export.routes.ts:33 |
| GET /api/v1/exports/:id | apps/api/src/routes/export.routes.ts:50 |
| GET /api/v1/exports/:id/download | apps/api/src/routes/export.routes.ts:66 |
| GET /api/v1/favorites | apps/api/src/routes/favorites.routes.ts:13 |
| GET /api/v1/health | apps/api/src/app.ts:73 |
| GET /api/v1/leads | apps/api/src/routes/lead.routes.ts:89 |
| GET /api/v1/leads/:id | apps/api/src/routes/lead.routes.ts:114 |
| GET /api/v1/leads/:id/attachments | apps/api/src/routes/lead.routes.ts:280 |
| GET /api/v1/leads/:id/attachments/:attachmentId/download | apps/api/src/routes/lead.routes.ts:291 |
| GET /api/v1/leads/:id/history | apps/api/src/routes/lead.routes.ts:219 |
| GET /api/v1/leads/:id/notes | apps/api/src/routes/lead.routes.ts:196 |
| GET /api/v1/membership/me | apps/api/src/routes/membership.routes.ts:17 |
| GET /api/v1/membership/members | apps/api/src/routes/membership.routes.ts:27 |
| GET /api/v1/membership/tiers | apps/api/src/routes/membership.routes.ts:46 |
| GET /api/v1/moderation/appeals | apps/api/src/routes/moderation.routes.ts:154 |
| GET /api/v1/moderation/reports | apps/api/src/routes/moderation.routes.ts:48 |
| GET /api/v1/notifications | apps/api/src/routes/notification.routes.ts:10 |
| GET /api/v1/notifications/unread-count | apps/api/src/routes/notification.routes.ts:35 |
| GET /api/v1/policies | apps/api/src/routes/policy.routes.ts:12 |
| GET /api/v1/policies/:id | apps/api/src/routes/policy.routes.ts:42 |
| GET /api/v1/qa-threads | apps/api/src/routes/qa.routes.ts:50 |
| GET /api/v1/qa-threads/:id | apps/api/src/routes/qa.routes.ts:77 |
| GET /api/v1/qa-threads/:id/posts | apps/api/src/routes/qa.routes.ts:119 |
| GET /api/v1/reservations | apps/api/src/routes/reservation.routes.ts:87 |
| GET /api/v1/reservations/:id | apps/api/src/routes/reservation.routes.ts:132 |
| GET /api/v1/reservations/availability | apps/api/src/routes/reservation.routes.ts:19 |
| GET /api/v1/reviews | apps/api/src/routes/review.routes.ts:67 |
| GET /api/v1/reviews/:id | apps/api/src/routes/review.routes.ts:103 |
| GET /api/v1/reviews/:id/media | apps/api/src/routes/review.routes.ts:186 |
| GET /api/v1/reviews/:id/media/:mediaId/download | apps/api/src/routes/review.routes.ts:200 |
| GET /api/v1/rooms | apps/api/src/routes/room.routes.ts:10 |
| GET /api/v1/rooms/:id | apps/api/src/routes/room.routes.ts:26 |
| GET /api/v1/share-links/:token | apps/api/src/routes/shareLinks.routes.ts:28 |
| GET /api/v1/users | apps/api/src/routes/user.routes.ts:40 |
| GET /api/v1/users/:id | apps/api/src/routes/user.routes.ts:26 |
| GET /api/v1/users/me | apps/api/src/routes/user.routes.ts:12 |
| GET /api/v1/vision/cameras | apps/api/src/routes/vision.routes.ts:170 |
| GET /api/v1/vision/enrollments/:userId | apps/api/src/routes/vision.routes.ts:368 |
| GET /api/v1/vision/events | apps/api/src/routes/vision.routes.ts:271 |
| GET /api/v1/wallet/balance | apps/api/src/routes/wallet.routes.ts:124 |
| GET /api/v1/wallet/disputes | apps/api/src/routes/dispute.routes.ts:37 |
| GET /api/v1/wallet/ledger | apps/api/src/routes/wallet.routes.ts:143 |
| GET /api/v1/zones | apps/api/src/routes/zone.routes.ts:10 |
| GET /api/v1/zones/:id | apps/api/src/routes/zone.routes.ts:24 |
| POST /api/v1/auth/login | apps/api/src/routes/auth.routes.ts:49 |
| POST /api/v1/auth/logout | apps/api/src/routes/auth.routes.ts:83 |
| POST /api/v1/auth/register | apps/api/src/routes/auth.routes.ts:12 |
| POST /api/v1/blacklist | apps/api/src/routes/blacklist.routes.ts:33 |
| POST /api/v1/blacklist/:userId/clear | apps/api/src/routes/blacklist.routes.ts:62 |
| POST /api/v1/business-hours | apps/api/src/routes/businessHours.routes.ts:54 |
| POST /api/v1/exports | apps/api/src/routes/export.routes.ts:14 |
| POST /api/v1/favorites | apps/api/src/routes/favorites.routes.ts:23 |
| POST /api/v1/leads | apps/api/src/routes/lead.routes.ts:56 |
| POST /api/v1/leads/:id/attachments | apps/api/src/routes/lead.routes.ts:232 |
| POST /api/v1/leads/:id/notes | apps/api/src/routes/lead.routes.ts:168 |
| POST /api/v1/membership/tiers | apps/api/src/routes/membership.routes.ts:56 |
| POST /api/v1/moderation/appeals | apps/api/src/routes/moderation.routes.ts:115 |
| POST /api/v1/moderation/reports | apps/api/src/routes/moderation.routes.ts:20 |
| POST /api/v1/policies | apps/api/src/routes/policy.routes.ts:71 |
| POST /api/v1/qa-threads | apps/api/src/routes/qa.routes.ts:18 |
| POST /api/v1/qa-threads/:id/posts | apps/api/src/routes/qa.routes.ts:87 |
| POST /api/v1/reservations | apps/api/src/routes/reservation.routes.ts:35 |
| POST /api/v1/reservations/:id/cancel | apps/api/src/routes/reservation.routes.ts:155 |
| POST /api/v1/reservations/:id/check-in | apps/api/src/routes/reservation.routes.ts:182 |
| POST /api/v1/reviews | apps/api/src/routes/review.routes.ts:27 |
| POST /api/v1/reviews/:id/feature | apps/api/src/routes/review.routes.ts:230 |
| POST /api/v1/reviews/:id/media | apps/api/src/routes/review.routes.ts:142 |
| POST /api/v1/rooms | apps/api/src/routes/room.routes.ts:40 |
| POST /api/v1/share-links | apps/api/src/routes/shareLinks.routes.ts:13 |
| POST /api/v1/users/:id/roles | apps/api/src/routes/user.routes.ts:67 |
| POST /api/v1/users/:id/unlock | apps/api/src/routes/user.routes.ts:145 |
| POST /api/v1/vision/cameras | apps/api/src/routes/vision.routes.ts:188 |
| POST /api/v1/vision/detect | apps/api/src/routes/vision.routes.ts:103 |
| POST /api/v1/vision/enroll | apps/api/src/routes/vision.routes.ts:313 |
| POST /api/v1/vision/recognize | apps/api/src/routes/vision.routes.ts:142 |
| POST /api/v1/wallet/disputes | apps/api/src/routes/dispute.routes.ts:10 |
| POST /api/v1/wallet/redeem-points | apps/api/src/routes/wallet.routes.ts:101 |
| POST /api/v1/wallet/refund | apps/api/src/routes/wallet.routes.ts:75 |
| POST /api/v1/wallet/spend | apps/api/src/routes/wallet.routes.ts:42 |
| POST /api/v1/wallet/topup | apps/api/src/routes/wallet.routes.ts:18 |
| POST /api/v1/zones | apps/api/src/routes/zone.routes.ts:38 |
| PUT /api/v1/leads/:id/status | apps/api/src/routes/lead.routes.ts:125 |
| PUT /api/v1/membership/assign | apps/api/src/routes/membership.routes.ts:111 |
| PUT /api/v1/membership/tiers/:id | apps/api/src/routes/membership.routes.ts:82 |
| PUT /api/v1/moderation/appeals/:id | apps/api/src/routes/moderation.routes.ts:182 |
| PUT /api/v1/moderation/content-state | apps/api/src/routes/moderation.routes.ts:221 |
| PUT /api/v1/moderation/reports/:id | apps/api/src/routes/moderation.routes.ts:76 |
| PUT /api/v1/notifications/:id/read | apps/api/src/routes/notification.routes.ts:46 |
| PUT /api/v1/notifications/read-all | apps/api/src/routes/notification.routes.ts:67 |
| PUT /api/v1/qa-threads/:id/collapse | apps/api/src/routes/qa.routes.ts:169 |
| PUT /api/v1/qa-threads/:id/pin | apps/api/src/routes/qa.routes.ts:132 |
| PUT /api/v1/reviews/:id | apps/api/src/routes/review.routes.ts:113 |
| PUT /api/v1/rooms/:id | apps/api/src/routes/room.routes.ts:63 |
| PUT /api/v1/users/:id/roles | apps/api/src/routes/user.routes.ts:89 |
| PUT /api/v1/vision/cameras/:id | apps/api/src/routes/vision.routes.ts:230 |
| PUT /api/v1/wallet/disputes/:id | apps/api/src/routes/dispute.routes.ts:61 |
| PUT /api/v1/zones/:id | apps/api/src/routes/zone.routes.ts:61 |

### API Test Mapping Table
| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| DELETE /api/v1/business-hours/:id | yes | true no-mock HTTP | apps/api/tests/integration/businessHours.test.ts | apps/api/tests/integration/businessHours.test.ts:255 |
| DELETE /api/v1/favorites/:roomId | yes | true no-mock HTTP | apps/api/tests/integration/favorites.test.ts<br>apps/web/tests/e2e/room-browsing-flow.test.ts | apps/api/tests/integration/favorites.test.ts:205<br>apps/web/tests/e2e/room-browsing-flow.test.ts:390 |
| DELETE /api/v1/share-links/:token | yes | true no-mock HTTP | apps/api/tests/integration/shareLinks.test.ts | apps/api/tests/integration/shareLinks.test.ts:236 |
| DELETE /api/v1/users/:id/roles/:role | yes | true no-mock HTTP | apps/api/tests/integration/users.test.ts | apps/api/tests/integration/users.test.ts:228 |
| DELETE /api/v1/vision/enrollments/:userId | yes | true no-mock HTTP | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:468<br>apps/api/tests/integration/vision.test.ts:479<br>apps/api/tests/integration/vision.test.ts:515 |
| GET /api/v1/analytics/attendance-rate | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/analytics.test.ts:206<br>apps/api/tests/integration/analytics.test.ts:237<br>apps/api/tests/integration/analytics.test.ts:251 |
| GET /api/v1/analytics/booking-conversion | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/analytics.test.ts:94<br>apps/api/tests/integration/analytics.test.ts:123<br>apps/api/tests/integration/analytics.test.ts:154 |
| GET /api/v1/analytics/noshow-rate | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/analytics.test.ts:265<br>apps/api/tests/integration/analytics.test.ts:295<br>apps/api/tests/integration/analytics.test.ts:309 |
| GET /api/v1/analytics/offpeak-utilization | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts | apps/api/tests/integration/analytics.test.ts:323<br>apps/api/tests/integration/analytics.test.ts:361<br>apps/api/tests/integration/analytics.test.ts:375 |
| GET /api/v1/analytics/peak-utilization | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts | apps/api/tests/integration/analytics.test.ts:178<br>apps/api/tests/integration/analytics.test.ts:192 |
| GET /api/v1/analytics/policy-impact | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts | apps/api/tests/integration/analytics.test.ts:403<br>apps/api/tests/integration/analytics.test.ts:418 |
| GET /api/v1/analytics/snapshots | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/analytics.test.ts:432<br>apps/api/tests/integration/analytics.test.ts:466<br>apps/api/tests/integration/analytics.test.ts:482 |
| GET /api/v1/audit-logs | yes | true no-mock HTTP | apps/api/tests/integration/audit.test.ts<br>apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/rbac.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/audit.test.ts:157<br>apps/api/tests/integration/audit.test.ts:174<br>apps/api/tests/integration/audit.test.ts:196 |
| GET /api/v1/audit-logs/verify | yes | true no-mock HTTP | apps/api/tests/integration/audit.test.ts<br>apps/api/tests/integration/fullstack.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/audit.test.ts:87<br>apps/api/tests/integration/audit.test.ts:101<br>apps/api/tests/integration/audit.test.ts:108 |
| GET /api/v1/auth/csrf | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/api/tests/integration/audit.test.ts<br>apps/api/tests/integration/auth.test.ts<br>apps/api/tests/integration/blacklist.test.ts | apps/api/tests/integration/analytics.test.ts:16<br>apps/api/tests/integration/analytics.test.ts:19<br>apps/api/tests/integration/audit.test.ts:15 |
| GET /api/v1/auth/me | yes | true no-mock HTTP | apps/api/tests/integration/auth.test.ts<br>apps/api/tests/integration/fullstack.test.ts<br>apps/web/tests/e2e/auth-flow.test.ts | apps/api/tests/integration/auth.test.ts:219<br>apps/api/tests/integration/auth.test.ts:227<br>apps/api/tests/integration/auth.test.ts:255 |
| GET /api/v1/blacklist | yes | true no-mock HTTP | apps/api/tests/integration/blacklist.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/blacklist.test.ts:148<br>apps/api/tests/integration/blacklist.test.ts:161<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts:412 |
| GET /api/v1/business-hours | yes | true no-mock HTTP | apps/api/tests/integration/businessHours.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/businessHours.test.ts:105<br>apps/api/tests/integration/businessHours.test.ts:118<br>apps/web/tests/e2e/admin-flow.test.ts:651 |
| GET /api/v1/business-hours/effective | yes | true no-mock HTTP | apps/api/tests/integration/businessHours.test.ts | apps/api/tests/integration/businessHours.test.ts:217<br>apps/api/tests/integration/businessHours.test.ts:231 |
| GET /api/v1/exports | yes | true no-mock HTTP | apps/api/tests/integration/export.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/export.test.ts:172<br>apps/api/tests/integration/export.test.ts:188<br>apps/web/tests/e2e/community-flow.test.ts:724 |
| GET /api/v1/exports/:id | yes | true no-mock HTTP | apps/api/tests/integration/export.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/export.test.ts:216<br>apps/web/tests/e2e/community-flow.test.ts:699<br>apps/web/tests/e2e/community-flow.test.ts:772 |
| GET /api/v1/exports/:id/download | yes | true no-mock HTTP | apps/api/tests/integration/export.test.ts | apps/api/tests/integration/export.test.ts:244<br>apps/api/tests/integration/export.test.ts:271<br>apps/api/tests/integration/export.test.ts:299 |
| GET /api/v1/favorites | yes | true no-mock HTTP | apps/api/tests/integration/favorites.test.ts<br>apps/api/tests/integration/fullstack.test.ts<br>apps/web/tests/e2e/room-browsing-flow.test.ts | apps/api/tests/integration/favorites.test.ts:172<br>apps/api/tests/integration/favorites.test.ts:185<br>apps/api/tests/integration/favorites.test.ts:214 |
| GET /api/v1/health | yes | true no-mock HTTP | apps/api/tests/integration/health.test.ts | apps/api/tests/integration/health.test.ts:19<br>apps/api/tests/integration/health.test.ts:26<br>apps/api/tests/integration/health.test.ts:33 |
| GET /api/v1/leads | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:397<br>apps/api/tests/integration/lead.test.ts:427 |
| GET /api/v1/leads/:id | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:307<br>apps/api/tests/integration/lead.test.ts:316 |
| GET /api/v1/leads/:id/attachments | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:365 |
| GET /api/v1/leads/:id/attachments/:attachmentId/download | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:536 |
| GET /api/v1/leads/:id/history | yes | true no-mock HTTP | apps/api/tests/integration/leadHistory.test.ts | apps/api/tests/integration/leadHistory.test.ts:125<br>apps/api/tests/integration/leadHistory.test.ts:181 |
| GET /api/v1/leads/:id/notes | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:465<br>apps/api/tests/integration/lead.test.ts:490 |
| GET /api/v1/membership/me | yes | true no-mock HTTP | apps/api/tests/integration/membership.test.ts | apps/api/tests/integration/membership.test.ts:92<br>apps/api/tests/integration/membership.test.ts:102 |
| GET /api/v1/membership/members | yes | true no-mock HTTP | apps/api/tests/integration/membership.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/membership.test.ts:253<br>apps/api/tests/integration/membership.test.ts:266<br>apps/web/tests/e2e/admin-flow.test.ts:565 |
| GET /api/v1/membership/tiers | yes | true no-mock HTTP | apps/api/tests/integration/membership.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/membership.test.ts:123<br>apps/web/tests/e2e/admin-flow.test.ts:548 |
| GET /api/v1/moderation/appeals | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:421<br>apps/api/tests/integration/moderation.test.ts:436<br>apps/web/tests/e2e/moderation-flow.test.ts:552 |
| GET /api/v1/moderation/reports | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:365<br>apps/api/tests/integration/moderation.test.ts:380<br>apps/web/tests/e2e/admin-flow.test.ts:621 |
| GET /api/v1/notifications | yes | true no-mock HTTP | apps/api/tests/integration/notifications.test.ts<br>apps/web/tests/e2e/community-flow.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/notifications.test.ts:113<br>apps/api/tests/integration/notifications.test.ts:130<br>apps/api/tests/integration/notifications.test.ts:138 |
| GET /api/v1/notifications/unread-count | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/notifications.test.ts<br>apps/web/tests/e2e/community-flow.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:262<br>apps/api/tests/integration/notifications.test.ts:152<br>apps/api/tests/integration/notifications.test.ts:166 |
| GET /api/v1/policies | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/policy.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:356<br>apps/api/tests/integration/policy.test.ts:96<br>apps/api/tests/integration/policy.test.ts:110 |
| GET /api/v1/policies/:id | yes | true no-mock HTTP | apps/api/tests/integration/policy.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/policy.test.ts:215<br>apps/api/tests/integration/policy.test.ts:229<br>apps/api/tests/integration/policy.test.ts:249 |
| GET /api/v1/qa-threads | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/qa.test.ts:194<br>apps/api/tests/integration/qa.test.ts:203<br>apps/web/tests/e2e/community-flow.test.ts:231 |
| GET /api/v1/qa-threads/:id | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts | apps/api/tests/integration/qa.test.ts:355<br>apps/api/tests/integration/qa.test.ts:375 |
| GET /api/v1/qa-threads/:id/posts | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/qa.test.ts:415<br>apps/api/tests/integration/qa.test.ts:447<br>apps/web/tests/e2e/community-flow.test.ts:323 |
| GET /api/v1/reservations | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/reservation.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:195<br>apps/api/tests/integration/reservation.test.ts:467<br>apps/api/tests/integration/reservation.test.ts:503 |
| GET /api/v1/reservations/:id | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/reservationNotes.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:207<br>apps/api/tests/integration/reservationNotes.test.ts:197<br>apps/web/tests/e2e/reservation-flow.test.ts:386 |
| GET /api/v1/reservations/availability | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/reservation.test.ts<br>apps/web/tests/e2e/room-browsing-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:143<br>apps/api/tests/integration/reservation.test.ts:415<br>apps/api/tests/integration/reservation.test.ts:432 |
| GET /api/v1/reviews | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts<br>apps/web/tests/e2e/review-flow.test.ts | apps/api/tests/integration/review.test.ts:264<br>apps/web/tests/e2e/review-flow.test.ts:256<br>apps/web/tests/e2e/review-flow.test.ts:279 |
| GET /api/v1/reviews/:id | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts | apps/api/tests/integration/review.test.ts:301<br>apps/api/tests/integration/review.test.ts:311<br>apps/api/tests/integration/review.test.ts:319 |
| GET /api/v1/reviews/:id/media | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts<br>apps/web/tests/e2e/review-flow.test.ts | apps/api/tests/integration/review.test.ts:478<br>apps/api/tests/integration/review.test.ts:601<br>apps/web/tests/e2e/review-flow.test.ts:446 |
| GET /api/v1/reviews/:id/media/:mediaId/download | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts | apps/api/tests/integration/review.test.ts:612 |
| GET /api/v1/rooms | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/rooms.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts<br>apps/web/tests/e2e/room-browsing-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:130<br>apps/api/tests/integration/rooms.test.ts:123<br>apps/api/tests/integration/rooms.test.ts:134 |
| GET /api/v1/rooms/:id | yes | true no-mock HTTP | apps/api/tests/integration/rooms.test.ts | apps/api/tests/integration/rooms.test.ts:164<br>apps/api/tests/integration/rooms.test.ts:177 |
| GET /api/v1/share-links/:token | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/shareLinks.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:243<br>apps/api/tests/integration/shareLinks.test.ts:200<br>apps/api/tests/integration/shareLinks.test.ts:212 |
| GET /api/v1/users | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/users.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:348<br>apps/api/tests/integration/users.test.ts:137<br>apps/api/tests/integration/users.test.ts:151 |
| GET /api/v1/users/:id | yes | true no-mock HTTP | apps/api/tests/integration/users.test.ts | apps/api/tests/integration/users.test.ts:108<br>apps/api/tests/integration/users.test.ts:121 |
| GET /api/v1/users/me | yes | true no-mock HTTP | apps/api/tests/integration/users.test.ts | apps/api/tests/integration/users.test.ts:85<br>apps/api/tests/integration/users.test.ts:95 |
| GET /api/v1/vision/cameras | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:162<br>apps/api/tests/integration/vision.test.ts:172<br>apps/api/tests/integration/vision.test.ts:184 |
| GET /api/v1/vision/enrollments/:userId | yes | true no-mock HTTP | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:400<br>apps/api/tests/integration/vision.test.ts:407<br>apps/api/tests/integration/vision.test.ts:429 |
| GET /api/v1/vision/events | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:350<br>apps/api/tests/integration/vision.test.ts:360<br>apps/api/tests/integration/vision.test.ts:372 |
| GET /api/v1/wallet/balance | yes | true no-mock HTTP | apps/api/tests/integration/wallet.test.ts<br>apps/web/tests/e2e/wallet-flow.test.ts | apps/api/tests/integration/wallet.test.ts:124<br>apps/web/tests/e2e/wallet-flow.test.ts:148<br>apps/web/tests/e2e/wallet-flow.test.ts:183 |
| GET /api/v1/wallet/disputes | yes | true no-mock HTTP | apps/api/tests/integration/dispute.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/dispute.test.ts:196<br>apps/api/tests/integration/dispute.test.ts:208<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts:609 |
| GET /api/v1/wallet/ledger | yes | true no-mock HTTP | apps/api/tests/integration/wallet.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts<br>apps/web/tests/e2e/wallet-flow.test.ts | apps/api/tests/integration/wallet.test.ts:362<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts:509<br>apps/web/tests/e2e/wallet-flow.test.ts:458 |
| GET /api/v1/zones | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/rbac.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts<br>apps/web/tests/e2e/room-browsing-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:120<br>apps/api/tests/integration/rbac.test.ts:151<br>apps/web/tests/e2e/admin-flow.test.ts:124 |
| GET /api/v1/zones/:id | yes | true no-mock HTTP | apps/api/tests/integration/rooms.test.ts | apps/api/tests/integration/rooms.test.ts:310<br>apps/api/tests/integration/rooms.test.ts:326<br>apps/api/tests/integration/rooms.test.ts:343 |
| POST /api/v1/auth/login | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/api/tests/integration/audit.test.ts<br>apps/api/tests/integration/auth.test.ts<br>apps/api/tests/integration/blacklist.test.ts | apps/api/tests/integration/analytics.test.ts:52<br>apps/api/tests/integration/audit.test.ts:45<br>apps/api/tests/integration/auth.test.ts:141 |
| POST /api/v1/auth/logout | yes | true no-mock HTTP | apps/api/tests/integration/auth.test.ts<br>apps/api/tests/integration/fullstack.test.ts<br>apps/web/tests/e2e/auth-flow.test.ts | apps/api/tests/integration/auth.test.ts:261<br>apps/api/tests/integration/fullstack.test.ts:270<br>apps/web/tests/e2e/auth-flow.test.ts:235 |
| POST /api/v1/auth/register | yes | true no-mock HTTP | apps/api/tests/integration/analytics.test.ts<br>apps/api/tests/integration/audit.test.ts<br>apps/api/tests/integration/auth.test.ts<br>apps/api/tests/integration/blacklist.test.ts | apps/api/tests/integration/analytics.test.ts:35<br>apps/api/tests/integration/audit.test.ts:28<br>apps/api/tests/integration/auth.test.ts:36 |
| POST /api/v1/blacklist | yes | true no-mock HTTP | apps/api/tests/integration/blacklist.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/blacklist.test.ts:95<br>apps/api/tests/integration/blacklist.test.ts:110<br>apps/api/tests/integration/blacklist.test.ts:124 |
| POST /api/v1/blacklist/:userId/clear | yes | true no-mock HTTP | apps/api/tests/integration/blacklist.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/blacklist.test.ts:183<br>apps/api/tests/integration/blacklist.test.ts:198<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts:471 |
| POST /api/v1/business-hours | yes | true no-mock HTTP | apps/api/tests/integration/businessHours.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/businessHours.test.ts:132<br>apps/api/tests/integration/businessHours.test.ts:154<br>apps/api/tests/integration/businessHours.test.ts:246 |
| POST /api/v1/exports | yes | true no-mock HTTP | apps/api/tests/integration/export.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/export.test.ts:94<br>apps/api/tests/integration/export.test.ts:111<br>apps/api/tests/integration/export.test.ts:126 |
| POST /api/v1/favorites | yes | true no-mock HTTP | apps/api/tests/integration/favorites.test.ts<br>apps/api/tests/integration/fullstack.test.ts<br>apps/web/tests/e2e/room-browsing-flow.test.ts | apps/api/tests/integration/favorites.test.ts:115<br>apps/api/tests/integration/favorites.test.ts:130<br>apps/api/tests/integration/favorites.test.ts:138 |
| POST /api/v1/leads | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts<br>apps/api/tests/integration/leadHistory.test.ts | apps/api/tests/integration/lead.test.ts:108<br>apps/api/tests/integration/lead.test.ts:128<br>apps/api/tests/integration/lead.test.ts:144 |
| POST /api/v1/leads/:id/attachments | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:355<br>apps/api/tests/integration/lead.test.ts:526 |
| POST /api/v1/leads/:id/notes | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts | apps/api/tests/integration/lead.test.ts:299<br>apps/api/tests/integration/lead.test.ts:457 |
| POST /api/v1/membership/tiers | yes | true no-mock HTTP | apps/api/tests/integration/membership.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/membership.test.ts:139<br>apps/api/tests/integration/membership.test.ts:153<br>apps/api/tests/integration/membership.test.ts:167 |
| POST /api/v1/moderation/appeals | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:270<br>apps/api/tests/integration/moderation.test.ts:307<br>apps/api/tests/integration/moderation.test.ts:410 |
| POST /api/v1/moderation/reports | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:115<br>apps/api/tests/integration/moderation.test.ts:137<br>apps/api/tests/integration/moderation.test.ts:143 |
| POST /api/v1/policies | yes | true no-mock HTTP | apps/api/tests/integration/policy.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/policy.test.ts:129<br>apps/api/tests/integration/policy.test.ts:150<br>apps/api/tests/integration/policy.test.ts:167 |
| POST /api/v1/qa-threads | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/qa.test.ts:134<br>apps/api/tests/integration/qa.test.ts:153<br>apps/api/tests/integration/qa.test.ts:167 |
| POST /api/v1/qa-threads/:id/posts | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/qa.test.ts:224<br>apps/api/tests/integration/qa.test.ts:249<br>apps/api/tests/integration/qa.test.ts:399 |
| POST /api/v1/reservations | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/reservation.test.ts<br>apps/api/tests/integration/reservationCancellation.test.ts<br>apps/api/tests/integration/reservationNotes.test.ts | apps/api/tests/integration/fullstack.test.ts:176<br>apps/api/tests/integration/reservation.test.ts:162<br>apps/api/tests/integration/reservation.test.ts:190 |
| POST /api/v1/reservations/:id/cancel | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/reservation.test.ts<br>apps/api/tests/integration/reservationCancellation.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:251<br>apps/api/tests/integration/reservation.test.ts:345<br>apps/api/tests/integration/reservationCancellation.test.ts:162 |
| POST /api/v1/reservations/:id/check-in | yes | true no-mock HTTP | apps/api/tests/integration/reservation.test.ts | apps/api/tests/integration/reservation.test.ts:396 |
| POST /api/v1/reviews | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts<br>apps/web/tests/e2e/review-flow.test.ts | apps/api/tests/integration/review.test.ts:143<br>apps/api/tests/integration/review.test.ts:167<br>apps/api/tests/integration/review.test.ts:188 |
| POST /api/v1/reviews/:id/feature | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts<br>apps/web/tests/e2e/review-flow.test.ts | apps/api/tests/integration/review.test.ts:511<br>apps/api/tests/integration/review.test.ts:543<br>apps/web/tests/e2e/review-flow.test.ts:479 |
| POST /api/v1/reviews/:id/media | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts<br>apps/web/tests/e2e/review-flow.test.ts | apps/api/tests/integration/review.test.ts:428<br>apps/api/tests/integration/review.test.ts:471<br>apps/api/tests/integration/review.test.ts:591 |
| POST /api/v1/rooms | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/rbac.test.ts<br>apps/api/tests/integration/rooms.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:323<br>apps/api/tests/integration/rbac.test.ts:175<br>apps/api/tests/integration/rbac.test.ts:202 |
| POST /api/v1/share-links | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/shareLinks.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:232<br>apps/api/tests/integration/shareLinks.test.ts:134<br>apps/api/tests/integration/shareLinks.test.ts:155 |
| POST /api/v1/users/:id/roles | yes | true no-mock HTTP | apps/api/tests/integration/users.test.ts | apps/api/tests/integration/users.test.ts:203 |
| POST /api/v1/users/:id/unlock | yes | true no-mock HTTP | apps/api/tests/integration/users.test.ts | apps/api/tests/integration/users.test.ts:252 |
| POST /api/v1/vision/cameras | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:197<br>apps/api/tests/integration/vision.test.ts:209<br>apps/api/tests/integration/vision.test.ts:223 |
| POST /api/v1/vision/detect | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:108<br>apps/api/tests/integration/vision.test.ts:118<br>apps/api/tests/integration/vision.test.ts:131 |
| POST /api/v1/vision/enroll | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:251<br>apps/api/tests/integration/vision.test.ts:263<br>apps/api/tests/integration/vision.test.ts:281 |
| POST /api/v1/vision/recognize | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:554<br>apps/api/tests/integration/vision.test.ts:565<br>apps/api/tests/integration/vision.test.ts:577 |
| POST /api/v1/wallet/disputes | yes | true no-mock HTTP | apps/api/tests/integration/dispute.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/dispute.test.ts:120<br>apps/api/tests/integration/dispute.test.ts:146<br>apps/api/tests/integration/dispute.test.ts:165 |
| POST /api/v1/wallet/redeem-points | yes | true no-mock HTTP | apps/api/tests/integration/wallet.test.ts<br>apps/web/tests/e2e/wallet-flow.test.ts | apps/api/tests/integration/wallet.test.ts:275<br>apps/api/tests/integration/wallet.test.ts:299<br>apps/web/tests/e2e/wallet-flow.test.ts:389 |
| POST /api/v1/wallet/refund | yes | true no-mock HTTP | apps/api/tests/integration/wallet.test.ts<br>apps/web/tests/e2e/wallet-flow.test.ts | apps/api/tests/integration/wallet.test.ts:406<br>apps/api/tests/integration/wallet.test.ts:439<br>apps/web/tests/e2e/wallet-flow.test.ts:308 |
| POST /api/v1/wallet/spend | yes | true no-mock HTTP | apps/api/tests/integration/wallet.test.ts<br>apps/web/tests/e2e/wallet-flow.test.ts | apps/api/tests/integration/wallet.test.ts:184<br>apps/api/tests/integration/wallet.test.ts:215<br>apps/api/tests/integration/wallet.test.ts:326 |
| POST /api/v1/wallet/topup | yes | true no-mock HTTP | apps/api/tests/integration/dispute.test.ts<br>apps/api/tests/integration/wallet.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts<br>apps/web/tests/e2e/wallet-flow.test.ts | apps/api/tests/integration/dispute.test.ts:71<br>apps/api/tests/integration/wallet.test.ts:97<br>apps/api/tests/integration/wallet.test.ts:145 |
| POST /api/v1/zones | yes | true no-mock HTTP | apps/api/tests/integration/fullstack.test.ts<br>apps/api/tests/integration/rbac.test.ts<br>apps/api/tests/integration/rooms.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/fullstack.test.ts:313<br>apps/api/tests/integration/rbac.test.ts:82<br>apps/api/tests/integration/rbac.test.ts:97 |
| PUT /api/v1/leads/:id/status | yes | true no-mock HTTP | apps/api/tests/integration/lead.test.ts<br>apps/api/tests/integration/leadHistory.test.ts | apps/api/tests/integration/lead.test.ts:215<br>apps/api/tests/integration/lead.test.ts:224<br>apps/api/tests/integration/lead.test.ts:233 |
| PUT /api/v1/membership/assign | yes | true no-mock HTTP | apps/api/tests/integration/membership.test.ts | apps/api/tests/integration/membership.test.ts:221<br>apps/api/tests/integration/membership.test.ts:236 |
| PUT /api/v1/membership/tiers/:id | yes | true no-mock HTTP | apps/api/tests/integration/membership.test.ts | apps/api/tests/integration/membership.test.ts:193 |
| PUT /api/v1/moderation/appeals/:id | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:321<br>apps/api/tests/integration/moderation.test.ts:331<br>apps/web/tests/e2e/moderation-flow.test.ts:476 |
| PUT /api/v1/moderation/content-state | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:260<br>apps/api/tests/integration/moderation.test.ts:298<br>apps/api/tests/integration/moderation.test.ts:401 |
| PUT /api/v1/moderation/reports/:id | yes | true no-mock HTTP | apps/api/tests/integration/moderation.test.ts<br>apps/web/tests/e2e/moderation-flow.test.ts | apps/api/tests/integration/moderation.test.ts:173<br>apps/api/tests/integration/moderation.test.ts:201<br>apps/api/tests/integration/moderation.test.ts:208 |
| PUT /api/v1/notifications/:id/read | yes | true no-mock HTTP | apps/api/tests/integration/notifications.test.ts<br>apps/web/tests/e2e/community-flow.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/notifications.test.ts:180<br>apps/api/tests/integration/notifications.test.ts:195<br>apps/web/tests/e2e/community-flow.test.ts:573 |
| PUT /api/v1/notifications/read-all | yes | true no-mock HTTP | apps/api/tests/integration/notifications.test.ts<br>apps/web/tests/e2e/community-flow.test.ts<br>apps/web/tests/e2e/reservation-flow.test.ts | apps/api/tests/integration/notifications.test.ts:212<br>apps/web/tests/e2e/community-flow.test.ts:612<br>apps/web/tests/e2e/reservation-flow.test.ts:646 |
| PUT /api/v1/qa-threads/:id/collapse | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/qa.test.ts:329<br>apps/web/tests/e2e/community-flow.test.ts:505 |
| PUT /api/v1/qa-threads/:id/pin | yes | true no-mock HTTP | apps/api/tests/integration/qa.test.ts<br>apps/web/tests/e2e/community-flow.test.ts | apps/api/tests/integration/qa.test.ts:277<br>apps/api/tests/integration/qa.test.ts:301<br>apps/web/tests/e2e/community-flow.test.ts:392 |
| PUT /api/v1/reviews/:id | yes | true no-mock HTTP | apps/api/tests/integration/review.test.ts<br>apps/web/tests/e2e/review-flow.test.ts | apps/api/tests/integration/review.test.ts:345<br>apps/api/tests/integration/review.test.ts:382<br>apps/web/tests/e2e/review-flow.test.ts:318 |
| PUT /api/v1/rooms/:id | yes | true no-mock HTTP | apps/api/tests/integration/rooms.test.ts | apps/api/tests/integration/rooms.test.ts:241<br>apps/api/tests/integration/rooms.test.ts:266<br>apps/api/tests/integration/rooms.test.ts:290 |
| PUT /api/v1/users/:id/roles | yes | true no-mock HTTP | apps/api/tests/integration/users.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/users.test.ts:166<br>apps/api/tests/integration/users.test.ts:186<br>apps/web/tests/e2e/admin-flow.test.ts:363 |
| PUT /api/v1/vision/cameras/:id | yes | true no-mock HTTP (also HTTP with mocking) | apps/api/tests/integration/vision.test.ts | apps/api/tests/integration/vision.test.ts:593<br>apps/api/tests/integration/vision.test.ts:604<br>apps/api/tests/integration/vision.test.ts:616 |
| PUT /api/v1/wallet/disputes/:id | yes | true no-mock HTTP | apps/api/tests/integration/dispute.test.ts<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts | apps/api/tests/integration/dispute.test.ts:240<br>apps/api/tests/integration/dispute.test.ts:274<br>apps/web/tests/e2e/policy-blacklist-flow.test.ts:677 |
| PUT /api/v1/zones/:id | yes | true no-mock HTTP | apps/api/tests/integration/rooms.test.ts<br>apps/web/tests/e2e/admin-flow.test.ts | apps/api/tests/integration/rooms.test.ts:349<br>apps/api/tests/integration/rooms.test.ts:367<br>apps/api/tests/integration/rooms.test.ts:383 |

### Mock-Affected Endpoints
- GET /api/v1/vision/cameras
- GET /api/v1/vision/events
- POST /api/v1/vision/cameras
- POST /api/v1/vision/detect
- POST /api/v1/vision/enroll
- POST /api/v1/vision/recognize
- PUT /api/v1/vision/cameras/:id

### Coverage Summary
- Total endpoints: **116**.
- Endpoints with HTTP tests: **116**.
- Endpoints with true no-mock HTTP tests: **116**.
- HTTP coverage: **100.00%**.
- True API coverage: **100.00%**.

### Unit Test Summary
#### Backend Unit Tests
- Test files:
  - `apps/api/tests/unit/middleware.auth.test.ts`
  - `apps/api/tests/unit/middleware.csrf.test.ts`
  - `apps/api/tests/unit/service.analytics.test.ts`
  - `apps/api/tests/unit/service.audit.test.ts`
  - `apps/api/tests/unit/service.blacklist.test.ts`
  - `apps/api/tests/unit/service.businessHours.test.ts`
  - `apps/api/tests/unit/service.dispute.test.ts`
  - `apps/api/tests/unit/service.export.test.ts`
  - `apps/api/tests/unit/service.lead.test.ts`
  - `apps/api/tests/unit/service.membership.test.ts`
  - `apps/api/tests/unit/service.moderation.test.ts`
  - `apps/api/tests/unit/service.qa.test.ts`
  - `apps/api/tests/unit/service.reservation.test.ts`
  - `apps/api/tests/unit/service.review.test.ts`
  - `apps/api/tests/unit/service.wallet.test.ts`
- Modules covered: middleware (`auth`, `csrf`), services (`analytics`, `audit`, `blacklist`, `businessHours`, `dispute`, `export`, `lead`, `membership`, `moderation`, `qa`, `reservation`, `review`, `wallet`).
- Important backend modules not directly unit-tested:
  - `apps/api/src/services/auth.service.ts`
  - `apps/api/src/services/session.service.ts`
  - `apps/api/src/services/room.service.ts`
  - `apps/api/src/services/zone.service.ts`
  - `apps/api/src/services/attachment.service.ts`
  - `apps/api/src/services/reputation.service.ts`
  - `apps/api/src/services/contentSafety.service.ts`
  - `apps/api/src/services/jobQueue.service.ts`
  - `apps/api/src/middleware/errorHandler.ts`

#### Frontend Unit Tests (STRICT)
- Frontend test files exist: `apps/web/tests/*.test.tsx`, `apps/web/tests/admin/*.test.tsx`.
- Framework/tools detected:
  - Vitest config: [apps/web/vitest.config.ts:1](apps/web/vitest.config.ts:1)
  - React Testing Library usage: [apps/web/tests/RoomsPage.test.tsx:1](apps/web/tests/RoomsPage.test.tsx:1)
  - Component imports and render: [apps/web/tests/RoomsPage.test.tsx:4](apps/web/tests/RoomsPage.test.tsx:4), [apps/web/tests/RoomsPage.test.tsx:66](apps/web/tests/RoomsPage.test.tsx:66)
- Components/modules covered include:
  - Public pages: `LoginPage`, `RegisterPage`, `DashboardPage`, `RoomsPage`, `ReservationsPage`, `FavoritesPage`, `ReviewsPage`, `NotificationsPage`, `LeadsPage`, `SharedReservationPage`
  - Admin/staff pages: `AnalyticsPage`, `AuditPage`, `BlacklistPage`, `BusinessHoursPage`, `DisputesPage`, `ExportsPage`, `LeadManagementPage`, `MembershipPage`, `ModerationPage`, `PoliciesPage`, `ReservationOpsPage`, `RoomSetupPage`, `UsersPage`, `ZoneManagementPage`, `VisionPage`
  - Component: `ProtectedRoute`
- Important frontend modules not directly unit-tested:
  - `apps/web/src/components/Layout.tsx`
  - `apps/web/src/contexts/AuthContext.tsx` (mocked in many tests)
  - `apps/web/src/App.tsx`
  - `apps/web/src/main.tsx`
- **Frontend unit tests: PRESENT**

### Cross-Layer Observation
- Backend API tests and frontend tests are both substantial.
- Fullstack E2E coverage exists under `apps/web/tests/e2e/*.test.ts`, so this is not backend-heavy-only.

### API Observability Check
- Strong overall observability: tests explicitly show method/path, request payload, and response assertions (example: [apps/api/tests/integration/review.test.ts:428](apps/api/tests/integration/review.test.ts:428), [apps/api/tests/integration/review.test.ts:478](apps/api/tests/integration/review.test.ts:478), [apps/api/tests/integration/review.test.ts:612](apps/api/tests/integration/review.test.ts:612)).
- Weakness: in vision mocked suite, HTTP response is validated but downstream worker transport is mocked (`global.fetch`), reducing end-to-end observability for true worker integration ([apps/api/tests/integration/vision.test.ts:670](apps/api/tests/integration/vision.test.ts:670)).

### Tests Check
- `run_tests.sh` is Docker-based and self-contained: [run_tests.sh:17](run_tests.sh:17), [run_tests.sh:49](run_tests.sh:49), [run_tests.sh:69](run_tests.sh:69), [run_tests.sh:87](run_tests.sh:87).
- No local package-manager prerequisite in script flow.

### Test Coverage Score (0-100)
- **92/100**

### Score Rationale
- + Full endpoint inventory resolved and every endpoint hit by HTTP tests.
- + Strong no-mock HTTP coverage on API surface.
- + Frontend unit tests are present and broad for page-level UI logic.
- - Vision API has a dedicated mocked-worker suite (`fetch` mocked), so part of subsystem behavior is not validated against a real worker boundary.
- - Several backend core modules are not directly unit-tested.

### Key Gaps
- Worker boundary realism gap in `vision.test.ts` mocked suite (transport mocked).
- Missing direct unit tests for core backend modules listed above.
- Some frontend foundational modules (`Layout`, `AuthContext`, `App`, `main`) are not directly unit-tested.

### Confidence & Assumptions
- Confidence: **High** for route-to-test mapping and README compliance checks.
- Assumption: Endpoint coverage mapping uses static request-path extraction (quoted and template literal paths), with specificity resolution for parameterized routes.
- Assumption: “true no-mock HTTP” is assigned when at least one hit for an endpoint occurs outside the mocked vision-worker suite.

### Test Coverage Verdict
- **PASS (with quality caveats)**

---

# README Audit

## Hard Gate Evaluation
- README present at repo root: [README.md](README.md).
- Project type declared at top: `Project Type: Fullstack` ([README.md:1](README.md:1)).
- Backend/fullstack startup includes required command `docker-compose up` ([README.md:17](README.md:17)).
- Access method includes URL + ports ([README.md:37](README.md:37), [README.md:51](README.md:51)).
- Verification method includes API (`curl`) and UI flow steps ([README.md:67](README.md:67), [README.md:95](README.md:95)).
- Environment rule compliance: no `npm install`, `pip install`, `apt-get`, manual DB setup required in startup flow; Docker-contained flow is explicit ([README.md:11](README.md:11), [README.md:26](README.md:26), [README.md:40](README.md:40)).
- Auth present and demo credentials provided with multiple roles ([README.md:44](README.md:44)).

### High Priority Issues
- None.

### Medium Priority Issues
- README test command section omits explicit `./run_tests.sh e2e` even though script supports it ([run_tests.sh:98](run_tests.sh:98)).

### Low Priority Issues
- Duplicate/overlapping access paths (3000 UI, 3001 API, 443 nginx) may cause minor operator ambiguity, though all are documented.

### Hard Gate Failures
- None.

### README Verdict
- **PASS**

