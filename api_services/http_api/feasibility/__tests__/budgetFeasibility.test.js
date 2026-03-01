'use strict';

const {
  checkBudgetFeasibility,
  resolveAirport,
  resolveAirportCity,
  resolveAirportTimezone,
  estimateLodging,
} = require('../budgetFeasibility');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvent(city, country = null) {
  return { city, country };
}

function makeRoute({ outbound = 200, return: ret = 180, destinationAirport = null } = {}) {
  return {
    avg_outbound_price: outbound,
    avg_return_price: ret,
    destination_airport: destinationAirport,
  };
}

// ─── resolveAirport ───────────────────────────────────────────────────────────

describe('resolveAirport', () => {
  test('maps known cities (case-insensitive)', () => {
    expect(resolveAirport('San Francisco')).toBe('SFO');
    expect(resolveAirport('boston')).toBe('BOS');
    expect(resolveAirport('NEW YORK')).toBe('JFK');
    expect(resolveAirport('Chicago')).toBe('ORD');
  });

  test('maps city aliases', () => {
    expect(resolveAirport('NYC')).toBe('JFK');
    expect(resolveAirport('sf')).toBe('SFO');
    expect(resolveAirport('DC')).toBe('DCA');
    expect(resolveAirport('Berkeley')).toBe('SFO');
    expect(resolveAirport('Irvine')).toBe('SNA');
    expect(resolveAirport('Ontario')).toBe('ONT');
  });

  test('uses country to disambiguate US-only city mappings', () => {
    expect(resolveAirport('Ontario', { country: 'United States' })).toBe('ONT');
    expect(resolveAirport('Ontario', { country: 'Canada' })).toBeNull();
    expect(resolveAirport('Cambridge', { country: 'United Kingdom' })).toBeNull();
  });

  test('returns null for unknown city', () => {
    expect(resolveAirport('Smalltown')).toBeNull();
    expect(resolveAirport('')).toBeNull();
    expect(resolveAirport(null)).toBeNull();
  });

  test('trims whitespace', () => {
    expect(resolveAirport('  Boston  ')).toBe('BOS');
  });

  test('parses venue-style location segments', () => {
    expect(resolveAirport('UCI Student Center - Pacific Ballroom, Irvine, CA')).toBe('SNA');
    expect(resolveAirport('Frontier Tower - SF')).toBe('SFO');
    expect(resolveAirport('Boston, MA')).toBe('BOS');
  });
});

describe('airport metadata resolvers', () => {
  test('resolveAirportCity returns canonical city for known airport', () => {
    expect(resolveAirportCity('SFO')).toBe('San Francisco');
    expect(resolveAirportCity('sfo')).toBe('San Francisco');
    expect(resolveAirportCity('ONT')).toBe('Ontario');
    expect(resolveAirportCity('ZZZ')).toBeNull();
  });

  test('resolveAirportTimezone returns timezone for known airport', () => {
    expect(resolveAirportTimezone('SFO')).toBe('America/Los_Angeles');
    expect(resolveAirportTimezone('JFK')).toBe('America/New_York');
    expect(resolveAirportTimezone('ONT')).toBe('America/Los_Angeles');
    expect(resolveAirportTimezone('ZZZ')).toBeNull();
  });
});

// ─── estimateLodging ──────────────────────────────────────────────────────────

describe('estimateLodging', () => {
  test('missing DB nightly rate falls back to $180 (2 nights × $90)', () => {
    expect(estimateLodging('SFO')).toBe(180);
    expect(estimateLodging('CMH')).toBe(180);
    expect(estimateLodging('XYZ')).toBe(180);
  });

  test('explicit nightly rate override uses lodging table values', () => {
    expect(estimateLodging('SFO', 123.45)).toBe(246.9);
    expect(estimateLodging('SFO', 0)).toBe(0);
  });
});

// ─── checkBudgetFeasibility ───────────────────────────────────────────────────

describe('checkBudgetFeasibility', () => {

  // CASE 1: Feasible — flight + lodging under budget
  test('flight + lodging under budget → feasible', () => {
    // flight $380, fallback lodging $180, total $560
    const result = checkBudgetFeasibility(
      makeEvent('Chicago'),
      { budget: 600 },
      makeRoute({ outbound: 200, return: 180 })
    );
    expect(result.feasible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.destination_airport).toBe('ORD');
    expect(result.estimated_flight_cost).toBe(380);
    expect(result.estimated_lodging_cost).toBe(180);
    expect(result.estimated_total_cost).toBe(560);
  });

  // CASE 2: Infeasible — flight alone exceeds budget
  test('flight alone exceeds budget → infeasible', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Boston'),
      { budget: 300 },
      makeRoute({ outbound: 250, return: 220 }) // $470 flight alone
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('exceeds budget');
    expect(result.estimated_total_cost).toBe(650); // 470 + 180 fallback lodging
  });

  // CASE 3: Infeasible — flight is fine but lodging pushes over
  test('lodging pushes total over budget → infeasible', () => {
    // flight $350, fallback lodging $180, total $530
    const result = checkBudgetFeasibility(
      makeEvent('San Francisco'),
      { budget: 500 },
      makeRoute({ outbound: 180, return: 170 }) // $350 flight
    );
    expect(result.feasible).toBe(false);
    expect(result.estimated_flight_cost).toBe(350);
    expect(result.estimated_lodging_cost).toBe(180);
    expect(result.estimated_total_cost).toBe(530);
  });

  // CASE 4: Unknown city → no airport mapping
  test('unknown event city → infeasible with descriptive reason', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Smalltown'),
      { budget: 1000 },
      makeRoute()
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('No airport mapping');
    expect(result.destination_airport).toBeNull();
    expect(result.estimated_total_cost).toBeNull();
  });

  test('unknown city with routed destination airport still evaluates budget', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Hoboken'),
      { budget: 500 },
      makeRoute({ outbound: 120, return: 130, destinationAirport: 'ROC' })
    );
    expect(result.feasible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.destination_airport).toBe('ROC');
    expect(result.estimated_total_cost).toBe(430);
  });

  test('non-US country does not use US city-to-airport mapping', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Ontario', 'Canada'),
      { budget: 1000 },
      makeRoute()
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('No airport mapping');
    expect(result.destination_airport).toBeNull();
  });

  test('non-US country can still use route-provided destination airport', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Ontario', 'Canada'),
      { budget: 500 },
      makeRoute({ outbound: 120, return: 130, destinationAirport: 'YYZ' })
    );
    expect(result.feasible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.destination_airport).toBe('YYZ');
    expect(result.estimated_total_cost).toBe(430);
  });

  // CASE 5: No route data → infeasible with descriptive reason
  test('null route → infeasible with descriptive reason', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Austin'),
      { budget: 1000 },
      null
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('No route data');
    expect(result.destination_airport).toBe('AUS');
    expect(result.estimated_total_cost).toBeNull();
  });

  // CASE 6: Budget exactly at limit → feasible (inclusive boundary)
  test('total cost exactly equals budget → feasible (inclusive)', () => {
    // flight $300, fallback lodging $180, total $480
    const result = checkBudgetFeasibility(
      makeEvent('Austin'),
      { budget: 480 },
      makeRoute({ outbound: 160, return: 140 }) // $300 flight
    );
    expect(result.feasible).toBe(true);
    expect(result.estimated_total_cost).toBe(480);
  });

  // CASE 7: include_lodging: false — skips lodging heuristic
  test('include_lodging: false → only flight cost checked', () => {
    // SF (SFO): flight $350, no lodging → total $350
    const result = checkBudgetFeasibility(
      makeEvent('San Francisco'),
      { budget: 400, include_lodging: false },
      makeRoute({ outbound: 180, return: 170 })
    );
    expect(result.feasible).toBe(true);
    expect(result.estimated_lodging_cost).toBe(0);
    expect(result.estimated_total_cost).toBe(350);
  });

  // CASE 8: friend in destination city waives lodging even when include_lodging is true
  test('has_friend_in_city: true → lodging cost is zero', () => {
    const result = checkBudgetFeasibility(
      makeEvent('San Francisco'),
      {
        budget: 300,
        include_lodging: true,
        lodging_nightly_rate: 140,
        has_friend_in_city: true,
      },
      makeRoute({ outbound: 150, return: 120 }) // flight $270
    );
    expect(result.feasible).toBe(true);
    expect(result.estimated_flight_cost).toBe(270);
    expect(result.estimated_lodging_cost).toBe(0);
    expect(result.estimated_total_cost).toBe(270);
  });

  // CASE 9: lodging table nightly_rate overrides heuristic
  test('lodging_nightly_rate uses DB value when provided', () => {
    const result = checkBudgetFeasibility(
      makeEvent('San Francisco'),
      { budget: 500, include_lodging: true, lodging_nightly_rate: 40 }, // 2 nights => $80
      makeRoute({ outbound: 150, return: 120 }) // flight $270, total $350
    );
    expect(result.feasible).toBe(true);
    expect(result.estimated_lodging_cost).toBe(80);
    expect(result.estimated_total_cost).toBe(350);
  });

  // CASE 10: fallback lodging is uniform when DB rate is missing
  test('same flight price across cities uses same fallback lodging', () => {
    const route = makeRoute({ outbound: 150, return: 150 }); // $300 flight

    const sfResult = checkBudgetFeasibility(
      makeEvent('San Francisco'),
      { budget: 550 },
      route
    );
    const columbusResult = checkBudgetFeasibility(
      makeEvent('Columbus'),
      { budget: 550 },
      route
    );

    expect(sfResult.feasible).toBe(true);
    expect(columbusResult.feasible).toBe(true);
    expect(sfResult.estimated_lodging_cost).toBe(180);
    expect(columbusResult.estimated_lodging_cost).toBe(180);
    expect(sfResult.estimated_total_cost).toBe(columbusResult.estimated_total_cost);
  });

  // CASE 11: Null city field → handled gracefully
  test('null city field → infeasible, no crash', () => {
    const result = checkBudgetFeasibility(
      makeEvent(null),
      { budget: 1000 },
      makeRoute()
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('No airport mapping');
  });

  test('invalid route price fields return infeasible without throwing', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Austin'),
      { budget: 1000 },
      { avg_outbound_price: 'not-a-number', avg_return_price: 200 }
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('Invalid route pricing data');
  });

  test('travel_mode: drive → zero travel and lodging, route not required', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Irvine'),
      { budget: 25, include_lodging: true, travel_mode: 'drive' },
      null
    );
    expect(result.feasible).toBe(true);
    expect(result.destination_airport).toBe('SNA');
    expect(result.estimated_flight_cost).toBe(0);
    expect(result.estimated_lodging_cost).toBe(0);
    expect(result.estimated_total_cost).toBe(0);
  });

  test('travel_mode: drive accepts explicit destination_airport fallback', () => {
    const result = checkBudgetFeasibility(
      makeEvent('Unknown Place'),
      { budget: 25, include_lodging: true, travel_mode: 'drive', destination_airport: 'JFK' },
      null
    );
    expect(result.feasible).toBe(true);
    expect(result.destination_airport).toBe('JFK');
    expect(result.estimated_flight_cost).toBe(0);
    expect(result.estimated_lodging_cost).toBe(0);
    expect(result.estimated_total_cost).toBe(0);
  });
});
