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

  try {
    const result = await db.query(
      `
        INSERT INTO public."user" (
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
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::text[],
          $8, $9, $10, $11, $12
        )
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          country = EXCLUDED.country,
          primary_airport_code = EXCLUDED.primary_airport_code,
          secondary_airport_code = EXCLUDED.secondary_airport_code,
          tertiary_airport_code = EXCLUDED.tertiary_airport_code,
          friend_cities = EXCLUDED.friend_cities,
          timezone = EXCLUDED.timezone,
          max_cost = EXCLUDED.max_cost,
          max_time = EXCLUDED.max_time,
          friday_last_class = EXCLUDED.friday_last_class,
          monday_first_class = EXCLUDED.monday_first_class
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
        req.auth.user_id,
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

    return res.status(201).json({ input: result.rows[0] });
  } catch (err) {
    console.error('[user-inputs] Failed to save user input:', err);
    return res.status(500).json({ error: 'Failed to save user input.' });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const result = await db.query(
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
      [req.auth.user_id]
    );

    if (result.rowCount === 0) {
      return res.json({ input: null });
    }

    return res.json({ input: result.rows[0] });
  } catch (err) {
    console.error('[user-inputs] Failed to fetch user input:', err);
    return res.status(500).json({ error: 'Failed to fetch user input.' });
  }
});

module.exports = router;
