import { mockLoggerService } from './mocks';
jest.mock('./logger', () => mockLoggerService);

import { logger } from './logger';
import { getAllOfficeRnDMembersData, getMemberLinkedin, getOfficeLocation } from './officernd';

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
  it('should return correct location given office uuid', () => {
    const location = getOfficeLocation('6685ac246c4b7640a1887a7c');
    expect(location).toEqual('San Francisco');
  });

  it.each(['', undefined, null])('returns null if no office uuid (office=%s)', (missingOffice) => {
    const location = getOfficeLocation(missingOffice);
    expect(location).toBeNull();
  });

  it('throws error if no hardcoded location for given office uuid', () => {
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
