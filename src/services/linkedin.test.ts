import { normalizeLinkedInUrl } from './linkedin';

describe('normalizeLinkedInUrl', () => {
  const testCases = [
    // Basic cases
    {
      description: 'Basic case',
      input: 'https://linkedin.com/in/username',
      expected: 'https://linkedin.com/in/username',
    },
    {
      description: 'With trailing slash',
      input: 'https://linkedin.com/in/username/',
      expected: 'https://linkedin.com/in/username',
    },

    // Variations in domain/protocol
    {
      description: 'www subdomain',
      input: 'https://www.linkedin.com/in/username',
      expected: 'https://linkedin.com/in/username',
    },
    {
      description: 'http protocol',
      input: 'http://linkedin.com/in/username',
      expected: 'https://linkedin.com/in/username',
    },
    {
      description: 'http and www',
      input: 'http://www.linkedin.com/in/username',
      expected: 'https://linkedin.com/in/username',
    },
    { description: 'No protocol', input: 'linkedin.com/in/username', expected: 'https://linkedin.com/in/username' },
    {
      description: 'www and no protocol',
      input: 'www.linkedin.com/in/username',
      expected: 'https://linkedin.com/in/username',
    },

    // Suffix variations (query params, fragments, etc.)
    {
      description: 'Simple query param',
      input: 'https://linkedin.com/in/username?param=1',
      expected: 'https://linkedin.com/in/username',
    },
    {
      description: 'Multiple query params',
      input: 'https://www.linkedin.com/in/username?utm_source=share&utm_campaign=share_via',
      expected: 'https://linkedin.com/in/username',
    },
    {
      description: 'Fragment',
      input: 'https://linkedin.com/in/username#section',
      expected: 'https://linkedin.com/in/username',
    },
    {
      description: 'Trailing slash and query param',
      input: 'https://linkedin.com/in/username/?locale=en_US',
      expected: 'https://linkedin.com/in/username',
    },

    // Username variations
    {
      description: 'Hyphens and numbers',
      input: 'https://linkedin.com/in/user-name-123',
      expected: 'https://linkedin.com/in/user-name-123',
    },
    {
      description: 'Trailing hyphen',
      input: 'https://linkedin.com/in/username-',
      expected: 'https://linkedin.com/in/username-',
    },
    {
      description: 'Longer example',
      input: 'www.linkedin.com/in/very-long-profile-name-with-numbers-1a2b3c',
      expected: 'https://linkedin.com/in/very-long-profile-name-with-numbers-1a2b3c',
    },
  ];

  it.each(testCases)('normalizes ($description): "$input" to "$expected"', ({ input, expected }) => {
    expect(normalizeLinkedInUrl(input)).toBe(expected);
  });

  // Test cases that should throw an error
  const errorCases = [
    { input: 'https://linkedin.com/company/company-name', description: 'Company URL' },
    { input: 'https://linkedin.com/pub/username/12/345/678', description: 'Public profile URL (/pub/)' },
    { input: 'invalid-url', description: 'Clearly invalid URL' },
    { input: '', description: 'Empty string' },
    { input: 'https://github.com/username', description: 'Non-LinkedIn URL' },
  ];

  it.each(errorCases)('throws an error for invalid URL ($description): "$input" ', ({ input }) => {
    expect(() => normalizeLinkedInUrl(input)).toThrow('Invalid LinkedIn URL format');
  });
});
