import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';
import { migrateAll } from '../scripts/migrate';

let testDbContainer: StartedTestContainer;

export const setupTestDb = async (): Promise<string> => {
  console.log('Global test setup: creating test db container');

  testDbContainer = await new PostgreSqlContainer('pgvector/pgvector:pg16').withExposedPorts(5432).start();

  // There's no documentation on using test:test as user:password for the postres testcontainer,
  // but postgres throws an error if password is not provided, and blindly trying test:test worked
  const connectionString = `postgres://test:test@${testDbContainer.getHost()}:${testDbContainer.getMappedPort(5432)}`;

  await migrateAll(connectionString);

  return connectionString;
};

export const teardownTestDb = async () => {
  console.log('Global test teardown: stopping test db container');

  await testDbContainer.stop();
};
