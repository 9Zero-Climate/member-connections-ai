import { mockLoggerService } from './mocks';
import type { OfficeRnDRawMemberData } from './officernd';
jest.mock('./logger', () => mockLoggerService);

import { logger } from './logger';
import { cleanMember, getAllActiveOfficeRnDMembersData, getMemberLinkedin, getOfficeLocation } from './officernd';

// Test fixtures
const TEST_LINKEDIN_URL = 'https://linkedin.com/in/testmember';
const TEST_LINKEDIN_ALT_URL = 'https://linkedin.com/in/altkey';
const TEST_MEMBER_ID = 'member-123';
const TEST_MEMBER_NAME = 'Test Member';
const SEATTLE_OFFICE_ID = '66ba452ec6f7e32d09cfd7d3';
const SF_OFFICE_ID = '6685ac246c4b7640a1887a7c';
const TEST_SLACK_ID = 'U123XYZ';

const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

describe('OfficeRnD Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllActiveOfficeRnDMembersData', () => {
    it('should get all members', async () => {
      // Mock token response
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'mock-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // Mock members response with properties as an object
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              _id: '1',
              name: 'John Doe',
              office: SF_OFFICE_ID,
              properties: {
                slack_id: 'U123',
                LinkedInViaAdmin: TEST_LINKEDIN_URL,
                other_prop: 'other_value',
              },
            },
            {
              _id: '2',
              name: 'Jane Smith',
              properties: {
                slack_id: 'U456',
                // Missing LinkedInViaAdmin for this member
              },
            },
          ]),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const members = await getAllActiveOfficeRnDMembersData();
      expect(mockFetch).toHaveBeenCalledTimes(2); // Token + Members
      expect(Array.isArray(members)).toBe(true);
      expect(members).toHaveLength(2);

      // Check first member
      expect(members[0]).toMatchObject({
        id: '1',
        name: 'John Doe',
        slackId: 'U123',
        linkedinUrl: TEST_LINKEDIN_URL,
        location: 'San Francisco',
      });

      // Check second member (missing linkedin)
      expect(members[1]).toMatchObject({
        id: '2',
        name: 'Jane Smith',
        slackId: 'U456',
        linkedinUrl: null,
        location: null,
      });
    });
  });

  describe('getOfficeLocation', () => {
    it.each([
      { officeId: SEATTLE_OFFICE_ID, expected: 'Seattle' },
      { officeId: SF_OFFICE_ID, expected: 'San Francisco' },
    ])('maps $officeId to $expected location', ({ officeId, expected }) => {
      expect(getOfficeLocation(officeId)).toBe(expected);
    });

    it.each([null, undefined])('returns null for %s office', (officeId) => {
      expect(getOfficeLocation(officeId)).toBeNull();
    });

    it('throws an error if office is not a UUID nor undefined/null', () => {
      expect(() => getOfficeLocation('unknown office uuid')).toThrow(/unknown office uuid/);
    });
  });

  describe('getMemberLinkedin', () => {
    const mockMember = {
      _id: TEST_MEMBER_ID,
      name: TEST_MEMBER_NAME,
      office: SF_OFFICE_ID,
      linkedin: TEST_LINKEDIN_URL,
      properties: {
        LinkedInViaAdmin: TEST_LINKEDIN_ALT_URL,
      },
      calculatedStatus: 'active',
    };

    it('should return member.linkedin if present', () => {
      const linkedinUrl = getMemberLinkedin(mockMember);
      expect(linkedinUrl).toEqual(TEST_LINKEDIN_URL);
    });

    it.each(['', undefined, null])(
      'should fall back to member.properties.LinkedInViaAdmin if member.linkedin missing (linkedin=%s)',
      (missingMemberLinkedin) => {
        const linkedinUrl = getMemberLinkedin({
          ...mockMember,
          linkedin: missingMemberLinkedin,
        });
        expect(linkedinUrl).toEqual(TEST_LINKEDIN_ALT_URL);
      },
    );

    it('should return null if neither', () => {
      const linkedinUrl = getMemberLinkedin({
        ...mockMember,
        linkedin: undefined,
        properties: {},
      });
      expect(linkedinUrl).toBeNull();
    });

    it('should log an error and return null if linkedin is malformed', () => {
      const linkedinUrl = getMemberLinkedin({
        ...mockMember,
        linkedin: 'invalid-linkedin-url',
      });
      expect(linkedinUrl).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should normalize linkedin URL if possible', () => {
      const linkedinUrl = getMemberLinkedin({
        ...mockMember,
        linkedin: 'http://www.linkedin.com/in/thejohndoe/',
      });
      expect(linkedinUrl).toEqual('https://linkedin.com/in/thejohndoe');
    });
  });

  describe('cleanMember', () => {
    let mockGetOfficeLocation: jest.SpyInstance;
    const seattleOfficeId = 'office-sea';
    const sfOfficeId = 'office-sf';

    beforeEach(() => {
      mockGetOfficeLocation = jest.spyOn(require('./officernd'), 'getOfficeLocation').mockImplementation((officeId) => {
        if (officeId === seattleOfficeId) return 'Seattle';
        if (officeId === sfOfficeId) return 'San Francisco';
        if (!officeId) return null;
        return null;
      });
    });

    const baseRawMember: OfficeRnDRawMemberData = {
      _id: TEST_MEMBER_ID,
      name: TEST_MEMBER_NAME,
      office: seattleOfficeId,
      properties: {
        slack_id: TEST_SLACK_ID,
        Sector: ['Technology'],
        Subsector: 'SaaS',
        Blurb: 'A test blurb.',
        Type: ['Startup'],
        CurrentRole: 'Engineer',
        // LinkedInViaAdmin property can be missing
      },
      calculatedStatus: 'active',
    };

    it('correctly cleans a full member object', () => {
      const member = {
        ...baseRawMember,
        linkedin: TEST_LINKEDIN_URL,
      };
      const cleaned = cleanMember(member);
      expect(cleaned).toEqual({
        id: TEST_MEMBER_ID,
        name: TEST_MEMBER_NAME,
        location: 'Seattle',
        slackId: TEST_SLACK_ID,
        linkedinUrl: TEST_LINKEDIN_URL,
        sector: ['Technology'],
        subsector: 'SaaS',
        blurb: 'A test blurb.',
        type: ['Startup'],
        currentRole: 'Engineer',
      });
    });

    it('handles missing optional properties', () => {
      const minimalRawMember: OfficeRnDRawMemberData = {
        _id: 'member-min',
        name: 'Minimal Member',
        office: '',
        calculatedStatus: 'active',
      };

      const cleaned = cleanMember(minimalRawMember);
      expect(cleaned).toEqual({
        id: 'member-min',
        name: 'Minimal Member',
        location: null,
        slackId: null,
        linkedinUrl: null,
        sector: undefined,
        subsector: undefined,
        blurb: undefined,
        type: undefined,
        currentRole: undefined,
      });
    });

    it('returns null for LinkedIn URL if property is missing or empty', () => {
      const cleaned = cleanMember(baseRawMember);
      expect(cleaned.linkedinUrl).toBeNull();

      const rawMemberEmptyLinkedIn = {
        ...baseRawMember,
        properties: {
          ...baseRawMember.properties,
          'LinkedIn Profile': '',
        },
      };
      const cleanedEmpty = cleanMember(rawMemberEmptyLinkedIn);
      expect(cleanedEmpty.linkedinUrl).toBeNull();
    });

    it.each([
      {
        name: 'directly on member',
        member: { ...baseRawMember, linkedin: TEST_LINKEDIN_URL },
        expected: TEST_LINKEDIN_URL,
      },
      {
        name: 'on properties',
        member: {
          ...baseRawMember,
          properties: { ...baseRawMember.properties, LinkedInViaAdmin: TEST_LINKEDIN_ALT_URL },
        },
        expected: TEST_LINKEDIN_ALT_URL,
      },
      {
        name: 'on member takes precedence',
        member: {
          ...baseRawMember,
          linkedin: TEST_LINKEDIN_URL,
          properties: { ...baseRawMember.properties, LinkedInViaAdmin: TEST_LINKEDIN_ALT_URL },
        },
        expected: TEST_LINKEDIN_URL,
      },
    ])('handles LinkedIn source: $name', ({ member, expected }) => {
      const cleaned = cleanMember(member);
      expect(cleaned.linkedinUrl).toBe(expected);
    });
  });
});
