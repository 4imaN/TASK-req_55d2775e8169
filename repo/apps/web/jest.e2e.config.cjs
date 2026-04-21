/**
 * Jest configuration for frontend E2E integration tests.
 *
 * These tests live in apps/web/tests/e2e/ and boot the real Express API
 * via the API's source code. They use the same jest + ts-jest toolchain as
 * apps/api — invoked via: node ../api/node_modules/.bin/jest
 *
 * Run with:
 *   npm run test:e2e    (from apps/web)
 *   or
 *   cd apps/web && node ../api/node_modules/.bin/jest --config jest.e2e.config.cjs --runInBand --forceExit
 *
 * Prerequisites:
 *   - MongoDB replica set running at localhost:27017 (same as API integration tests)
 *   - apps/api/node_modules installed (jest + ts-jest + supertest live there)
 */

const path = require('path');

/** @type {import('@jest/types').Config.InitialOptions} */
// Absolute path to ts-jest in the API's node_modules
const tsJestPath = path.resolve(__dirname, '../api/node_modules/ts-jest');

module.exports = {
  // Explicit transform instead of preset so the absolute ts-jest path is used.
  // This avoids "module not found" errors when jest runs from apps/web which
  // doesn't have ts-jest installed locally.
  transform: {
    '^.+\\.tsx?$': [tsJestPath, {
      tsconfig: path.resolve(__dirname, 'tests/e2e/tsconfig.json'),
    }],
  },
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@studyroomops/shared-types$': path.resolve(__dirname, '../../packages/shared-types/src'),
    '^@studyroomops/shared-policy$': path.resolve(__dirname, '../../packages/shared-policy/src'),
  },
  // Allow Jest to resolve packages from both the web and API node_modules.
  // supertest, express, mongodb etc. are installed in apps/api — no duplicate
  // install needed in apps/web.
  modulePaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(__dirname, '../api/node_modules'),
  ],
  testTimeout: 30000,
  forceExit: true,
};
