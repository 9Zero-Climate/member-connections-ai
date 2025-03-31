import { config } from 'dotenv';
import qs from 'qs';
import type { Member } from './database';

// Load environment variables
config();

const OFFICERND_API_URL = 'https://app.officernd.com/api/v1';
const OFFICERND_ORG_SLUG = process.env.OFFICERND_ORG_SLUG;

interface OfficeRnDTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface OfficeRnDMember {
  _id: string;
  name: string;
  linkedin?: string;
  customFields?: Record<string, string>;
  properties?: {
    slack_id?: string;
    LinkedInViaAdmin?: string;
    [key: string]: string | boolean | undefined;
  };
  // Note: slackId is not available in the API response
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

  const clientId = process.env.OFFICERND_CLIENT_ID;
  const clientSecret = process.env.OFFICERND_CLIENT_SECRET;

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
    console.error('Token request failed:', {
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
      slack_id: member.properties?.slack_id || null,
      linkedin_url: member.properties?.LinkedInViaAdmin || member.linkedin || null,
    };
    return mappedMember;
  });
}
