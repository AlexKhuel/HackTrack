'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

function cleanString(value, maxLength = 255) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanAirportCode(value) {
  const text = cleanString(value, 3);
  if (!text) return null;
  const code = text.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function cleanSmallInt(value) {
  if (value == null || value === '') return null;
  const num = Math.round(Number(value));
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.min(32767, num);
}

function cleanTime(value) {
  const text = cleanString(value, 8);
  if (!text) return null;
  if (/^\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return null;
}

function cleanFriendCities(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(',')
      .map((entry) => entry.trim());

  const seen = new Set();
  const cities = [];

  for (const entry of raw) {
    const city = cleanString(entry, 120);
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(city);
  }

  return cities;
}

function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  return {
    name: cleanString(raw.name),
    country: cleanString(raw.country),
    primary_airport_code: cleanAirportCode(raw.primary_airport_code),
    secondary_airport_code: cleanAirportCode(raw.secondary_airport_code),
    tertiary_airport_code: cleanAirportCode(raw.tertiary_airport_code),
    friend_cities: cleanFriendCities(raw.friend_cities),
    timezone: cleanString(raw.timezone),
    max_cost: cleanSmallInt(raw.max_cost),
    max_time: cleanSmallInt(raw.max_time),
    friday_last_class: cleanTime(raw.friday_last_class),
    monday_first_class: cleanTime(raw.monday_first_class),
  };
}

router.use(requireAuth);

router.post('/', async (req, res) => {
  const rawInput = req.body?.input && typeof req.body.input === 'object'
    ? req.body.input
    : req.body;
  const input = normalizeInput(rawInput);

  if (!input) {
    return res.status(400).json({ error: 'Invalid input payload.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const appUserResult = await client.query(
      `
        SELECT profile_row_id
        FROM app_users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE;
      `,
      [req.auth.user_id]
    );

    if (appUserResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Authenticated user was not found.' });
    }

    const profileRowId = Number(appUserResult.rows[0].profile_row_id);
    const hasLinkedProfileRow = Number.isFinite(profileRowId) && profileRowId > 0;
    let savedInputResult;

    if (hasLinkedProfileRow) {
      savedInputResult = await client.query(
        `
          UPDATE public."user"
          SET
            name = $2,
            country = $3,
            primary_airport_code = $4,
            secondary_airport_code = $5,
            tertiary_airport_code = $6,
            friend_cities = $7::text[],
            timezone = $8,
            max_cost = $9,
            max_time = $10,
            friday_last_class = $11,
            monday_first_class = $12
          WHERE id = $1
          RETURNING
            id,
            name,
            country,
            primary_airport_code,
            secondary_airport_code,
            tertiary_airport_code,
            friend_cities,
            timezone,
            max_cost,
            max_time,
            friday_last_class,
            monday_first_class;
        `,
        [
          profileRowId,
          input.name,
          input.country,
          input.primary_airport_code,
          input.secondary_airport_code,
          input.tertiary_airport_code,
          input.friend_cities,
          input.timezone,
          input.max_cost,
          input.max_time,
          input.friday_last_class,
          input.monday_first_class,
        ]
      );
    }

    if (!savedInputResult || savedInputResult.rowCount === 0) {
      savedInputResult = await client.query(
        `
          INSERT INTO public."user" (
            name,
            country,
            primary_airport_code,
            secondary_airport_code,
            tertiary_airport_code,
            friend_cities,
            timezone,
            max_cost,
            max_time,
            friday_last_class,
            monday_first_class
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6::text[],
            $7, $8, $9, $10, $11
          )
          RETURNING
            id,
            name,
            country,
            primary_airport_code,
            secondary_airport_code,
            tertiary_airport_code,
            friend_cities,
            timezone,
            max_cost,
            max_time,
            friday_last_class,
            monday_first_class;
        `,
        [
          input.name,
          input.country,
          input.primary_airport_code,
          input.secondary_airport_code,
          input.tertiary_airport_code,
          input.friend_cities,
          input.timezone,
          input.max_cost,
          input.max_time,
          input.friday_last_class,
          input.monday_first_class,
        ]
      );

      await client.query(
        `
          UPDATE app_users
          SET profile_row_id = $1, updated_at = NOW()
          WHERE id = $2;
        `,
        [savedInputResult.rows[0].id, req.auth.user_id]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ input: savedInputResult.rows[0] });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; original error is more useful.
    }
    console.error('[user-inputs] Failed to save user input:', err);
    return res.status(500).json({ error: 'Failed to save user input.' });
  } finally {
    client.release();
  }
});

router.get('/latest', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const appUserResult = await client.query(
      `
        SELECT id, name, profile_row_id
        FROM app_users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE;
      `,
      [req.auth.user_id]
    );

    if (appUserResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Authenticated user was not found.' });
    }

    const appUser = appUserResult.rows[0];
    const linkedProfileRowId = Number(appUser.profile_row_id);
    const hasLinkedProfile = Number.isFinite(linkedProfileRowId) && linkedProfileRowId > 0;

    if (hasLinkedProfile) {
      const profileResult = await client.query(
        `
          SELECT
            id,
            name,
            country,
            primary_airport_code,
            secondary_airport_code,
            tertiary_airport_code,
            friend_cities,
            timezone,
            max_cost,
            max_time,
            friday_last_class,
            monday_first_class
          FROM public."user"
          WHERE id = $1
          LIMIT 1;
        `,
        [linkedProfileRowId]
      );

      await client.query('COMMIT');
      if (profileResult.rowCount === 0) return res.json({ input: null });
      return res.json({ input: profileResult.rows[0] });
    }

    const appUserName = cleanString(appUser.name);
    if (!appUserName) {
      await client.query('COMMIT');
      return res.json({ input: null });
    }

    const legacyCandidateResult = await client.query(
      `
        SELECT
          input.id,
          input.name,
          input.country,
          input.primary_airport_code,
          input.secondary_airport_code,
          input.tertiary_airport_code,
          input.friend_cities,
          input.timezone,
          input.max_cost,
          input.max_time,
          input.friday_last_class,
          input.monday_first_class
        FROM public."user" input
        WHERE lower(btrim(coalesce(input.name, ''))) = lower(btrim($1))
          AND NOT EXISTS (
            SELECT 1
            FROM app_users mapped
            WHERE mapped.profile_row_id = input.id
          )
        ORDER BY input.id DESC
        LIMIT 2;
      `,
      [appUserName]
    );

    if (legacyCandidateResult.rowCount !== 1) {
      await client.query('COMMIT');
      return res.json({ input: null });
    }

    const legacyProfile = legacyCandidateResult.rows[0];
    await client.query(
      `
        UPDATE app_users
        SET profile_row_id = $1, updated_at = NOW()
        WHERE id = $2;
      `,
      [legacyProfile.id, req.auth.user_id]
    );

    await client.query('COMMIT');
    return res.json({ input: legacyProfile });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; original error is more useful.
    }
    console.error('[user-inputs] Failed to fetch user input:', err);
    return res.status(500).json({ error: 'Failed to fetch user input.' });
  } finally {
    client.release();
  }
});

module.exports = router;
