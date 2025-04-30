import qs from 'qs';
import { config } from '../config';
import { type Member, MemberLocation } from './database';
import { logger } from './logger';

const OFFICERND_API_URL = 'https://app.officernd.com/api/v1';
const OFFICERND_ORG_SLUG = config.officerndOrgSlug;

type OfficeRnDTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

// The shape of data returned directly from OfficeRnD fetch
type OfficeRnDRawMemberData = {
  _id: string;
  name: string;
  office: string; // uuid
  linkedin?: string | null; // Undocumented property, set by member in the member portal alongside other social links
  properties: {
    slack_id?: string;
    LinkedInViaAdmin?: string; // Custom propery, intention is for 9Zero staff to be able to set if member hasn't set their own linkedin
    [key: string]: string | undefined; // Allow other string properties
  };
};

type OfficeRnDMember = Pick<Member, 'officernd_id' | 'name' | 'slack_id' | 'linkedin_url' | 'location'>;

let accessToken: string | null = null;
let tokenExpiry: Date | null = null;

/**
 * Get a valid access token, refreshing if necessary
 */
async function getAccessToken(): Promise<string> {
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
    return accessToken;
  }

  const clientId = config.officerndClientId;
  const clientSecret = config.officerndClientSecret;

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
      location: getMemberLocation(member.office),
      slack_id: member.properties.slack_id || null,
      linkedin_url: getMemberLinkedin(member),
    };
  });

  logger.info(`Fetched ${members.length} active members from OfficeRnD.`);

  return members;
}

export const getMemberLinkedin = (member: OfficeRnDRawMemberData): string | null => {
  return (
    member.linkedin || // Prefer the member-set first-class OfficeRnD attribute
    member.properties.LinkedInViaAdmin || // Fall back to the custom property that 9Zero staff can set
    null
  );
};

// Hardcoding for now to save the extra fetch
const LOCATION_FROM_OFFICE_UUID: Record<string, MemberLocation> = {
  '6685ac246c4b7640a1887a7c': MemberLocation.SAN_FRANCISCO,
  '66ba452ec6f7e32d09cfd7d3': MemberLocation.SEATTLE,
};

export const getMemberLocation = (office: string | undefined | null): MemberLocation | null => {
  if (office == null || office === '') {
    return null;
  }

  const location = LOCATION_FROM_OFFICE_UUID[office];

  if (location == null) {
    throw new Error(`No hardcoded location for member.office uuid: ${office}`);
  }

  return location;
};
