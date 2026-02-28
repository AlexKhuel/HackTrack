'use strict';

function normalizeCityToken(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[().]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

// City name (lowercase) → primary IATA airport code
const CITY_TO_AIRPORT = {
  // Northeast
  'boston':              'BOS',
  'cambridge':           'BOS',
  'new york':            'JFK',
  'new york city':       'JFK',
  'nyc':                 'JFK',
  'brooklyn':            'JFK',
  'manhattan':           'JFK',
  'newark':              'EWR',
  'philadelphia':        'PHL',
  'washington':          'DCA',
  'washington dc':       'DCA',
  'washington d.c.':     'DCA',
  'dc':                  'DCA',
  'baltimore':           'BWI',
  'pittsburgh':          'PIT',
  // Southeast
  'atlanta':             'ATL',
  'miami':               'MIA',
  'orlando':             'MCO',
  'charlotte':           'CLT',
  'nashville':           'BNA',
  'raleigh':             'RDU',
  // Midwest
  'chicago':             'ORD',
  'detroit':             'DTW',
  'columbus':            'CMH',
  'minneapolis':         'MSP',
  'st. louis':           'STL',
  'saint louis':         'STL',
  'kansas city':         'MCI',
  'cleveland':           'CLE',
  'fort worth':          'DFW',
  // South / Southwest
  'austin':              'AUS',
  'dallas':              'DFW',
  'houston':             'IAH',
  'phoenix':             'PHX',
  'denver':              'DEN',
  'san antonio':         'SAT',
  // West Coast
  'los angeles':         'LAX',
  'la':                  'LAX',
  'san francisco':       'SFO',
  'sf':                  'SFO',
  'san jose':            'SJC',
  'oakland':             'OAK',
  'seattle':             'SEA',
  'portland':            'PDX',
  'san diego':           'SAN',
  'las vegas':           'LAS',
  'salt lake city':      'SLC',
  // Common college towns
  'ann arbor':           'DTW',
  'ithaca':              'ITH',
  'champaign':           'CMI',
  'urbana':              'CMI',
  'gainesville':         'GNV',
  'irvine':              'SNA',
  'berkeley':            'SFO',
  'palo alto':           'SFO',
  'stanford':            'SFO',
  'cambridge ma':        'BOS',
  'worcester':           'BOS',
};

const NORMALIZED_CITY_TO_AIRPORT = Object.freeze(
  Object.entries(CITY_TO_AIRPORT).reduce((acc, [city, airport]) => {
    const normalized = normalizeCityToken(city);
    if (normalized) {
      acc[normalized] = airport;
    }
    return acc;
  }, {})
);

// Fallback lodging heuristic used only when no city rate is available in lodging table.
const DEFAULT_LODGING_NIGHTLY = 90;
const LODGING_NIGHTS = 2;

const AIRPORT_TO_CITY = Object.freeze({
  ATL: 'Atlanta',
  AUS: 'Austin',
  BNA: 'Nashville',
  BOS: 'Boston',
  BWI: 'Baltimore',
  CLE: 'Cleveland',
  CLT: 'Charlotte',
  CMH: 'Columbus',
  CMI: 'Champaign',
  DCA: 'Washington',
  DEN: 'Denver',
  DFW: 'Dallas',
  DTW: 'Detroit',
  EWR: 'Newark',
  GNV: 'Gainesville',
  IAH: 'Houston',
  ITH: 'Ithaca',
  JFK: 'New York',
  LAS: 'Las Vegas',
  LAX: 'Los Angeles',
  MCI: 'Kansas City',
  MCO: 'Orlando',
  MIA: 'Miami',
  MSP: 'Minneapolis',
  OAK: 'Oakland',
  ORD: 'Chicago',
  PDX: 'Portland',
  PHL: 'Philadelphia',
  PHX: 'Phoenix',
  PIT: 'Pittsburgh',
  RDU: 'Raleigh',
  SAN: 'San Diego',
  SAT: 'San Antonio',
  SEA: 'Seattle',
  SFO: 'San Francisco',
  SJC: 'San Jose',
  SLC: 'Salt Lake City',
  SNA: 'Irvine',
  STL: 'St. Louis',
});

const AIRPORT_TO_TIMEZONE = Object.freeze({
  ATL: 'America/New_York',
  AUS: 'America/Chicago',
  BNA: 'America/Chicago',
  BOS: 'America/New_York',
  BWI: 'America/New_York',
  CLE: 'America/New_York',
  CLT: 'America/New_York',
  CMH: 'America/New_York',
  CMI: 'America/Chicago',
  DCA: 'America/New_York',
  DEN: 'America/Denver',
  DFW: 'America/Chicago',
  DTW: 'America/New_York',
  EWR: 'America/New_York',
  GNV: 'America/New_York',
  IAH: 'America/Chicago',
  ITH: 'America/New_York',
  JFK: 'America/New_York',
  LAS: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles',
  MCI: 'America/Chicago',
  MCO: 'America/New_York',
  MIA: 'America/New_York',
  MSP: 'America/Chicago',
  OAK: 'America/Los_Angeles',
  ORD: 'America/Chicago',
  PDX: 'America/Los_Angeles',
  PHL: 'America/New_York',
  PHX: 'America/Phoenix',
  PIT: 'America/New_York',
  RDU: 'America/New_York',
  SAN: 'America/Los_Angeles',
  SAT: 'America/Chicago',
  SEA: 'America/Los_Angeles',
  SFO: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles',
  SLC: 'America/Denver',
  SNA: 'America/Los_Angeles',
  STL: 'America/Chicago',
});

/**
 * Resolve an event city string to an IATA airport code.
 *
 * @param {string} city  Raw city name from DB
 * @returns {string|null} IATA code or null if not found
 */
function resolveAirport(city) {
  if (!city) return null;

  const normalized = normalizeCityToken(city);
  if (!normalized) return null;

  const directMatch = NORMALIZED_CITY_TO_AIRPORT[normalized];
  if (directMatch) return directMatch;

  const compoundSegments = String(city)
    .split(/,|\/|\||@|(?:\s[-–—]\s)/)
    .map((segment) => normalizeCityToken(segment))
    .filter(Boolean);

  for (const segment of compoundSegments) {
    const airport = NORMALIZED_CITY_TO_AIRPORT[segment];
    if (airport) return airport;
  }

  return null;
}

/**
 * Estimate lodging cost for a weekend trip (2 nights).
 * Uses DB-provided nightly rate when present; otherwise applies a flat fallback.
 *
 * @param {string} _destAirport  IATA code (unused)
 * @returns {number} Estimated lodging cost in USD
 */
function estimateLodging(_destAirport, nightlyRate) {
  if (Number.isFinite(nightlyRate) && nightlyRate >= 0) {
    return Math.round(nightlyRate * LODGING_NIGHTS * 100) / 100;
  }
  return DEFAULT_LODGING_NIGHTLY * LODGING_NIGHTS;
}

function resolveAirportCity(airportCode) {
  if (!airportCode) return null;
  return AIRPORT_TO_CITY[String(airportCode).toUpperCase()] ?? null;
}

function resolveAirportTimezone(airportCode) {
  if (!airportCode) return null;
  return AIRPORT_TO_TIMEZONE[String(airportCode).toUpperCase()] ?? null;
}

/**
 * Check whether a user can afford to attend an event given their budget.
 *
 * @param {Object} event
 * @param {string} event.city   Raw city name from DB
 *
 * @param {Object} userParams
 * @param {number} userParams.budget            Total all-in budget in USD
 * @param {boolean} [userParams.include_lodging=true]  Whether to add lodging estimate
 * @param {boolean} [userParams.has_friend_in_city=false]  Whether lodging is free via friend stay
 * @param {"flight"|"drive"} [userParams.travel_mode='flight']  Drive mode bypasses route pricing and lodging
 *
 * @param {Object|null} route   Row from routes table (or null if unavailable)
 * @param {number} route.avg_outbound_price
 * @param {number} route.avg_return_price
 *
 * @returns {{
 *   feasible: boolean,
 *   reason: string | null,
 *   destination_airport: string | null,
 *   estimated_flight_cost: number | null,
 *   estimated_lodging_cost: number | null,
 *   estimated_total_cost: number | null,
 * }}
 */
function checkBudgetFeasibility(event, userParams, route) {
  const {
    budget,
    include_lodging = true,
    lodging_nightly_rate = null,
    has_friend_in_city = false,
    travel_mode = 'flight',
  } = userParams;

  const destAirport = resolveAirport(event.city);
  const travelMode = String(travel_mode).toLowerCase() === 'drive' ? 'drive' : 'flight';

  if (!destAirport) {
    return {
      feasible:               false,
      reason:                 `No airport mapping found for city: "${event.city}"`,
      destination_airport:    null,
      estimated_flight_cost:  null,
      estimated_lodging_cost: null,
      estimated_total_cost:   null,
    };
  }

  if (travelMode === 'drive') {
    const totalCost = 0;
    const feasible = totalCost <= budget;
    return {
      feasible,
      reason:                 feasible ? null : `Estimated cost $${totalCost} exceeds budget $${budget}`,
      destination_airport:    destAirport,
      estimated_flight_cost:  0,
      estimated_lodging_cost: 0,
      estimated_total_cost:   totalCost,
    };
  }

  if (!route) {
    return {
      feasible:               false,
      reason:                 `No route data available to ${destAirport}`,
      destination_airport:    destAirport,
      estimated_flight_cost:  null,
      estimated_lodging_cost: null,
      estimated_total_cost:   null,
    };
  }

  const outboundPrice = Number(route.avg_outbound_price);
  const returnPrice = Number(route.avg_return_price);
  if (!Number.isFinite(outboundPrice) || !Number.isFinite(returnPrice) || outboundPrice < 0 || returnPrice < 0) {
    return {
      feasible:               false,
      reason:                 `Invalid route pricing data for ${destAirport}`,
      destination_airport:    destAirport,
      estimated_flight_cost:  null,
      estimated_lodging_cost: null,
      estimated_total_cost:   null,
    };
  }

  const flightCost  = Math.round((outboundPrice + returnPrice) * 100) / 100;
  const nightlyRate = lodging_nightly_rate == null ? null : Number(lodging_nightly_rate);
  const shouldChargeLodging = include_lodging && !has_friend_in_city;
  const lodgingCost = shouldChargeLodging ? estimateLodging(destAirport, nightlyRate) : 0;
  const totalCost   = flightCost + lodgingCost;

  const feasible = totalCost <= budget;

  return {
    feasible,
    reason:                 feasible ? null : `Estimated cost $${totalCost} exceeds budget $${budget}`,
    destination_airport:    destAirport,
    estimated_flight_cost:  flightCost,
    estimated_lodging_cost: lodgingCost,
    estimated_total_cost:   totalCost,
  };
}

module.exports = {
  checkBudgetFeasibility,
  resolveAirport,
  resolveAirportCity,
  resolveAirportTimezone,
  estimateLodging,
  normalizeCityToken,
  CITY_TO_AIRPORT,
  AIRPORT_TO_CITY,
};
