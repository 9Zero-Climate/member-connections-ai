import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { migrateAll } from '../scripts/migrate';
import { setClient, unsetClient } from '../services/database';

let testDbContainer: StartedTestContainer;
let testDbClient: Client;

export const setupTestDb = async () => {
  console.log('Global test setup: creating test db container and client');

  testDbContainer = await new PostgreSqlContainer('pgvector/pgvector:pg16').withExposedPorts(5432).start();

  // There's no documentation on using test:test as user:password for the postres testcontainer,
  // but postgres throws an error if password is not provided, and blindly trying test:test worked
  const connectionString = `postgres://test:test@${testDbContainer.getHost()}:${testDbContainer.getMappedPort(5432)}`;

  await migrateAll(connectionString);

  testDbClient = new Client({ connectionString });
  await testDbClient.connect();

  setClient(testDbClient);
};

export const teardownTestDb = async () => {
  console.log('Global test teardown: stopping test db container and client');

  unsetClient();
  await testDbClient.end();
  await testDbContainer.stop();
};
