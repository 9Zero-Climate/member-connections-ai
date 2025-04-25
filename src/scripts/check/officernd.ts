import { logger } from '../../services/logger';
import { getAllMembers } from '../../services/officernd';

export async function checkOfficeRnDConnection() {
  logger.info('Attempting to connect to OfficeRnD and fetch members...');
  try {
    const members = await getAllMembers();

    if (members && members.length > 0) {
      const sampleSize = Math.min(members.length, 5);
      logger.info(`Successfully fetched ${members.length} members.`);
      logger.info(`Logging the first ${sampleSize} members received:`);

      for (let i = 0; i < sampleSize; i++) {
        console.log(`\n--- Member ${i + 1} ---`);
        // Log the whole structure to see properties format
        console.log(JSON.stringify(members[i], null, 2));
      }
    } else {
      logger.warn('No members found or returned from OfficeRnD.');
    }
  } catch (error) {
    // Use console.error to ensure the error object itself is logged
    console.error('Error testing OfficeRnD connection:', error);
    logger.error('Error testing OfficeRnD connection:', { error }); // Log via logger too
    process.exitCode = 1; // Indicate failure
  }
}
