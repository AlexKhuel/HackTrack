'use strict';

const { checkBudgetFeasibility, resolveAirport, estimateLodging } = require('../budgetFeasibility');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvent(city) {
  return { city };
}

function makeRoute({ outbound = 200, return: ret = 180 } = {}) {
  return { avg_outbound_price: outbound, avg_return_price: ret };
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

// ─── estimateLodging ──────────────────────────────────────────────────────────

describe('estimateLodging', () => {
  test('high-cost airports return $300 (2 nights × $150)', () => {
    expect(estimateLodging('SFO')).toBe(300);
    expect(estimateLodging('JFK')).toBe(300);
    expect(estimateLodging('BOS')).toBe(300);
    expect(estimateLodging('SEA')).toBe(300);
  });

  test('medium-cost airports return $200 (2 nights × $100)', () => {
    expect(estimateLodging('ORD')).toBe(200);
    expect(estimateLodging('AUS')).toBe(200);
    expect(estimateLodging('LAX')).toBe(200);
  });

  test('low-cost airports return $140 (2 nights × $70)', () => {
    expect(estimateLodging('CMH')).toBe(140);
    expect(estimateLodging('XYZ')).toBe(140); // unknown defaults to low
  });
});

// ─── checkBudgetFeasibility ───────────────────────────────────────────────────

describe('checkBudgetFeasibility', () => {

  // CASE 1: Feasible — flight + lodging under budget
  test('flight + lodging under budget → feasible', () => {
    // Chicago (ORD, medium): flight $380, lodging $200, total $580
    const result = checkBudgetFeasibility(
      makeEvent('Chicago'),
      { budget: 600 },
      makeRoute({ outbound: 200, return: 180 })
    );
    expect(result.feasible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.destination_airport).toBe('ORD');
    expect(result.estimated_flight_cost).toBe(380);
    expect(result.estimated_lodging_cost).toBe(200);
    expect(result.estimated_total_cost).toBe(580);
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
    expect(result.estimated_total_cost).toBe(770); // 470 + 300 lodging (BOS = high)
  });

  // CASE 3: Infeasible — flight is fine but lodging pushes over
  test('lodging pushes total over budget → infeasible', () => {
    // SF (SFO, high): flight $350, lodging $300, total $650
    const result = checkBudgetFeasibility(
      makeEvent('San Francisco'),
      { budget: 600 },
      makeRoute({ outbound: 180, return: 170 }) // $350 flight
    );
    expect(result.feasible).toBe(false);
    expect(result.estimated_flight_cost).toBe(350);
    expect(result.estimated_lodging_cost).toBe(300);
    expect(result.estimated_total_cost).toBe(650);
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
    // Austin (AUS, medium): flight $300, lodging $200, total $500
    const result = checkBudgetFeasibility(
      makeEvent('Austin'),
      { budget: 500 },
      makeRoute({ outbound: 160, return: 140 }) // $300 flight
    );
    expect(result.feasible).toBe(true);
    expect(result.estimated_total_cost).toBe(500);
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

  // CASE 8: High-cost vs low-cost city with same flight — lodging makes the difference
  test('same flight price: high-cost city fails budget that low-cost city passes', () => {
    const route = makeRoute({ outbound: 150, return: 150 }); // $300 flight

    const sfResult = checkBudgetFeasibility(
      makeEvent('San Francisco'), // SFO: +$300 lodging → $600 total
      { budget: 550 },
      route
    );
    const columbusResult = checkBudgetFeasibility(
      makeEvent('Columbus'), // CMH: +$140 lodging → $440 total
      { budget: 550 },
      route
    );

    expect(sfResult.feasible).toBe(false);
    expect(columbusResult.feasible).toBe(true);
  });

  // CASE 9: Null city field → handled gracefully
  test('null city field → infeasible, no crash', () => {
    const result = checkBudgetFeasibility(
      makeEvent(null),
      { budget: 1000 },
      makeRoute()
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('No airport mapping');
  });
});
