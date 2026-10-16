// `npm test` runs Jest with --experimental-vm-modules: the MongoDB driver (v7) loads
// Node's `os` module with a dynamic import(), which Jest's sandbox only supports with
// that flag. Without it the driver sends empty client metadata and MongoDB rejects
// the connection. Production code is unaffected.
module.exports = {
  testEnvironment: 'node',
  // source maps let coverage report lines of the .ts files rather than the compiled JS
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: { sourceMap: true } }],
  },
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup/env.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'text-summary', 'json-summary'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
};
