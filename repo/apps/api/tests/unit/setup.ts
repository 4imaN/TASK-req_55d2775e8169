/**
 * Unit test bootstrap.
 *
 * Sets required environment variables before any module is imported so that
 * `apps/api/src/config/index.ts` does not throw on missing env vars.
 * No database connection, no HTTP server.
 */

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/studyroomops_unit_test';
process.env.MONGO_DB_NAME = 'studyroomops_unit_test';
process.env.JWT_SECRET = 'unit-test-jwt-secret-long-enough-for-signing-do-not-use-in-prod';
process.env.CSRF_SECRET = 'unit-test-csrf-secret';
process.env.FIELD_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789';
process.env.FILE_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210';
process.env.SITE_TIMEZONE = 'America/Los_Angeles';
process.env.SITE_NAME = 'StudyRoomOps';
process.env.DAILY_RISK_LIMIT_CENTS = '20000';
