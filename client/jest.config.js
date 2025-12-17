module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  moduleNameMapper: {
    '^@vercel/analytics/react$': '<rootDir>/src/__mocks__/@vercel/analytics/react.js',
  },
};
