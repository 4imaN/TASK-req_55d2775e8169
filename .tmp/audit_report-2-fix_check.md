
• # StudyRoomOps Prior-Issue Recheck

  Source reviewed: .tmp/studyroomops_static_audit_20260420_024547.md

  Boundary: static review only. I did not run the app, Docker, or tests.

  ## Overall Result

  - Prior concrete code defects rechecked: 8
  - Fixed: 8
  - Partially Fixed: 0
  - Not Fixed: 0

  ## Issue-by-Issue Status

  ### 1. Reservation cancellation could release capacity before version-guarded update

  - Status: Fixed
  - Evidence:
      - cancellation now uses a Mongo session and wraps the reservation update plus slice deletion in one transaction: apps/api/src/services/
        reservation.service.ts:409-455
      - the version-guarded update happens before slice deletion inside the same transaction: apps/api/src/services/reservation.service.ts:418-446
      - targeted regression tests were added: apps/api/tests/integration/reservationCancellation.test.ts:124-330

  ### 2. Vision enrollment UI used the wrong consent payload

  - Status: Fixed
  - Evidence:
      - backend still requires consent_metadata.consent_given: apps/api/src/routes/vision.routes.ts:319-337
      - frontend now sends consent_given, consent_timestamp, and consent_actor: apps/web/src/pages/admin/VisionPage.tsx:231-239
      - frontend test verifies the corrected payload and absence of the old given field: apps/web/tests/VisionEnrollment.test.tsx:23-99

  ### 3. Lead attachment uploads failed silently in the UI

  - Status: Fixed
  - Evidence:
      - upload responses are now checked and partial/full failure is surfaced to the user: apps/web/src/pages/LeadsPage.tsx:156-189
      - added frontend test file: apps/web/tests/LeadsPage.test.tsx:27-136
  - Note:
      - the new test coverage is light; the code fix is stronger than the UI regression test.

  ### 4. Review photo uploads failed silently in the UI

  - Status: Fixed
  - Evidence:
      - the page now tracks media upload failure and shows partial-success messaging: apps/web/src/pages/ReviewsPage.tsx:212-239
      - upload response status is now checked: apps/web/src/pages/ReviewsPage.tsx:222-230
      - frontend test added: apps/web/tests/ReviewsPage.test.tsx:80-154
  - Note:
      - the code fix is clear, but the new UI test does not fully drive a realistic file-upload flow.

  ### 5. Lead history API and staff UI used incompatible field names

  - Status: Fixed
  - Evidence:
      - backend now returns note and changedAt: apps/api/src/services/lead.service.ts:427-445
      - frontend type and rendering now align with that shape: apps/web/src/pages/staff/LeadManagementPage.tsx:37-47, apps/web/src/pages/staff/
        LeadManagementPage.tsx:437-438
      - backend contract test added: apps/api/tests/integration/leadHistory.test.ts:83-188

  ### 6. Notification retention lacked a TTL index

  - Status: Fixed
  - Evidence:
      - idx_notifications_ttl now exists on expiresAt: apps/api/src/config/db.ts:195-204
      - dedicated TTL/index test added: apps/api/tests/integration/notificationTtl.test.ts:26-37
      - retention job remains as secondary cleanup and is also covered: apps/api/tests/integration/notificationTtl.test.ts:62-99

  ### 7. Production secret validation only warned instead of failing

  - Status: Fixed
  - Evidence:
      - validateProductionSecrets() now throws in production for insecure defaults: apps/api/src/config/index.ts:59-82
      - server startup invokes it: apps/api/src/server.ts:7-18
      - dedicated tests added: apps/api/tests/integration/configValidation.test.ts:1-100

  ### 8. Reservation notes existed in the UI but were not persisted

  - Status: Fixed
  - Evidence:
      - UI now includes notes in the booking payload: apps/web/src/pages/RoomsPage.tsx:156-166
      - reservation route accepts and forwards notes: apps/api/src/routes/reservation.routes.ts:35-45
      - reservation service persists notes: apps/api/src/services/reservation.service.ts:94-101, apps/api/src/services/reservation.service.ts:220-
        236
      - reservation details page still renders notes: apps/web/src/pages/ReservationsPage.tsx:256-263
      - integration tests added: apps/api/tests/integration/reservationNotes.test.ts:118-202

  ## Updated Recheck

  ### Audit-log immutability

  - Status: Fixed by static evidence at the application layer
  - Evidence:
      - getAppendOnlyCollection() blocks update/delete/drop-style mutations on audit_logs: apps/api/src/config/db.ts:29-67
      - audit service uses getAppendOnlyCollection('audit_logs') for reads and writes: apps/api/src/services/audit.service.ts:21-25, apps/api/src/
        services/audit.service.ts:38-63, apps/api/src/services/audit.service.ts:80-112
      - audit route also reads through the append-only guard: apps/api/src/routes/audit.routes.ts:30-37
      - dedicated immutability test suite exists: apps/api/tests/integration/auditImmutability.test.ts:26-181
      - assumptions doc now documents this enforcement and recommends DB permission hardening: ASSUMPTIONS.md:39
  - Residual note:
      - this is application-layer immutability, not database-native WORM enforcement.

  ## Final Conclusion

  All previously listed concrete defects are now fixed by static evidence. The audit-log item is fixed at the application layer, with only
  operational DB-hardening remaining as a recommendation.