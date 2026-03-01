'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const hackathonsRouter = require('../hackathons');

describe('hackathons route helper guards', () => {
  const {
    buildCityCandidateTokens,
    isAmbiguousUsCityWithoutExplicitUsCountry,
  } = hackathonsRouter._private;

  test('city tokenization includes top-level and segmented tokens', () => {
    expect(buildCityCandidateTokens('Toronto, Ontario')).toEqual(['toronto ontario', 'toronto', 'ontario']);
  });

  test('flags Ontario as ambiguous when country is missing', () => {
    expect(isAmbiguousUsCityWithoutExplicitUsCountry('Ontario', null)).toBe(true);
    expect(isAmbiguousUsCityWithoutExplicitUsCountry('Toronto, Ontario', null)).toBe(true);
  });

  test('does not flag Ontario when event is explicitly in the US', () => {
    expect(isAmbiguousUsCityWithoutExplicitUsCountry('Ontario', 'United States')).toBe(false);
    expect(isAmbiguousUsCityWithoutExplicitUsCountry('Ontario', 'USA')).toBe(false);
  });

  test('does not flag non-ambiguous US cities', () => {
    expect(isAmbiguousUsCityWithoutExplicitUsCountry('Irvine', null)).toBe(false);
    expect(isAmbiguousUsCityWithoutExplicitUsCountry('Los Angeles', null)).toBe(false);
  });
});
