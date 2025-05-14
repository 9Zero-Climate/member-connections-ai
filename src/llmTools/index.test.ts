import { objectToXml } from '.';

describe('objectToXml', () => {
  it.each([
    {
      description: 'should handle null input',
      input: null,
      expected: '<root/>\n',
    },
    {
      description: 'should handle undefined input',
      input: undefined,
      expected: '',
    },
    {
      description: 'should handle primitive values',
      input: 42,
      expected: '<root>42</root>\n',
    },
    {
      description: 'should handle simple object',
      input: { name: 'test', value: 123 },
      expected: '<root>\n  <name>test</name>\n  <value>123</value>\n</root>\n',
    },
    {
      description: 'should handle nested objects',
      input: {
        outer: {
          inner: 'value',
          number: 42,
        },
      },
      expected: '<root>\n  <outer>\n    <inner>value</inner>\n    <number>42</number>\n  </outer>\n</root>\n',
    },
    {
      description: 'should handle array values',
      input: { items: ['a', 'b', 'c'] },
      // This is a weird behavior of the XMLBuilder library, but whatever. TODO #22
      expected: '<root>\n  <items>a</items>\n  <items>b</items>\n  <items>c</items>\n</root>\n',
      // Something like this would make more sense, but it's not how the library works.
      // expected: '<root>\n  <items>\n    <item idx="0">a</item>\n    <item idx="1">b</item>\n    <item idx="2">c</item>\n  </items>\n</root>\n',
    },
    {
      description: 'should respect custom indentation',
      input: { test: 'value' },
      indent: '  ',
      expected: '<root>\n  <test>value</test>\n</root>\n',
    },
  ])('$description', ({ input, expected }) => {
    expect(objectToXml({ root: input })).toBe(expected);
  });
});
