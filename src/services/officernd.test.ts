import { mockLoggerService } from './mocks';
import type { OfficeRnDRawMemberData } from './officernd';
jest.mock('./logger', () => mockLoggerService);

import { logger } from './logger';
import { cleanMember, getAllOfficeRnDMembersData, getMemberLinkedin, getOfficeLocation } from './officernd';

const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

describe('OfficeRnD Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
            office: '6685ac246c4b7640a1887a7c',
            properties: {
              slack_id: 'U123',
              LinkedInViaAdmin: 'https://linkedin.com/in/johndoe',
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

    const members = await getAllOfficeRnDMembersData();
    expect(mockFetch).toHaveBeenCalledTimes(2); // Token + Members
    expect(Array.isArray(members)).toBe(true);
    expect(members).toHaveLength(2);

    // Check first member
    expect(members[0]).toMatchObject({
      id: '1',
      name: 'John Doe',
      slackId: 'U123',
      linkedinUrl: 'https://linkedin.com/in/johndoe',
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
  it('maps Seattle office IDs to Seattle location', () => {
    // Use only known IDs from the mapping
    expect(getOfficeLocation('66ba452ec6f7e32d09cfd7d3')).toBe('Seattle');
  });

  it('maps San Francisco office IDs to San Francisco location', () => {
    // Use only known IDs from the mapping
    expect(getOfficeLocation('6685ac246c4b7640a1887a7c')).toBe('San Francisco');
  });

  it('returns null for null/undefined office', () => {
    expect(getOfficeLocation(null)).toBeNull();
    expect(getOfficeLocation(undefined)).toBeNull();
  });

  it('throws an error if office is not a UUID nor undefined/null', () => {
    expect(() => getOfficeLocation('unknown office uuid')).toThrow(/unknown office uuid/);
  });
});

describe('getMemberLinkedin', () => {
  const mockMember = {
    _id: '1',
    name: 'John Doe',
    office: '6685ac246c4b7640a1887a7c',
    linkedin: 'https://linkedin.com/in/johndoe',
    properties: {
      LinkedInViaAdmin: 'https://linkedin.com/in/thejohndoe',
    },
    calculatedStatus: 'active',
  };

  it('should return member.linkedin if present', () => {
    const linkedinUrl = getMemberLinkedin(mockMember);
    expect(linkedinUrl).toEqual('https://linkedin.com/in/johndoe');
  });

  it.each(['', undefined, null])(
    'should fall back to member.properties.LinkedInViaAdmin if member.linkedin missing (linkedin=%s)',
    (missingMemberLinkedin) => {
      const linkedinUrl = getMemberLinkedin({
        ...mockMember,
        linkedin: missingMemberLinkedin,
      });
      expect(linkedinUrl).toEqual('https://linkedin.com/in/thejohndoe');
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

describe('OfficerND Service', () => {
  describe('cleanMember', () => {
    // Properly mock only getOfficeLocation
    let mockGetOfficeLocation: jest.SpyInstance;

    beforeEach(() => {
      // Spy on the function
      mockGetOfficeLocation = jest.spyOn(require('./officernd'), 'getOfficeLocation').mockImplementation((officeId) => {
        if (officeId === 'office-sea') return 'Seattle';
        if (officeId === 'office-sf') return 'San Francisco';
        return null;
      });
    });

    afterEach(() => {
      // Restore original function
      mockGetOfficeLocation.mockRestore();
    });

    const baseRawMember: OfficeRnDRawMemberData = {
      _id: 'member-123',
      name: 'Test Member',
      office: 'office-sea', // Use string ID instead of object
      properties: {
        slack_id: 'U123XYZ',
        Sector: ['Technology'],
        Subsector: 'SaaS',
        Blurb: 'A test blurb.',
        Type: ['Startup'],
        CurrentRole: 'Engineer',
        // Add the property expected by getMemberLinkedin (use undefined instead of null)
        LinkedInViaAdmin: undefined,
      },
      calculatedStatus: 'active',
    };

    it('correctly cleans a full member object', () => {
      const rawMemberWithLinkedIn = {
        ...baseRawMember,
        // Add the linkedin property directly, which getMemberLinkedin checks first
        linkedin: 'https://linkedin.com/in/testmember',
      };
      const cleaned = cleanMember(rawMemberWithLinkedIn);
      expect(cleaned).toEqual({
        id: 'member-123',
        name: 'Test Member',
        location: 'Seattle',
        slackId: 'U123XYZ',
        linkedinUrl: 'https://linkedin.com/in/testmember',
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
        office: '', // Use empty string instead of null/undefined to match the type
        properties: {
          // Use undefined instead of null
          LinkedInViaAdmin: undefined,
        },
        calculatedStatus: 'active',
      };

      // Ensure our mock returns null for empty string office
      mockGetOfficeLocation.mockImplementation((officeId) => {
        if (officeId === 'office-sea') return 'Seattle';
        if (officeId === 'office-sf') return 'San Francisco';
        if (!officeId) return null;
        return null;
      });

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

    it('handles different LinkedIn property keys', () => {
      const rawMemberLinkedInAltKey = {
        ...baseRawMember,
        properties: {
          ...baseRawMember.properties,
          // Use LinkedInViaAdmin which is a valid fallback property
          LinkedInViaAdmin: 'https://linkedin.com/in/altkey',
        },
      };
      const cleaned = cleanMember(rawMemberLinkedInAltKey);
      expect(cleaned.linkedinUrl).toBe('https://linkedin.com/in/altkey');
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
  });
});
