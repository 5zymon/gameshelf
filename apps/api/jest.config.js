/** @type {import('jest').Config} */
const shared = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

module.exports = {
  // Serial workers: the e2e tier shares one test database (each test file
  // resets it in beforeEach), so parallel workers would wipe each other's
  // data. `maxWorkers` and `testTimeout` are only honored at the root level,
  // not per project.
  maxWorkers: 1,
  testTimeout: 30000,
  projects: [
    {
      ...shared,
      displayName: 'unit',
      roots: ['<rootDir>/test/unit'],
      testMatch: ['**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'e2e',
      roots: ['<rootDir>/test/e2e'],
      testMatch: ['**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
};
