'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const hackathonsRouter = require('../hackathons');

describe('hackathons route helper guards', () => {
  const {
    buildCityCandidateTokens,
    extractUniversitySchoolName,
    inferLocationFromHeroDetails,
    isAmbiguousUsCityWithoutExplicitUsCountry,
    normalizeUsStateCode,
    pickBestSchoolName,
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

  test('extracts university school names from descriptive text', () => {
    const text = 'Join us for HackCU, the largest hackathon at the University of Colorado, Boulder.';
    expect(extractUniversitySchoolName(text)).toBe('University of Colorado Boulder');
  });

  test('parses hero details into venue and US location fields', () => {
    const details = inferLocationFromHeroDetails('March 7-8, 2026 • Eaton Humanities • Boulder, Colorado');
    expect(details).toEqual({
      venue_name: 'Eaton Humanities',
      city: 'Boulder',
      state: 'Colorado',
      state_code: 'CO',
      country: 'United States',
    });
  });

  test('normalizes US state tokens into 2-letter codes', () => {
    expect(normalizeUsStateCode('Colorado')).toBe('CO');
    expect(normalizeUsStateCode('co')).toBe('CO');
    expect(normalizeUsStateCode('US-CO')).toBe('CO');
    expect(normalizeUsStateCode('Ontario')).toBe('');
  });

  test('prefers formal school names over short brand names', () => {
    expect(pickBestSchoolName('HackCU', 'University of Colorado Boulder')).toBe('University of Colorado Boulder');
  });
});
