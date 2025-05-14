import qs from 'qs';
import { config } from '../config';
import { OfficeLocation } from './database';
import { normalizeLinkedInUrl } from './linkedin';
import { logger } from './logger';

const OFFICERND_API_URL = 'https://app.officernd.com/api/v1';
const OFFICERND_ORG_SLUG = config.officerndOrgSlug;
// Active members are the only members that we care about. All others should be ignored/purged as they are nonmembers or former members
export const OFFICERND_ACTIVE_MEMBER_STATUS = 'active';

type OfficeRnDTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

// The shape of data returned directly from OfficeRnD fetch
export type OfficeRnDRawMemberData = {
  // First-class ORND properties
  _id: string;
  name: string;
  office: string; // uuid
  linkedin?: string | null; // Undocumented property, set by member in the member portal alongside other social links
  // Custom properies. If a member has none of these, the ORND webhook omits the "properties" attribute entirely
  properties?: {
    // Set/controlled by integrations
    slack_id?: string;
    // Set/controlled by 9Zero admin
    LinkedInViaAdmin?: string; // Intention is for 9Zero staff to be able to set if member hasn't set their own linkedin
    Sector?: string[];
    Subsector?: string;
    Blurb?: string; // "Talk to me about"
    Type?: string[]; // e.g. Startup, Investor, Ecosystem Services, Nonprofit, Corporation, etc..
    CurrentRole?: string;
  };
  calculatedStatus: string;
};

export type OfficeRnDRawCheckinData = {
  member: string; // member id
  team?: string; // team (aka company) id
  start: string; // start date in ISO string format
  end: string | null; // end date in ISO string format. null means member is currently checked in
  office?: string; // location (aka office) id
  createdAt: string; // ISO string
  createdBy: string; // string id of user that created the checkin
};

// See https://developer.officernd.com/docs/webhooks-getting-started#receiving-webhook-notifications
export type OfficeRnDRawWebhookPayload = {
  event: string;
  eventType: string;
  data: {
    object: OfficeRnDRawCheckinData | OfficeRnDRawMemberData;
    previousAttributes?: Partial<OfficeRnDRawCheckinData> | Partial<OfficeRnDRawMemberData>;
  };
  createdAt: string;
};

export type OfficeRnDMemberData = {
  id: string;
  name: string;
  slackId: string | null;
  linkedinUrl: string | null;
  location: OfficeLocation | null;
  sector?: string[];
  subsector?: string;
  blurb?: string;
  type?: string[];
  currentRole?: string;
};

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
    logger.warn(
      {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      },
      'Token request failed',
    );
    throw new Error(`Failed to get OfficeRnD access token: ${response.statusText}`);
  }

  const tokenData = (await response.json()) as OfficeRnDTokenResponse;
  accessToken = tokenData.access_token;
  tokenExpiry = new Date(Date.now() + (tokenData.expires_in - 60) * 1000); // Subtract 60s for safety margin

  return accessToken;
}

export const cleanMember = (member: OfficeRnDRawMemberData): OfficeRnDMemberData => ({
  id: member._id,
  name: member.name,
  location: getOfficeLocation(member.office),
  slackId: member.properties?.slack_id || null,
  linkedinUrl: getMemberLinkedin(member),
  sector: member.properties?.Sector,
  subsector: member.properties?.Subsector,
  blurb: member.properties?.Blurb,
  type: member.properties?.Type,
  currentRole: member.properties?.CurrentRole,
});

export async function getAllActiveOfficeRnDMembersData(): Promise<OfficeRnDMemberData[]> {
  logger.info('Fetching members from OfficeRnD...');

  if (!OFFICERND_ORG_SLUG) {
    throw new Error('OfficeRnD organization slug not configured');
  }

  const token = await getAccessToken();
  const response = await fetch(
    `${OFFICERND_API_URL}/organizations/${OFFICERND_ORG_SLUG}/members?calculatedStatus=${OFFICERND_ACTIVE_MEMBER_STATUS}&$limit=10000`,
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

  const members = rawMembers.map(cleanMember);

  logger.info(`Fetched ${members.length} active members from OfficeRnD.`);

  return members;
}

export const getMemberLinkedin = (member: OfficeRnDRawMemberData): string | null => {
  const rawLinkedinUrl =
    member.linkedin || // Prefer the member-set first-class OfficeRnD attribute
    member.properties?.LinkedInViaAdmin; // Fall back to the custom property that 9Zero staff can set

  if (rawLinkedinUrl) {
    try {
      return normalizeLinkedInUrl(rawLinkedinUrl);
    } catch (error) {
      logger.error(
        {
          err: error,
          rawLinkedinUrl,
          member,
        },
        'Error normalizing LinkedIn URL for member. Storing null for now',
      );
    }
  }

  return null;
};

// Hardcoding for now to save the extra fetch
const LOCATION_FROM_OFFICE_UUID: Record<string, OfficeLocation> = {
  '6685ac246c4b7640a1887a7c': OfficeLocation.SAN_FRANCISCO,
  '66ba452ec6f7e32d09cfd7d3': OfficeLocation.SEATTLE,
};

export const getOfficeLocation = (office: string | undefined | null): OfficeLocation | null => {
  if (office == null || office === '') {
    return null;
  }

  const location = LOCATION_FROM_OFFICE_UUID[office];

  if (location == null) {
    throw new Error(`No hardcoded location for member.office uuid: ${office}`);
  }

  return location;
};
