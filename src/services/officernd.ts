import qs from 'qs';
import { config } from '../config'; // Import unified config
import type { Member } from './database';
import { logger } from './logger';

// Load environment variables - removed
// config();

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

interface OfficeRnDMember {
  _id: string;
  name: string;
  properties: OfficeRnDMemberProperty[];
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
 * Get all members from OfficeRnD
 */
export async function getAllMembers(): Promise<Member[]> {
  if (!OFFICERND_ORG_SLUG) {
    throw new Error('OfficeRnD organization slug not configured');
  }

  const token = await getAccessToken();
  const response = await fetch(`${OFFICERND_API_URL}/organizations/${OFFICERND_ORG_SLUG}/members`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get OfficeRnD members: ${response.statusText}`);
  }

  const members = (await response.json()) as OfficeRnDMember[];
  return members.map((member) => {
    const mappedMember = {
      officernd_id: member._id,
      name: member.name,
      slack_id: member.properties?.find((p) => p.key === 'slack_id')?.value || null,
      linkedin_url: member.properties?.find((p) => p.key === 'LinkedInViaAdmin')?.value || null,
    };
    return mappedMember;
  });
}
