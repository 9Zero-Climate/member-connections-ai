import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';
import { migrateAll } from '../scripts/migrate';

let testDbContainer: StartedTestContainer;

export const setupTestDb = async () => {
  console.log('Global test setup: creating test db container');

  testDbContainer = await new PostgreSqlContainer('pgvector/pgvector:pg16').withExposedPorts(5432).start();

  // There's no documentation on using test:test as user:password for the postres testcontainer,
  // but postgres throws an error if password is not provided, and blindly trying test:test worked
  const connectionString = `postgres://test:test@${testDbContainer.getHost()}:${testDbContainer.getMappedPort(5432)}`;

  // Jest resets all global variables between tests, so the only way to get a variable out of
  // global setup is via setting environment variables
  // Also, this way the migrateAll command can pull the connectionString from env var as usual
  process.env.DB_URL = connectionString;

  await migrateAll();
};

export const teardownTestDb = async () => {
  console.log('Global test teardown: stopping test db container');

  await testDbContainer.stop();
};
