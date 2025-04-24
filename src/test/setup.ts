import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

global.beforeAll(() => {});

global.afterAll(() => {
  // Wait to import this until the last minute so that it can't get in the way of import ordering for
  // mocking modules. And then use requireActual to bypass jest module mocking
  const { closeDbConnection } = jest.requireActual('../services/database');
  closeDbConnection();
});
