import qs from 'qs';
import { config } from '../config'; // Import unified config
import { logger } from './logger';

// Define the shape of data returned directly from OfficeRnD fetch
export interface OfficeRnDMember {
  officernd_id: string;
  name: string;
  slack_id: string | null;
  linkedin_url: string | null;
}

const OFFICERND_API_URL = 'https://app.officernd.com/api/v1';
const OFFICERND_ORG_SLUG = config.officerndOrgSlug; // Use config

interface OfficeRnDTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface OfficeRnDMemberProperty {
  key: string;
  value: string;
}

interface OfficeRnDRawMemberData {
  _id: string;
  name: string;
  properties: {
    slack_id?: string;
    LinkedInViaAdmin?: string;
    [key: string]: string | undefined; // Allow other string properties
  };
}

let accessToken: string | null = null;
let tokenExpiry: Date | null = null;

/**
 * Get a valid access token, refreshing if necessary
 */
async function getAccessToken(): Promise<string> {
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
    return accessToken;
  }

  const clientId = config.officerndClientId; // Use config
  const clientSecret = config.officerndClientSecret; // Use config

  if (!clientId || !clientSecret) {
    throw new Error('OfficeRnD credentials not configured');
  }

  const data = qs.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'officernd.api.read',
  });

  const response = await fetch('https://identity.officernd.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Token request failed:', {
      status: response.status,
      statusText: response.statusText,
      body: errorText,
    });
    throw new Error(`Failed to get OfficeRnD access token: ${response.statusText}`);
  }

  const tokenData = (await response.json()) as OfficeRnDTokenResponse;
  accessToken = tokenData.access_token;
  tokenExpiry = new Date(Date.now() + (tokenData.expires_in - 60) * 1000); // Subtract 60s for safety margin

  return accessToken;
}

/**
 * Get all members from OfficeRnD, returning only the data fetched.
 */
export async function getAllMembers(): Promise<OfficeRnDMember[]> {
  logger.info('Fetching members from OfficeRnD...');

  if (!OFFICERND_ORG_SLUG) {
    throw new Error('OfficeRnD organization slug not configured');
  }

  const token = await getAccessToken();
  const response = await fetch(
    `${OFFICERND_API_URL}/organizations/${OFFICERND_ORG_SLUG}/members?calculatedStatus=active&$limit=10000`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get OfficeRnD members: ${response.statusText}, response: ${JSON.stringify(response)}`);
  }

  const rawMembers = (await response.json()) as OfficeRnDRawMemberData[];

  const members = rawMembers.map((member): OfficeRnDMember => {
    return {
      officernd_id: member._id,
      name: member.name,
      slack_id: member.properties?.slack_id || null,
      linkedin_url: member.properties?.LinkedInViaAdmin || null,
    };
  });

  logger.info(`Fetched ${members.length} active members from OfficeRnD.`);

  return members;
}
