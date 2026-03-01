'use strict';

const { checkTimeFeasibility, fridayOfWeek, nextMonday, parseHHMM } = require('../timeFeasibility');
const { DateTime } = require('luxon');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvent({ startUTC, endUTC, timezone = 'America/Los_Angeles' }) {
  return { start_datetime_utc: startUTC, end_datetime_utc: endUTC, event_timezone: timezone };
}

function makeUser({
  fridayEnd       = '18:00',
  mondayStart     = '09:00',
  timezone        = 'America/New_York',
  outboundMinutes = 360,
  returnMinutes   = 360,
} = {}) {
  return {
    friday_last_class_end:         fridayEnd,
    monday_first_class_start:      mondayStart,
    user_timezone:                 timezone,
    avg_outbound_duration_minutes: outboundMinutes,
    avg_return_duration_minutes:   returnMinutes,
  };
}

// ─── Helper unit tests ─────────────────────────────────────────────────────────

describe('parseHHMM', () => {
  test('parses valid time strings', () => {
    expect(parseHHMM('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseHHMM('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseHHMM('0:00')).toEqual({ hour: 0, minute: 0 });
  });

  test('throws on invalid format', () => {
    expect(() => parseHHMM('9am')).toThrow();
    expect(() => parseHHMM('25:00')).toThrow();
    expect(() => parseHHMM('')).toThrow();
  });
});

describe('fridayOfWeek', () => {
  test('Saturday returns previous Friday (same ISO week)', () => {
    // 2026-03-07 is a Saturday
    const sat = DateTime.fromISO('2026-03-07T12:00:00', { zone: 'UTC' });
    const fri = fridayOfWeek(sat);
    expect(fri.weekday).toBe(5);
    expect(fri.toISODate()).toBe('2026-03-06');
  });

  test('Sunday returns two days prior (Friday)', () => {
    const sun = DateTime.fromISO('2026-03-08T10:00:00', { zone: 'UTC' });
    const fri = fridayOfWeek(sun);
    expect(fri.weekday).toBe(5);
    expect(fri.toISODate()).toBe('2026-03-06');
  });

  test('Friday returns the same day', () => {
    const fri = DateTime.fromISO('2026-03-06T08:00:00', { zone: 'UTC' });
    expect(fridayOfWeek(fri).toISODate()).toBe('2026-03-06');
  });
});

describe('nextMonday', () => {
  test('Sunday returns the very next day (Monday)', () => {
    const sun = DateTime.fromISO('2026-03-08T23:00:00', { zone: 'UTC' });
    const mon = nextMonday(sun);
    expect(mon.weekday).toBe(1);
    expect(mon.toISODate()).toBe('2026-03-09');
  });

  test('Saturday returns two days later (Monday)', () => {
    const sat = DateTime.fromISO('2026-03-07T10:00:00', { zone: 'UTC' });
    const mon = nextMonday(sat);
    expect(mon.weekday).toBe(1);
    expect(mon.toISODate()).toBe('2026-03-09');
  });

  test('Monday returns the NEXT Monday, not the same day', () => {
    const mon = DateTime.fromISO('2026-03-09T12:00:00', { zone: 'UTC' });
    expect(nextMonday(mon).toISODate()).toBe('2026-03-16');
  });
});

// ─── checkTimeFeasibility integration tests ────────────────────────────────────

describe('checkTimeFeasibility', () => {

  // CASE 1: Standard feasible weekend trip
  // Event: Sat Mar 7 10am PT (18:00Z) – Sun Mar 8 6pm PT (02:00Z Mon)
  // User: ET, last class Fri 6pm ET (23:00Z), first class Mon 9am ET (14:00Z)
  // Flight: 6h each way
  // latestDep  = 18:00Z - 6h = 12:00Z Sat  → after 23:00Z Fri ✓
  // returnArr  = 02:00Z Mon + 6h = 08:00Z Mon → before 14:00Z Mon ✓
  test('standard feasible weekend trip', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T18:00:00.000Z',
      endUTC:   '2026-03-09T02:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });
    const user = makeUser({ fridayEnd: '18:00', mondayStart: '09:00', timezone: 'America/New_York', outboundMinutes: 360, returnMinutes: 360 });

    const result = checkTimeFeasibility(event, user);

    expect(result.feasible).toBe(true);
    expect(result.outbound_feasible).toBe(true);
    expect(result.return_feasible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.latest_departure_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.earliest_return_arrival_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // CASE 2: Outbound infeasible — event starts too early Saturday
  // Event starts 2026-03-07T06:00Z (10pm Fri PT)
  // Flight 6h → must depart by 00:00Z Sat (7pm ET Fri)
  // User last class Fri 22:00 ET = 03:00Z Sat → 03:00Z > 00:00Z → infeasible
  test('event starts early Saturday — outbound infeasible', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T06:00:00.000Z',
      endUTC:   '2026-03-09T04:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });
    const user = makeUser({ fridayEnd: '22:00', mondayStart: '09:00', timezone: 'America/New_York', outboundMinutes: 360, returnMinutes: 60 });

    const result = checkTimeFeasibility(event, user);

    expect(result.outbound_feasible).toBe(false);
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('Outbound');
  });

  // CASE 3: Return infeasible — event ends late Sunday, long return flight misses Monday class
  // Mar 8 2026 is Sunday. endUTC = 2026-03-08T23:00Z (4pm PDT Sunday)
  // returnMinutes = 720 (12h) → returnArr = 2026-03-09T11:00Z (7am EDT Mon)
  // nextMonday(Sun Mar 8) = Mon Mar 9; mondayStart 05:00 EDT = 09:00Z
  // 11:00Z > 09:00Z → infeasible
  test('late Sunday end + long return flight misses Monday class', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T18:00:00.000Z',
      endUTC:   '2026-03-08T23:00:00.000Z', // Sunday March 8 2026
      timezone: 'America/Los_Angeles',
    });
    const user = makeUser({ fridayEnd: '16:00', mondayStart: '05:00', timezone: 'America/New_York', outboundMinutes: 180, returnMinutes: 720 });

    const result = checkTimeFeasibility(event, user);

    expect(result.return_feasible).toBe(false);
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('Return');
  });

  // CASE 4: Cross-timezone — ET user attending PT event
  // Event: SF (PT). startUTC = 2026-03-07T18:00Z, endUTC = 2026-03-09T04:00Z
  // latestDep = 18:00Z - 6h = 12:00Z Sat → after fridayDeadline 22:00Z Fri ✓
  // returnArr = 04:00Z Mon + 6h = 10:00Z Mon → before 14:00Z Mon (9am ET) ✓
  test('cross-timezone: ET user attending PT event', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T18:00:00.000Z',
      endUTC:   '2026-03-09T04:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });
    const user = makeUser({ fridayEnd: '17:00', mondayStart: '09:00', timezone: 'America/New_York', outboundMinutes: 360, returnMinutes: 360 });

    const result = checkTimeFeasibility(event, user);

    expect(result.feasible).toBe(true);
    expect(result.outbound_feasible).toBe(true);
    expect(result.return_feasible).toBe(true);
  });

  // CASE 5: Event ends after midnight Sunday (bleeds into Monday in event timezone)
  // endUTC = 2026-03-10T10:00Z (Tuesday 2am PT)
  // nextMonday of Tue Mar 10 = Mon Mar 16
  // returnArr = Mar 10 10:00Z + 2h = 12:00Z → before Mon Mar 16 class deadline → feasible
  test('event ending into Monday local time — nextMonday targets following week', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T20:00:00.000Z',
      endUTC:   '2026-03-10T10:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });
    const user = makeUser({ fridayEnd: '17:00', mondayStart: '09:00', timezone: 'America/New_York', outboundMinutes: 120, returnMinutes: 120 });

    expect(() => checkTimeFeasibility(event, user)).not.toThrow();
    const result = checkTimeFeasibility(event, user);
    expect(result.return_feasible).toBe(true);
  });

  // CASE 6: Multi-weekend spanning event — should not throw, outbound likely fails
  test('multi-weekend spanning event handles gracefully', () => {
    const event = makeEvent({
      startUTC: '2026-03-06T20:00:00.000Z',
      endUTC:   '2026-03-22T22:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });
    const user = makeUser({ fridayEnd: '18:00', mondayStart: '09:00', timezone: 'America/New_York', outboundMinutes: 360, returnMinutes: 360 });

    expect(() => checkTimeFeasibility(event, user)).not.toThrow();
    const result = checkTimeFeasibility(event, user);
    // latestDep = Mar 6 20:00Z - 6h = 14:00Z; fridayDeadline = Fri 18:00 ET = 23:00Z → infeasible
    expect(result.outbound_feasible).toBe(false);
  });

  // CASE 7: Zero flight duration (local event in same city)
  // latestDep = event start itself; returnArr = event end itself
  test('zero flight duration (local event) — departure window equals event start', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T20:00:00.000Z',
      endUTC:   '2026-03-08T22:00:00.000Z',
      timezone: 'America/New_York',
    });
    // fridayEnd 14:00 ET = 19:00Z Fri; latestDep = Sat 20:00Z > 19:00Z Fri ✓
    // returnArr = Sun 22:00Z; mondayClass 09:00 ET = 14:00Z Mon → 22:00Z Sun < 14:00Z Mon ✓
    const user = makeUser({ fridayEnd: '14:00', mondayStart: '09:00', timezone: 'America/New_York', outboundMinutes: 0, returnMinutes: 0 });

    const result = checkTimeFeasibility(event, user);

    expect(result.outbound_feasible).toBe(true);
    expect(result.latest_departure_utc).toBe(event.start_datetime_utc);
  });

  // CASE 8: DST spring-forward (2026-03-08, clocks spring forward in America/New_York)
  test('DST spring-forward date — Luxon resolves without throwing', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T18:00:00.000Z',
      endUTC:   '2026-03-08T23:00:00.000Z',
      timezone: 'America/New_York',
    });
    const user = makeUser({ fridayEnd: '17:00', mondayStart: '08:00', timezone: 'America/New_York', outboundMinutes: 60, returnMinutes: 60 });

    expect(() => checkTimeFeasibility(event, user)).not.toThrow();
    const result = checkTimeFeasibility(event, user);
    expect(typeof result.feasible).toBe('boolean');
  });

  // CASE 9: Both legs infeasible — reason mentions both
  // outbound: latestDep = Sat 06:00Z - 10h = Fri 20:00Z; fridayDeadline = Fri 23:00 UTC = 23:00Z
  //   20:00Z < 23:00Z → INFEASIBLE
  // return: returnArr = Sun 23:00Z + 2h = Mon 01:00Z; mondayDeadline = Mon 00:30 UTC = 00:30Z
  //   01:00Z > 00:30Z → INFEASIBLE
  test('both outbound and return infeasible — reason mentions both', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T06:00:00.000Z',
      endUTC:   '2026-03-08T23:00:00.000Z',
      timezone: 'UTC',
    });
    const user = makeUser({ fridayEnd: '23:00', mondayStart: '00:30', timezone: 'UTC', outboundMinutes: 600, returnMinutes: 120 });

    const result = checkTimeFeasibility(event, user);

    expect(result.feasible).toBe(false);
    expect(result.outbound_feasible).toBe(false);
    expect(result.return_feasible).toBe(false);
    expect(result.reason).toContain('Outbound');
    expect(result.reason).toContain('Return');
  });

  // CASE 10: Departure exactly at last-class boundary — inclusive (should be feasible)
  // event starts Friday 22:00Z with 0min flight → latestDep = 22:00Z Fri
  // fridayEnd = "22:00" UTC → deadline = 22:00Z Fri
  // 22:00Z >= 22:00Z → outbound feasible ✓
  test('departure exactly at last-class boundary is feasible (inclusive)', () => {
    const event = makeEvent({
      startUTC: '2026-03-06T22:00:00.000Z',
      endUTC:   '2026-03-08T20:00:00.000Z',
      timezone: 'UTC',
    });
    const user = makeUser({ fridayEnd: '22:00', mondayStart: '09:00', timezone: 'UTC', outboundMinutes: 0, returnMinutes: 0 });

    const result = checkTimeFeasibility(event, user);

    expect(result.outbound_feasible).toBe(true);
  });

  // CASE 11: null event_timezone falls back to UTC without throwing
  test('null event_timezone falls back to UTC gracefully', () => {
    const event = { start_datetime_utc: '2026-03-07T18:00:00.000Z', end_datetime_utc: '2026-03-09T02:00:00.000Z', event_timezone: null };
    const user = makeUser();

    expect(() => checkTimeFeasibility(event, user)).not.toThrow();
    const result = checkTimeFeasibility(event, user);
    expect(typeof result.feasible).toBe('boolean');
  });

  // CASE 12: Invalid start datetime throws a descriptive error
  test('invalid start_datetime_utc throws descriptive error', () => {
    const event = makeEvent({ startUTC: 'not-a-date', endUTC: '2026-03-09T02:00:00.000Z' });
    const user = makeUser();

    expect(() => checkTimeFeasibility(event, user)).toThrow('Invalid start_datetime_utc');
  });

  // CASE 13: Invalid flight durations throw descriptive errors
  test('invalid flight duration values throw descriptive errors', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T18:00:00.000Z',
      endUTC: '2026-03-09T02:00:00.000Z',
      timezone: 'UTC',
    });
    const user = makeUser({ outboundMinutes: Number.NaN, returnMinutes: 120 });

    expect(() => checkTimeFeasibility(event, user)).toThrow('Invalid avg_outbound_duration_minutes');
  });

  // CASE 14: Missing both class constraints disables schedule filtering
  test('missing Friday and Monday constraints skips class-time checks', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T06:00:00.000Z',
      endUTC: '2026-03-09T16:00:00.000Z',
      timezone: 'UTC',
    });
    const user = makeUser({
      fridayEnd: null,
      mondayStart: null,
      timezone: 'UTC',
      outboundMinutes: 600,
      returnMinutes: 600,
    });

    const result = checkTimeFeasibility(event, user);
    expect(result.feasible).toBe(true);
    expect(result.outbound_feasible).toBe(true);
    expect(result.return_feasible).toBe(true);
    expect(result.reason).toBeNull();
  });

  // CASE 15: Missing Monday constraint keeps only Friday departure check
  test('missing Monday constraint enforces only Friday outbound check', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T06:00:00.000Z',
      endUTC: '2026-03-09T16:00:00.000Z',
      timezone: 'UTC',
    });
    const user = makeUser({
      fridayEnd: '23:00',
      mondayStart: null,
      timezone: 'UTC',
      outboundMinutes: 600,
      returnMinutes: 600,
    });

    const result = checkTimeFeasibility(event, user);
    expect(result.feasible).toBe(false);
    expect(result.outbound_feasible).toBe(false);
    expect(result.return_feasible).toBe(true);
    expect(result.reason).toContain('Outbound');
  });

  // CASE 16: Missing Friday constraint keeps only Monday return check
  test('missing Friday constraint enforces only Monday return check', () => {
    const event = makeEvent({
      startUTC: '2026-03-07T18:00:00.000Z',
      endUTC: '2026-03-08T23:00:00.000Z',
      timezone: 'UTC',
    });
    const user = makeUser({
      fridayEnd: null,
      mondayStart: '09:00',
      timezone: 'UTC',
      outboundMinutes: 60,
      returnMinutes: 720,
    });

    const result = checkTimeFeasibility(event, user);
    expect(result.feasible).toBe(false);
    expect(result.outbound_feasible).toBe(true);
    expect(result.return_feasible).toBe(false);
    expect(result.reason).toContain('Return');
  });
});
