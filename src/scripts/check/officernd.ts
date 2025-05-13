import { logger } from '../../services/logger';
import { getAllActiveOfficeRnDMembersData } from '../../services/officernd';

export async function checkOfficeRnDConnection() {
  logger.info('Attempting to connect to OfficeRnD and fetch members...');
  try {
    const members = await getAllActiveOfficeRnDMembersData();
    logger.info(`Successfully fetched ${members.length} members.`);

    const missingLocation = members.filter((member) => member.location == null);
    const missingLinkedin = members.filter((member) => member.linkedinUrl == null);
    const missingSlack = members.filter((member) => member.slackId == null);

    logger.info(`Missing location: ${missingLocation.length}`);
    logger.info(`Missing linkedin: ${missingLinkedin.length}`);
    logger.info(`Missing slack: ${missingSlack.length}`);

    logger.info(
      `Members missing linkedin: ${missingLinkedin
        .map((member) => member.name)
        .sort()
        .join(', ')}`,
    );

    if (members && members.length > 0) {
      const sampleSize = Math.min(members.length, 5);
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
