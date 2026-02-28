'use strict';

const express = require('express');
const supabase = require('../db');
const { checkTimeFeasibility }                        = require('../feasibility/timeFeasibility');
const { checkBudgetFeasibility, resolveAirport }      = require('../feasibility/budgetFeasibility');

const router = express.Router();

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

  const budgetNum      = parseFloat(budget);
  const lodgingEnabled = include_lodging !== 'false';

  if (isNaN(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: 'budget must be a positive number' });
  }

  try {
    // 1. Fetch in-person events
    let eventQuery = supabase
      .from('events')
      .select('id, name, city, country, start_datetime_utc, end_datetime_utc, in_person, prize_pool, url, source')
      .eq('in_person', true)
      .order('start_datetime_utc', { ascending: true });

    if (date_range_start) eventQuery = eventQuery.gte('start_datetime_utc', date_range_start);
    if (date_range_end)   eventQuery = eventQuery.lte('start_datetime_utc', date_range_end);

    const { data: events, error: eventErr } = await eventQuery;
    if (eventErr) return res.status(500).json({ error: eventErr.message });

    // 2. Fetch all routes from this origin airport
    const { data: routes, error: routeErr } = await supabase
      .from('routes')
      .select('destination_airport, city, avg_outbound_price, avg_return_price, avg_outbound_duration_minutes, avg_return_duration_minutes')
      .eq('origin_airport', origin_airport);

    if (routeErr) return res.status(500).json({ error: routeErr.message });

    // Build route lookup: destination_airport → route
    const routeByDest = {};
    for (const route of routes) {
      routeByDest[route.destination_airport] = route;
    }

    // 3. Run budget + time feasibility on each event
    const feasibleEvents = [];
    for (const event of events) {
      // Resolve city → airport and look up route
      const destAirport = resolveAirport(event.city);
      const route       = destAirport ? (routeByDest[destAirport] ?? null) : null;

      // Budget check (pure — no DB needed)
      const budgetResult = checkBudgetFeasibility(
        event,
        { budget: budgetNum, include_lodging: lodgingEnabled },
        route
      );
      if (!budgetResult.feasible) continue;

      // Time check (pure — no DB needed)
      let timeResult;
      try {
        timeResult = checkTimeFeasibility(
          { ...event, event_timezone: null },
          {
            friday_last_class_end,
            monday_first_class_start,
            user_timezone,
            avg_outbound_duration_minutes: parseInt(route.avg_outbound_duration_minutes, 10),
            avg_return_duration_minutes:   parseInt(route.avg_return_duration_minutes, 10),
          }
        );
      } catch {
        continue;
      }
      if (!timeResult.feasible) continue;

      feasibleEvents.push({
        event,
        route: {
          origin_airport,
          destination_airport:             destAirport,
          city:                            route.city ?? null,
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
