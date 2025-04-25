import { setupTestDb } from './setupTestDb';

module.exports = async () => {
  const connectionString = await setupTestDb();

  // Jest resets all global variables between tests, so the only way to get a variable out of
  // global setup is via setting environment variables
  process.env.DB_URL = connectionString;
};
