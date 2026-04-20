module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@studyroomops/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@studyroomops/shared-policy$': '<rootDir>/../../packages/shared-policy/src',
  },
  setupFilesAfterSetup: [],
  testTimeout: 30000,
};
