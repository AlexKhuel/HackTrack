'use strict';

const express = require('express');
const { DateTime } = require('luxon');
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
const DATE_TIME_WITH_TZ_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_ORIGIN_AIRPORTS = 3;

function normalizeAirportCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeOriginAirports(query) {
  const originAirports = [];
  const seen = new Set();

  const addAirportToken = (token) => {
    const code = normalizeAirportCode(token);
    if (!code) throw new Error('origin_airport values must be 3-letter IATA codes');
    if (seen.has(code)) return;
    if (originAirports.length >= MAX_ORIGIN_AIRPORTS) {
      throw new Error(`origin_airport accepts at most ${MAX_ORIGIN_AIRPORTS} airports`);
    }
    seen.add(code);
    originAirports.push(code);
  };

  const addFromValue = (raw) => {
    if (raw == null) return;
    if (Array.isArray(raw)) {
      for (const entry of raw) addFromValue(entry);
      return;
    }

    const text = String(raw).trim();
    if (!text) return;

    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) addFromValue(entry);
          return;
        }
      } catch {
        // Fall back to delimiter splitting for non-JSON strings.
      }
    }

    const segments = text.split(/,|;|\||\n/).map((segment) => segment.trim()).filter(Boolean);
    if (segments.length > 1) {
      for (const segment of segments) addAirportToken(segment);
      return;
    }

    addAirportToken(text);
  };

  addFromValue(query.origin_airport);
  addFromValue(query['origin_airport[]']);
  addFromValue(query.origin_airports);
  addFromValue(query['origin_airports[]']);

  return originAirports;
}

function buildOriginAirportPriority(originAirports) {
  return new Map(originAirports.map((code, idx) => [code, idx]));
}

function normalizeNonNegativeNumber(value) {
  const asNum = Number(value);
  return Number.isFinite(asNum) && asNum >= 0 ? asNum : null;
}

function sortRoutesForDestination(routes, originPriority) {
  return [...routes].sort((a, b) => {
    const aRank = originPriority.get(a.origin_airport) ?? Number.MAX_SAFE_INTEGER;
    const bRank = originPriority.get(b.origin_airport) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;

    const aFlightCost = normalizeNonNegativeNumber(a.avg_outbound_price);
    const aReturnCost = normalizeNonNegativeNumber(a.avg_return_price);
    const bFlightCost = normalizeNonNegativeNumber(b.avg_outbound_price);
    const bReturnCost = normalizeNonNegativeNumber(b.avg_return_price);
    const aTotal = aFlightCost == null || aReturnCost == null ? Number.MAX_SAFE_INTEGER : aFlightCost + aReturnCost;
    const bTotal = bFlightCost == null || bReturnCost == null ? Number.MAX_SAFE_INTEGER : bFlightCost + bReturnCost;

    return aTotal - bTotal;
  });
}

function normalizeDateFilter(value, boundary) {
  if (value == null || value === '') return null;
  const fieldName = boundary === 'start' ? 'date_range_start' : 'date_range_end';
  const text = String(value).trim().replace(' ', 'T');

  if (DATE_ONLY_RE.test(text)) {
    throw new Error(
      `Invalid ${fieldName} value: use an ISO 8601 datetime with explicit timezone (e.g. 2026-03-01T00:00:00-08:00)`
    );
  }
  if (!DATE_TIME_WITH_TZ_RE.test(text)) {
    throw new Error(`Invalid ${fieldName} value`);
  }

  const parsed = DateTime.fromISO(text, { setZone: true });
  if (!parsed.isValid) throw new Error(`Invalid ${fieldName} value`);

  return parsed.toUTC().toISO();
}

function normalizeScheduleBoundary(value, fieldName) {
  const text = String(value ?? '').trim().replace(' ', 'T');
  if (!DATE_TIME_WITH_TZ_RE.test(text)) {
    throw new Error(
      `Invalid ${fieldName} value: use an ISO 8601 datetime with explicit timezone (e.g. 2026-03-06T18:00:00-08:00)`
    );
  }

  const parsed = DateTime.fromISO(text, { setZone: true });
  if (!parsed.isValid) throw new Error(`Invalid ${fieldName} value`);
  return parsed;
}

function ensureValidTimezone(timezone) {
  const probe = DateTime.now().setZone(String(timezone ?? ''));
  if (!probe.isValid) throw new Error('user_timezone must be a valid IANA timezone');
}

function normalizeEventUtcDateTime(value) {
  if (value == null || value === '') return null;
  const parsed = DateTime.fromISO(String(value), { zone: 'utc' });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toISO();
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

function buildFriendCityTokenSet(rawFriendCities) {
  const friendCityTokens = new Set();
  const addToken = (raw) => {
    const token = normalizeCityToken(raw);
    if (token) friendCityTokens.add(token);
  };

  const addTokensFromText = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return;

    addToken(text);

    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) addToken(entry);
          return;
        }
      } catch {
        // Fall back to delimiter parsing for non-JSON strings.
      }
    }

    for (const delimiter of ['|', ';', '\n']) {
      if (!text.includes(delimiter)) continue;
      for (const segment of text.split(delimiter)) addToken(segment);
    }

    if (text.includes(',')) {
      for (const segment of text.split(',')) addToken(segment);
    }
  };

  if (Array.isArray(rawFriendCities)) {
    for (const value of rawFriendCities) addTokensFromText(value);
  } else if (rawFriendCities != null) {
    addTokensFromText(rawFriendCities);
  }

  return friendCityTokens;
}

function hasFriendInDestinationCity(eventCity, routeDestinationCity, destAirport, friendCityTokens) {
  if (!(friendCityTokens instanceof Set) || friendCityTokens.size === 0) return false;

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

  if (typeof routeDestinationCity === 'string') {
    for (const segment of routeDestinationCity.split(/,|\/|\||@|(?:\s[-–—]\s)/)) {
      addCandidate(segment);
    }
  }

  addCandidate(resolveAirportCity(destAirport));

  return candidates.some((cityToken) => friendCityTokens.has(cityToken));
}

/**
 * GET /api/hackathons/feasible
 *
 * Required query params:
 *   origin_airport             - 1-3 IATA codes, supports repeated params or delimited string
 *   friday_last_class_end      - ISO 8601 datetime with explicit timezone
 *   monday_first_class_start   - ISO 8601 datetime with explicit timezone
 *   user_timezone              - IANA string, e.g. "America/New_York"
 *   budget                     - number (total all-in USD budget)
 *
 * Optional query params:
 *   include_lodging            - "true"|"false" (default: "true")
 *   friend_cities              - optional city list for free lodging if friend lives there
 *   date_range_start           - ISO 8601 datetime with explicit timezone
 *   date_range_end             - ISO 8601 datetime with explicit timezone
 */
router.get('/feasible', async (req, res) => {
  const {
    friday_last_class_end,
    monday_first_class_start,
    user_timezone,
    budget,
    include_lodging = 'true',
    friend_cities,
    date_range_start,
    date_range_end,
  } = req.query;

  if (!friday_last_class_end || !monday_first_class_start || !user_timezone || !budget) {
    return res.status(400).json({
      error: 'Missing required query params: origin_airport, friday_last_class_end, monday_first_class_start, user_timezone, budget',
    });
  }

  let normalizedOriginAirports = [];
  try {
    normalizedOriginAirports = normalizeOriginAirports(req.query);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (normalizedOriginAirports.length === 0) {
    return res.status(400).json({ error: 'origin_airport is required and must include at least one IATA code' });
  }

  const budgetNum      = parseFloat(budget);
  const lodgingEnabled = include_lodging !== 'false';
  const friendCitiesRaw = friend_cities ?? req.query['friend_cities[]'];
  const friendCityTokens = buildFriendCityTokenSet(friendCitiesRaw);
  const originAirportSet = new Set(normalizedOriginAirports);
  const originAirportPriority = buildOriginAirportPriority(normalizedOriginAirports);

  if (isNaN(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: 'budget must be a positive number' });
  }

  let fridayLastClassEndHHMM;
  let mondayFirstClassStartHHMM;
  try {
    ensureValidTimezone(user_timezone);
    const fridayLastClassBoundary = normalizeScheduleBoundary(friday_last_class_end, 'friday_last_class_end');
    const mondayFirstClassBoundary = normalizeScheduleBoundary(monday_first_class_start, 'monday_first_class_start');
    fridayLastClassEndHHMM = fridayLastClassBoundary.setZone(user_timezone).toFormat('HH:mm');
    mondayFirstClassStartHHMM = mondayFirstClassBoundary.setZone(user_timezone).toFormat('HH:mm');
  } catch (err) {
    return res.status(400).json({ error: err.message });
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

    // 2. Fetch all routes from provided origin airports
    const { data: routes, error: routeErr } = await supabase
      .from('routes')
      .select('origin_airport, destination_airport, origin_city, destination_city, avg_outbound_price, avg_return_price, avg_outbound_duration_minutes, avg_return_duration_minutes')
      .in('origin_airport', normalizedOriginAirports);

    if (routeErr) return res.status(500).json({ error: routeErr.message });

    // 3. Fetch lodging rates to avoid stale hardcoded assumptions.
    const { data: lodgingRows, error: lodgingErr } = await supabase
      .from('lodging')
      .select('city, nightly_rate');

    if (lodgingErr) return res.status(500).json({ error: lodgingErr.message });

    const nightlyRateByCity = buildLodgingLookup(lodgingRows ?? []);

    // Build route lookup: destination_airport → [route options]
    const routesByDest = {};
    for (const route of routes ?? []) {
      const originAirport = normalizeAirportCode(route.origin_airport);
      const destinationAirport = normalizeAirportCode(route.destination_airport);
      if (!originAirport || !destinationAirport || !originAirportSet.has(originAirport)) continue;

      if (!routesByDest[destinationAirport]) routesByDest[destinationAirport] = [];
      routesByDest[destinationAirport].push({ ...route, origin_airport: originAirport });
    }

    for (const [destinationAirport, destinationRoutes] of Object.entries(routesByDest)) {
      routesByDest[destinationAirport] = sortRoutesForDestination(destinationRoutes, originAirportPriority);
    }

    // 4. Run budget + time feasibility on each event
    const feasibleEvents = [];
    for (const event of events ?? []) {
      const normalizedEventStart = normalizeEventUtcDateTime(event.start_datetime_utc);
      const normalizedEventEnd = normalizeEventUtcDateTime(event.end_datetime_utc);
      if (!normalizedEventStart || !normalizedEventEnd) continue;

      const eventWithNormalizedDateTimes = {
        ...event,
        start_datetime_utc: normalizedEventStart,
        end_datetime_utc: normalizedEventEnd,
      };

      // Resolve city → airport and evaluate drive/flight travel options.
      const destAirport = resolveAirport(event.city);
      const isLocalDriveTrip = Boolean(destAirport && originAirportSet.has(destAirport));
      const routeOptions = destAirport ? (routesByDest[destAirport] ?? []) : [];
      const travelCandidates = isLocalDriveTrip
        ? [{ travel_mode: 'drive', origin_airport: destAirport, route: null }]
        : routeOptions.map((routeOption) => ({
          travel_mode: 'flight',
          origin_airport: routeOption.origin_airport,
          route: routeOption,
        }));

      let selectedOutcome = null;

      for (const candidate of travelCandidates) {
        const route = candidate.route;
        const travelMode = candidate.travel_mode;
        const lodgingNightlyRate = resolveLodgingNightlyRate(
          event.city,
          route ? route.destination_city : null,
          destAirport,
          nightlyRateByCity
        );
        const hasFriendInCity = hasFriendInDestinationCity(
          event.city,
          route ? route.destination_city : null,
          destAirport,
          friendCityTokens
        );

        const budgetResult = checkBudgetFeasibility(
          eventWithNormalizedDateTimes,
          {
            budget: budgetNum,
            include_lodging: lodgingEnabled,
            lodging_nightly_rate: lodgingNightlyRate,
            has_friend_in_city: hasFriendInCity,
            travel_mode: travelMode,
          },
          route
        );
        if (!budgetResult.feasible) continue;

        let timeResult;
        try {
          const outboundDuration = travelMode === 'drive' ? 0 : Number(route?.avg_outbound_duration_minutes);
          const returnDuration = travelMode === 'drive' ? 0 : Number(route?.avg_return_duration_minutes);
          if (!Number.isFinite(outboundDuration) || !Number.isFinite(returnDuration)) continue;

          const eventTimezone = resolveAirportTimezone(destAirport) || event.event_timezone || 'UTC';
          timeResult = checkTimeFeasibility(
            { ...eventWithNormalizedDateTimes, event_timezone: eventTimezone },
            {
              friday_last_class_end: fridayLastClassEndHHMM,
              monday_first_class_start: mondayFirstClassStartHHMM,
              user_timezone,
              avg_outbound_duration_minutes: outboundDuration,
              avg_return_duration_minutes:   returnDuration,
            }
          );
        } catch {
          continue;
        }
        if (!timeResult.feasible) continue;

        selectedOutcome = {
          travel_mode: travelMode,
          origin_airport: candidate.origin_airport,
          route,
          budgetResult,
          timeResult,
        };
        break;
      }

      if (!selectedOutcome) continue;

      const selectedTravelMode = selectedOutcome.travel_mode;
      const selectedRoute = selectedOutcome.route;
      const selectedOriginAirport = selectedOutcome.origin_airport ?? normalizedOriginAirports[0];
      const originCity = selectedRoute?.origin_city ?? resolveAirportCity(selectedOriginAirport) ?? null;
      const destinationCity = selectedRoute?.destination_city ?? resolveAirportCity(destAirport) ?? event.city ?? null;
      feasibleEvents.push({
        event: eventWithNormalizedDateTimes,
        route: {
          travel_mode:                      selectedTravelMode,
          origin_airport:                   selectedOriginAirport,
          origin_city:                      originCity,
          destination_airport:             destAirport,
          destination_city:                 destinationCity,
          avg_outbound_price:              selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_outbound_price ?? null),
          avg_return_price:                selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_return_price ?? null),
          avg_outbound_duration_minutes:   selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_outbound_duration_minutes ?? null),
          avg_return_duration_minutes:     selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_return_duration_minutes ?? null),
        },
        cost_estimate: {
          estimated_flight_cost:   selectedOutcome.budgetResult.estimated_flight_cost,
          estimated_lodging_cost:  selectedOutcome.budgetResult.estimated_lodging_cost,
          estimated_total_cost:    selectedOutcome.budgetResult.estimated_total_cost,
        },
        time_feasibility: {
          latest_departure_utc:        selectedOutcome.timeResult.latest_departure_utc,
          earliest_return_arrival_utc: selectedOutcome.timeResult.earliest_return_arrival_utc,
        },
      });
    }

    return res.json({ count: feasibleEvents.length, results: feasibleEvents });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
