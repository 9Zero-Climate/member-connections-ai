import dotenv from 'dotenv';
import { closeDbConnection } from '../services/database';

// Load environment variables from .env file
dotenv.config();

global.beforeAll(() => {});

global.afterAll(() => {
  closeDbConnection();
});
