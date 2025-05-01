import { logger } from './logger';

/* The linkedin URLs we get from users are all over the place, so we need to normalize them
 *    Desired format for storage and output: https://linkedin.com/in/username
 */
export const normalizeLinkedInUrl = (linkedinUrl: string): string => {
  // Regex to capture the profile identifier after "/in/", stopping at ?, #, or trailing /
  const profileRegex = /\/in\/([^?#\/]+)/;
  const match = linkedinUrl.match(profileRegex);

  const profileIdentifier = match?.[1];
  if (profileIdentifier) {
    // Construct the canonical URL
    return `https://linkedin.com/in/${profileIdentifier}`;
  }
  // Handle cases where the URL doesn't match the expected format
  logger.error({ linkedinUrl }, 'Invalid LinkedIn URL format');
  throw new Error(`Invalid LinkedIn URL format: ${linkedinUrl} - could not extract profile identifier`);
};
