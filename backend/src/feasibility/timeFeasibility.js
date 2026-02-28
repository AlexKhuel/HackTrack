'use strict';

const { DateTime } = require('luxon');

/**
 * Parse an "HH:MM" string into { hour, minute }.
 * @param {string} hhmm  e.g. "09:30"
 * @returns {{ hour: number, minute: number }}
 */
function parseHHMM(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Invalid HH:MM value: "${hhmm}"`);
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Out-of-range time: "${hhmm}"`);
  }
  return { hour, minute };
}

/**
 * Given any Luxon DateTime, return the Friday of its ISO calendar week.
 * ISO weekday: Mon=1 … Sun=7, so Fri=5.
 * Saturday → Friday of same week (one day back)
 * Sunday   → Friday of same week (two days back)
 *
 * @param {DateTime} dt
 * @returns {DateTime} Friday of that ISO week, midnight, same timezone
 */
function fridayOfWeek(dt) {
  return dt.set({ weekday: 5 }).startOf('day');
}

/**
 * Return the Monday immediately after the given date.
 * Always at least +1 day forward — never returns the same day.
 *
 * @param {DateTime} dt
 * @returns {DateTime} Next Monday, midnight, same timezone
 */
function nextMonday(dt) {
  let candidate = dt.startOf('day').plus({ days: 1 });
  while (candidate.weekday !== 1) {
    candidate = candidate.plus({ days: 1 });
  }
  return candidate;
}

/**
 * Construct a UTC DateTime from a calendar date + HH:MM wall-clock time in a given timezone.
 *
 * @param {DateTime} dateDT       Luxon DateTime providing year/month/day
 * @param {string}   hhmm         "HH:MM" in the target timezone
 * @param {string}   ianaTimezone e.g. "America/New_York"
 * @returns {DateTime} UTC DateTime
 */
function buildLocalDateTime(dateDT, hhmm, ianaTimezone) {
  const { hour, minute } = parseHHMM(hhmm);
  return DateTime.fromObject(
    { year: dateDT.year, month: dateDT.month, day: dateDT.day, hour, minute, second: 0 },
    { zone: ianaTimezone }
  ).toUTC();
}

/**
 * Determine whether a student can feasibly attend a hackathon given their class schedule
 * and the estimated flight duration to the event city.
 *
 * All datetime comparisons are performed in UTC to avoid DST ambiguity.
 *
 * @param {Object} event
 * @param {string} event.start_datetime_utc   ISO 8601 UTC string
 * @param {string} event.end_datetime_utc     ISO 8601 UTC string
 * @param {string} event.event_timezone       IANA timezone, e.g. "America/Los_Angeles" (nullable → defaults to 'UTC')
 *
 * @param {Object} userParams
 * @param {string} userParams.friday_last_class_end      "HH:MM" in user_timezone
 * @param {string} userParams.monday_first_class_start   "HH:MM" in user_timezone
 * @param {string} userParams.user_timezone              IANA timezone, e.g. "America/New_York"
 * @param {number} userParams.avg_outbound_duration_minutes
 * @param {number} userParams.avg_return_duration_minutes
 *
 * @returns {{
 *   feasible: boolean,
 *   outbound_feasible: boolean,
 *   return_feasible: boolean,
 *   reason: string | null,
 *   latest_departure_utc: string,
 *   earliest_return_arrival_utc: string
 * }}
 */
function checkTimeFeasibility(event, userParams) {
  const {
    start_datetime_utc,
    end_datetime_utc,
    event_timezone: rawEventTz,
  } = event;

  const {
    friday_last_class_end,
    monday_first_class_start,
    user_timezone,
    avg_outbound_duration_minutes,
    avg_return_duration_minutes,
  } = userParams;

  const event_timezone = rawEventTz || 'UTC';

  const eventStartUTC = DateTime.fromISO(start_datetime_utc, { zone: 'utc' });
  const eventEndUTC   = DateTime.fromISO(end_datetime_utc,   { zone: 'utc' });

  if (!eventStartUTC.isValid) {
    throw new Error(`Invalid start_datetime_utc: "${start_datetime_utc}"`);
  }
  if (!eventEndUTC.isValid) {
    throw new Error(`Invalid end_datetime_utc: "${end_datetime_utc}"`);
  }

  // --- Compute the two travel boundary timestamps ---

  // Latest time the user can depart their origin airport and still arrive before the event starts
  const latestDepartureUTC = eventStartUTC.minus({ minutes: avg_outbound_duration_minutes });

  // Earliest time the user arrives back at their origin airport after the event ends
  const earliestReturnArrivalUTC = eventEndUTC.plus({ minutes: avg_return_duration_minutes });

  // --- Find the relevant Friday (in the event's local timezone) ---
  const eventStartLocal = eventStartUTC.setZone(event_timezone);
  const relevantFriday  = fridayOfWeek(eventStartLocal);

  // Build the Friday class deadline in UTC (using user's timezone for the HH:MM)
  const fridayDeadlineUTC = buildLocalDateTime(relevantFriday, friday_last_class_end, user_timezone);

  // --- Find the relevant Monday (in the event's local timezone) ---
  const eventEndLocal   = eventEndUTC.setZone(event_timezone);
  const relevantMonday  = nextMonday(eventEndLocal);

  // Build the Monday class deadline in UTC
  const mondayDeadlineUTC = buildLocalDateTime(relevantMonday, monday_first_class_start, user_timezone);

  // --- Feasibility checks (UTC millisecond comparison) ---
  // Outbound: the latest possible departure must be at or after the user's last Friday class
  const outboundFeasible = latestDepartureUTC.valueOf() >= fridayDeadlineUTC.valueOf();

  // Return: the earliest possible arrival home must be at or before Monday's first class
  const returnFeasible = earliestReturnArrivalUTC.valueOf() <= mondayDeadlineUTC.valueOf();

  const feasible = outboundFeasible && returnFeasible;

  // --- Build human-readable reason for infeasibility ---
  let reason = null;
  if (!feasible) {
    const parts = [];
    if (!outboundFeasible) {
      parts.push(
        `Outbound: must depart by ${latestDepartureUTC.toISO()} UTC but ` +
        `last class ends at ${fridayDeadlineUTC.toISO()} UTC.`
      );
    }
    if (!returnFeasible) {
      parts.push(
        `Return: earliest arrival ${earliestReturnArrivalUTC.toISO()} UTC is after ` +
        `Monday first class at ${mondayDeadlineUTC.toISO()} UTC.`
      );
    }
    reason = parts.join(' | ');
  }

  return {
    feasible,
    outbound_feasible: outboundFeasible,
    return_feasible:   returnFeasible,
    reason,
    latest_departure_utc:          latestDepartureUTC.toISO(),
    earliest_return_arrival_utc:   earliestReturnArrivalUTC.toISO(),
  };
}

module.exports = {
  checkTimeFeasibility,
  fridayOfWeek,
  nextMonday,
  buildLocalDateTime,
  parseHHMM,
};
