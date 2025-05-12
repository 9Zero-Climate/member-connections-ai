import { config } from '../config';
import { logger } from './logger';

const PROXYCURL_API_URL = 'https://nubela.co/proxycurl/api/v2/linkedin';

export interface ProxycurlDateObject {
  day: number;
  month: number;
  year: number;
}

export interface ProxycurlProfile {
  headline: string | null;
  summary: string | null;
  experiences: Array<{
    title: string | null;
    company: string;
    description: string | null;
    starts_at: ProxycurlDateObject | null;
    ends_at: ProxycurlDateObject | null;
    location: string | null;
    date_range?: string | null;
  }>;
  education: Array<{
    school: string;
    degree_name: string | null;
    field_of_study: string | null;
    starts_at: ProxycurlDateObject | null;
    ends_at: ProxycurlDateObject | null;
    description: string | null;
    date_range?: string | null;
  }>;
  skills: string[];
  languages: string[];
}

/**
 * Fetches a LinkedIn profile using the Proxycurl API.
 * @param linkedinUrl - The URL of the LinkedIn profile.
 * @returns The parsed LinkedIn profile data, or null if not found or error occurs.
 */
export async function getLinkedInProfile(linkedinUrl: string): Promise<ProxycurlProfile | null> {
  const apiKey = config.proxycurlApiKey;

  if (apiKey === null || apiKey === undefined) {
    logger.error('Error: Proxycurl API key not configured');
    throw new Error('Proxycurl API key not configured');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const response = await fetch(`${PROXYCURL_API_URL}?url=${encodeURIComponent(linkedinUrl)}`, {
      headers,
    });

    if (response.status === 404) {
      logger.warn('LinkedIn profile not found:', { linkedinUrl });
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          linkedinUrl,
        },
        'Proxycurl API error',
      );
      // Consider specific error handling based on status codes if needed
      throw new Error(`Proxycurl API error: ${response.statusText}`);
    }

    return (await response.json()) as ProxycurlProfile;
  } catch (error) {
    logger.error({ err: error, linkedinUrl }, 'Error fetching LinkedIn profile');
    throw error; // Re-throw after logging
  }
}
