'use strict';

const express = require('express');
const db = require('../db');
const {
  verifyGoogleCredential,
  upsertGoogleUser,
  issueSessionToken,
  requireAuth,
  serializeUser,
} = require('../auth');

const router = express.Router();

router.post('/google', async (req, res) => {
  const credential = String(req.body?.credential || '').trim();
  if (!credential) {
    return res.status(400).json({ error: 'Missing Google credential.' });
  }

  try {
    const googleProfile = await verifyGoogleCredential(credential);
    const user = await upsertGoogleUser(googleProfile);
    const token = issueSessionToken(user);

    return res.json({
      token,
      user: serializeUser(user),
    });
  } catch (err) {
    if ((err?.message || '').includes('Missing GOOGLE_CLIENT_ID')) {
      return res.status(503).json({ error: 'Google Sign-In is not configured on this server.' });
    }
    if ((err?.message || '').includes('Missing AUTH_JWT_SECRET')) {
      return res.status(503).json({ error: 'Session token signing is not configured on this server.' });
    }

    console.error('[auth] Google sign-in failed:', err);
    return res.status(401).json({ error: 'Google credential verification failed.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          google_sub,
          email,
          name,
          picture_url,
          last_login_at,
          created_at,
          updated_at
        FROM app_users
        WHERE id = $1
        LIMIT 1;
      `,
      [req.auth.user_id]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Authenticated user was not found.' });
    }

    return res.json({ user: serializeUser(result.rows[0]) });
  } catch (err) {
    console.error('[auth] Failed to fetch session user:', err);
    return res.status(500).json({ error: 'Failed to read session user.' });
  }
});

module.exports = router;
