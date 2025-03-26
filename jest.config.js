module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*_test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true,
};
