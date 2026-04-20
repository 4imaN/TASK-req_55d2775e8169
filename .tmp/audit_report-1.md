# StudyRoomOps Audit Reinspection

## Verdict
- Overall conclusion: **All previously reported issues are fixed for the reviewed scope**

This reinspection checked the issues recorded in [studyroomops_static_audit.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/.tmp/studyroomops_static_audit.md) against the current repository using static analysis only. Most of the previously reported high-severity items now have code-level fixes. The items that were previously marked **Partially fixed** are now fixed for the original audit scope.

## Scope / Boundary
- Reviewed only the previously reported issues.
- Performed static analysis only.
- Did not run the app, tests, Docker, browser flows, jobs, or external services.
- Any runtime behavior claims remain manual-verification items.

## Issue-by-Issue Status

### 1. Session retention cleanup inconsistency
- Status: **Fixed**
- Previous issue: terminal session statuses and timestamps did not line up with retention cleanup, so expired sessions might never be purged.
- Current evidence:
  - Session expiry and revoke paths now set `updatedAt`: [session.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/session.service.ts:76), [session.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/session.service.ts:85), [session.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/session.service.ts:119)
  - Retention job now targets `revoked`, `expired_idle`, and `expired_absolute`: [retentionJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/retentionJobs.ts:15), [retentionJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/retentionJobs.ts:43)
  - Regression coverage exists for idle, absolute, revoked, and active sessions: [retention.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/retention.test.ts:27)
- Conclusion: the original root cause is addressed statically.

### 2. Lead attachment storage hard-coded to container path; test tolerated failure
- Status: **Fixed**
- Previous issue: upload storage was hard-coded to `/app/...`, and the integration test allowed `201` or `422`.
- Current evidence:
  - Storage path is configurable via `process.env.UPLOAD_DIR` with a local fallback: [attachment.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/attachment.service.ts:16)
  - Upload directory creation remains deterministic: [attachment.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/attachment.service.ts:44)
  - Lead attachment test now requires upload success and attachment listing success: [lead.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/lead.test.ts:350), [lead.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/lead.test.ts:357), [lead.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/lead.test.ts:360)
  - `.env.example` now documents Docker vs non-Docker behavior and leaves the container upload path commented rather than active: [.env.example](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/.env.example:37)
- Conclusion: the original code and documentation issue is fixed.

### 3. Reviews and Q&A exposed raw user IDs
- Status: **Fixed**
- Previous issue: API responses and frontend rendering often fell back to raw `userId` values.
- Current evidence:
  - Review list now batch-loads authors and returns `author` objects: [review.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/review.service.ts:302), [review.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/review.service.ts:315)
  - Q&A thread and post lists now batch-load authors and return `author` objects: [qa.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/qa.service.ts:226), [qa.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/qa.service.ts:239), [qa.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/qa.service.ts:301), [qa.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/qa.service.ts:314)
  - Frontend now renders `author.displayName` instead of raw IDs: [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:64), [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:433), [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:497), [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:630)
- Conclusion: this issue appears fixed statically.

### 4. Review photos uploaded but not rendered as actual photos
- Status: **Fixed**
- Previous issue: persisted review media showed as filename blocks instead of images.
- Current evidence:
  - Review feed now detects image MIME types and renders `<img>` thumbnails from the authenticated download endpoint: [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:383), [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:386), [ReviewsPage.tsx](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/web/src/pages/ReviewsPage.tsx:397)
  - Upload/download media pipeline remains present in the review service: [review.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/review.service.ts:333), [review.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/review.service.ts:449)
- Conclusion: fixed in implementation.

### 5. Peak/off-peak utilization ignored configurable business hours
- Status: **Fixed**
- Previous issue: analytics used a 24-hour-day denominator rather than business hours.
- Current evidence:
  - Business-hours helper reads site business hours: [analytics.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/analytics.service.ts:139)
  - `computePeakUtilization` now intersects peak hours with business hours before computing available capacity: [analytics.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/analytics.service.ts:201), [analytics.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/analytics.service.ts:203), [analytics.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/analytics.service.ts:205)
  - `computeOffPeakUtilization` uses business-hours-aware capacity: [analytics.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/analytics.service.ts:243)
- Conclusion: the original business-hours gap is fixed.

### 6. Orphan attachment cleanup could delete shared deduplicated blobs
- Status: **Fixed**
- Previous issue: orphan cleanup removed the blob file before checking whether other attachment records still referenced it.
- Current evidence:
  - Deduplication still exists by `sha256Hash`: [attachment.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/attachment.service.ts:128), [attachment.service.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/services/attachment.service.ts:131)
  - Orphan cleanup now deletes metadata first, then checks for remaining references before unlinking the blob: [retentionJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/retentionJobs.ts:135), [retentionJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/retentionJobs.ts:139)
- Conclusion: fixed statically.

### 7. Logging inconsistency across API bootstrap and jobs
- Status: **Fixed for the originally reported scope**
- Previous issue: bootstrap and jobs relied on mixed ad hoc `console.*` logging.
- Current evidence:
  - A shared logger exists: [logger.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/utils/logger.ts:17)
  - Server bootstrap uses the shared logger: [server.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/server.ts:5), [server.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/server.ts:8), [server.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/server.ts:30)
  - Scheduler uses the shared logger: [scheduler.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/scheduler.ts:14), [scheduler.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/scheduler.ts:100), [scheduler.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/scheduler.ts:128)
  - Retention, analytics, moderation, and reservation jobs use the shared logger in the originally flagged scope: [retentionJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/retentionJobs.ts:5), [analyticsJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/analyticsJobs.ts:15), [moderationJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/moderationJobs.ts:2), [reservationJobs.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/jobs/reservationJobs.ts:8)
- Conclusion: improved to fixed for the original bootstrap/jobs finding.

### 8. Export tests covered only RBAC and creation, not processing/download correctness
- Status: **Fixed**
- Previous issue: tests did not prove export processing, file hashing, or download behavior.
- Current evidence:
  - Export tests now process jobs directly and assert `completed` status plus `fileHash`: [export.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/export.test.ts:184), [export.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/export.test.ts:200), [export.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/export.test.ts:208)
  - Tests now cover CSV download, hash header, not-ready rejection, and non-admin denial: [export.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/export.test.ts:215), [export.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/export.test.ts:245), [export.test.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/tests/integration/export.test.ts:267)
  - Route supports guarded CSV download and file-hash header: [export.routes.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/routes/export.routes.ts:65), [export.routes.ts](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/apps/api/src/routes/export.routes.ts:83)
- Conclusion: fixed statically.

### 9. README inconsistencies and overstatements
- Status: **Fixed**
- Previous issue: README listed a non-existent `docs/` directory and phrased verification as stronger than static evidence allowed.
- Current evidence:
  - Architecture tree no longer lists `docs/`: [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/README.md:84)
  - Verification steps are explicitly framed as manual checks: [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/README.md:56), [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/README.md:58)
  - Extended verification steps are bounded as requiring a running stack and seeded data: [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/README.md:146), [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/newer/w3t17/repo/README.md:148)
- Conclusion: fixed statically.

## Summary

### Fully fixed
- Session retention cleanup mismatch
- Lead attachment storage/test issue
- Review/Q&A raw user IDs
- Review photo rendering
- Analytics business-hours issue
- Orphan attachment cleanup deleting shared blobs
- Export processing/download coverage gap
- README architecture/verification wording issue

### Fixed For Original Scope
- Logging consistency across API bootstrap and the originally flagged jobs

### Still open
- None of the previously reported issues remain partially fixed or fully unchanged.

## Note
- There are still some `console.*` calls elsewhere in the repo, such as seed/bootstrap and some helper paths, but those were not the specific items previously marked partial in the reinspection flow.
