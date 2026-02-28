'use strict';

const express = require('express');
const supabase = require('../db');
const { checkTimeFeasibility }                        = require('../feasibility/timeFeasibility');
const {
  checkBudgetFeasibility,
  normalizeCityToken,
  resolveAirport,
  resolveAirportCity,
  resolveAirportTimezone,
} = require('../feasibility/budgetFeasibility');

const router = express.Router();
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

function normalizeAirportCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeDateFilter(value, boundary) {
  if (value == null || value === '') return null;
  const text = String(value).trim();

  if (DATE_ONLY_RE.test(text)) {
    return boundary === 'start' ? `${text}T00:00:00` : `${text}T23:59:59.999`;
  }
  if (DATE_TIME_RE.test(text)) {
    return text.replace(' ', 'T');
  }

  throw new Error(`Invalid ${boundary === 'start' ? 'date_range_start' : 'date_range_end'} value`);
}

function buildLodgingLookup(lodgingRows) {
  const statsByCity = {};

  for (const row of lodgingRows) {
    const cityToken = normalizeCityToken(row.city);
    const nightlyRate = Number(row.nightly_rate);
    if (!cityToken || !Number.isFinite(nightlyRate) || nightlyRate < 0) continue;

    if (!statsByCity[cityToken]) {
      statsByCity[cityToken] = { sum: 0, count: 0 };
    }
    statsByCity[cityToken].sum += nightlyRate;
    statsByCity[cityToken].count += 1;
  }

  const nightlyRateByCity = {};
  for (const [cityToken, stats] of Object.entries(statsByCity)) {
    nightlyRateByCity[cityToken] = Math.round((stats.sum / stats.count) * 100) / 100;
  }

  return nightlyRateByCity;
}

function resolveLodgingNightlyRate(eventCity, routeDestinationCity, destAirport, nightlyRateByCity) {
  const candidates = [];
  const addCandidate = (raw) => {
    const token = normalizeCityToken(raw);
    if (!token || candidates.includes(token)) return;
    candidates.push(token);
  };

  addCandidate(eventCity);
  addCandidate(routeDestinationCity);
  if (typeof eventCity === 'string') {
    for (const segment of eventCity.split(/,|\/|\||@|(?:\s[-–—]\s)/)) {
      addCandidate(segment);
    }
  }
  addCandidate(resolveAirportCity(destAirport));

  for (const cityToken of candidates) {
    const nightlyRate = nightlyRateByCity[cityToken];
    if (Number.isFinite(nightlyRate)) return nightlyRate;
  }

  return null;
}

/**
 * GET /api/hackathons/feasible
 *
 * Required query params:
 *   origin_airport             - IATA code, e.g. "LAX"
 *   friday_last_class_end      - "HH:MM" in user's local timezone
 *   monday_first_class_start   - "HH:MM" in user's local timezone
 *   user_timezone              - IANA string, e.g. "America/New_York"
 *   budget                     - number (total all-in USD budget)
 *
 * Optional query params:
 *   include_lodging            - "true"|"false" (default: "true")
 *   date_range_start           - ISO date "YYYY-MM-DD"
 *   date_range_end             - ISO date "YYYY-MM-DD"
 */
router.get('/feasible', async (req, res) => {
  const {
    origin_airport,
    friday_last_class_end,
    monday_first_class_start,
    user_timezone,
    budget,
    include_lodging = 'true',
    date_range_start,
    date_range_end,
  } = req.query;

  if (!origin_airport || !friday_last_class_end || !monday_first_class_start || !user_timezone || !budget) {
    return res.status(400).json({
      error: 'Missing required query params: origin_airport, friday_last_class_end, monday_first_class_start, user_timezone, budget',
    });
  }

  const normalizedOriginAirport = normalizeAirportCode(origin_airport);
  if (!normalizedOriginAirport) {
    return res.status(400).json({ error: 'origin_airport must be a 3-letter IATA code' });
  }

  const budgetNum      = parseFloat(budget);
  const lodgingEnabled = include_lodging !== 'false';

  if (isNaN(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: 'budget must be a positive number' });
  }

  let normalizedDateRangeStart;
  let normalizedDateRangeEnd;
  try {
    normalizedDateRangeStart = normalizeDateFilter(date_range_start, 'start');
    normalizedDateRangeEnd = normalizeDateFilter(date_range_end, 'end');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (normalizedDateRangeStart && normalizedDateRangeEnd) {
    const startEpoch = Date.parse(normalizedDateRangeStart);
    const endEpoch = Date.parse(normalizedDateRangeEnd);
    if (Number.isFinite(startEpoch) && Number.isFinite(endEpoch) && startEpoch > endEpoch) {
      return res.status(400).json({ error: 'date_range_start must be before or equal to date_range_end' });
    }
  }

  try {
    // 1. Fetch in-person events
    let eventQuery = supabase
      .from('events')
      .select('id, name, city, country, start_datetime_utc, end_datetime_utc, in_person, prize_pool, url, source')
      .eq('in_person', true)
      .order('start_datetime_utc', { ascending: true });

    if (normalizedDateRangeStart) eventQuery = eventQuery.gte('start_datetime_utc', normalizedDateRangeStart);
    if (normalizedDateRangeEnd)   eventQuery = eventQuery.lte('start_datetime_utc', normalizedDateRangeEnd);

    const { data: events, error: eventErr } = await eventQuery;
    if (eventErr) return res.status(500).json({ error: eventErr.message });

    // 2. Fetch all routes from this origin airport
    const { data: routes, error: routeErr } = await supabase
      .from('routes')
      .select('destination_airport, origin_city, destination_city, avg_outbound_price, avg_return_price, avg_outbound_duration_minutes, avg_return_duration_minutes')
      .eq('origin_airport', normalizedOriginAirport);

    if (routeErr) return res.status(500).json({ error: routeErr.message });

    // 3. Fetch lodging rates to avoid stale hardcoded assumptions.
    const { data: lodgingRows, error: lodgingErr } = await supabase
      .from('lodging')
      .select('city, nightly_rate');

    if (lodgingErr) return res.status(500).json({ error: lodgingErr.message });

    const nightlyRateByCity = buildLodgingLookup(lodgingRows ?? []);

    // Build route lookup: destination_airport → route
    const routeByDest = {};
    for (const route of routes ?? []) {
      const destinationAirport = normalizeAirportCode(route.destination_airport);
      if (!destinationAirport) continue;
      routeByDest[destinationAirport] = route;
    }

    // 4. Run budget + time feasibility on each event
    const feasibleEvents = [];
    for (const event of events ?? []) {
      // Resolve city → airport and look up route
      const destAirport = resolveAirport(event.city);
      const route       = destAirport ? (routeByDest[destAirport] ?? null) : null;
      const lodgingNightlyRate = resolveLodgingNightlyRate(
        event.city,
        route ? route.destination_city : null,
        destAirport,
        nightlyRateByCity
      );

      // Budget check (uses DB lodging if available; falls back to heuristic).
      const budgetResult = checkBudgetFeasibility(
        event,
        {
          budget: budgetNum,
          include_lodging: lodgingEnabled,
          lodging_nightly_rate: lodgingNightlyRate,
        },
        route
      );
      if (!budgetResult.feasible) continue;

      // Time check (pure — no DB needed)
      let timeResult;
      try {
        const outboundDuration = Number(route.avg_outbound_duration_minutes);
        const returnDuration = Number(route.avg_return_duration_minutes);
        if (!Number.isFinite(outboundDuration) || !Number.isFinite(returnDuration)) continue;

        const eventTimezone = resolveAirportTimezone(destAirport) || event.event_timezone || 'UTC';
        timeResult = checkTimeFeasibility(
          { ...event, event_timezone: eventTimezone },
          {
            friday_last_class_end,
            monday_first_class_start,
            user_timezone,
            avg_outbound_duration_minutes: outboundDuration,
            avg_return_duration_minutes:   returnDuration,
          }
        );
      } catch {
        continue;
      }
      if (!timeResult.feasible) continue;

      const originCity = route.origin_city ?? resolveAirportCity(normalizedOriginAirport) ?? null;
      const destinationCity = route.destination_city ?? resolveAirportCity(destAirport) ?? event.city ?? null;
      feasibleEvents.push({
        event,
        route: {
          origin_airport:                   normalizedOriginAirport,
          origin_city:                      originCity,
          destination_airport:             destAirport,
          destination_city:                 destinationCity,
          avg_outbound_price:              route.avg_outbound_price,
          avg_return_price:                route.avg_return_price,
          avg_outbound_duration_minutes:   route.avg_outbound_duration_minutes,
          avg_return_duration_minutes:     route.avg_return_duration_minutes,
        },
        cost_estimate: {
          estimated_flight_cost:   budgetResult.estimated_flight_cost,
          estimated_lodging_cost:  budgetResult.estimated_lodging_cost,
          estimated_total_cost:    budgetResult.estimated_total_cost,
        },
        time_feasibility: {
          latest_departure_utc:        timeResult.latest_departure_utc,
          earliest_return_arrival_utc: timeResult.earliest_return_arrival_utc,
        },
      });
    }

    return res.json({ count: feasibleEvents.length, results: feasibleEvents });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
