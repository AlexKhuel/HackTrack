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

// City cost bands for lodging heuristic (2 nights: Fri + Sat)
const LODGING_NIGHTLY = {
  high:   150,  // SF, NYC, Boston, Seattle, DC
  medium: 100,  // Chicago, Austin, LA, Miami, Denver
  low:     70,  // everywhere else
};
const LODGING_NIGHTS = 2;

const HIGH_COST_AIRPORTS   = new Set(['SFO', 'SJC', 'OAK', 'JFK', 'EWR', 'BOS', 'SEA', 'DCA']);
const MEDIUM_COST_AIRPORTS = new Set(['ORD', 'AUS', 'LAX', 'MIA', 'DEN', 'ATL', 'PHL', 'MSP']);

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
 * Based on destination airport cost band.
 *
 * @param {string} destAirport  IATA code
 * @returns {number} Estimated lodging cost in USD
 */
function estimateLodging(destAirport) {
  if (HIGH_COST_AIRPORTS.has(destAirport))   return LODGING_NIGHTLY.high   * LODGING_NIGHTS;
  if (MEDIUM_COST_AIRPORTS.has(destAirport)) return LODGING_NIGHTLY.medium * LODGING_NIGHTS;
  return LODGING_NIGHTLY.low * LODGING_NIGHTS;
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
  const { budget, include_lodging = true } = userParams;

  const destAirport = resolveAirport(event.city);

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

  const flightCost  = route.avg_outbound_price + route.avg_return_price;
  const lodgingCost = include_lodging ? estimateLodging(destAirport) : 0;
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

module.exports = { checkBudgetFeasibility, resolveAirport, estimateLodging, CITY_TO_AIRPORT };
