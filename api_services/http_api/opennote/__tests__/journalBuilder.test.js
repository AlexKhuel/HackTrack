'use strict';

const { buildTravelLinks } = require('../linkBuilder');
const { buildOpenNoteJournalPayload } = require('../journalBuilder');

describe('OpenNote link + journal builders', () => {
  const baseResult = {
    event: {
      id: 42,
      name: 'Hack UCI',
      city: 'Irvine',
      country: 'United States',
      start_datetime_utc: '2026-04-10T17:00:00Z',
      end_datetime_utc: '2026-04-12T17:00:00Z',
      url: 'https://example.com/hackuci',
    },
    route: {
      origin_airport: 'LAX',
      destination_airport: 'SFO',
    },
    cost_estimate: {
      estimated_flight_cost: 250,
      estimated_lodging_cost: 180,
      estimated_total_cost: 430,
    },
  };

  test('builds round-trip flights link with selected route origin', () => {
    const links = buildTravelLinks({
      result: baseResult,
      location: { city: 'San Francisco', country: 'United States' },
      venueLabel: 'San Francisco, CA, United States',
    });

    expect(links.googleFlightsLink).toContain('LAX.SFO.2026-04-10');
    expect(links.googleFlightsLink).toContain('*SFO.LAX.2026-04-12');
  });

  test('builds hotel and uber links with fallback-friendly values', () => {
    const links = buildTravelLinks({
      result: baseResult,
      location: { city: 'San Francisco', country: 'United States', latitude: null, longitude: null },
      venueLabel: 'San Francisco, CA, United States',
    });

    expect(links.hotelSearchLink).toContain('google.com/travel/hotels');
    expect(links.hotelSearchLink).toContain('San%20Francisco');
    expect(links.uberLink).toContain('m.uber.com/ul');
    expect(links.uberLink).toContain('dropoff%5Bformatted_address%5D');
  });

  test('uses Unknown fallback values for missing enrichment fields', () => {
    const links = buildTravelLinks({
      result: baseResult,
      location: { city: 'Unknown', state: 'Unknown', country: 'Unknown' },
      venueLabel: 'Unknown',
    });

    const payload = buildOpenNoteJournalPayload({
      result: {
        ...baseResult,
        event: {
          ...baseResult.event,
          city: null,
          country: null,
        },
      },
      school: 'Unknown',
      location: { city: 'Unknown', state: 'Unknown', country: 'Unknown' },
      venueLabel: 'Unknown',
      links,
    });

    expect(payload.metadata.school).toBe('Unknown');
    expect(payload.metadata.state).toBe('Unknown');
    expect(payload.metadata.country).toBe('Unknown');
    expect(payload.content_markdown).toContain('School: Unknown');
    expect(payload.content_markdown).toContain('State: Unknown');
  });
});
