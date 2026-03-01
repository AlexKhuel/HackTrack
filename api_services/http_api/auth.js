'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

const oauthClient = new OAuth2Client();
const SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function requireGoogleClientId() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    throw new Error('Missing GOOGLE_CLIENT_ID in environment');
  }
  return clientId;
}

function requireJwtSecret() {
  const jwtSecret = String(process.env.AUTH_JWT_SECRET || '').trim();
  if (!jwtSecret) {
    throw new Error('Missing AUTH_JWT_SECRET in environment');
  }
  return jwtSecret;
}

async function verifyGoogleCredential(credential) {
  const token = String(credential || '').trim();
  if (!token) throw new Error('Missing Google credential');

  const ticket = await oauthClient.verifyIdToken({
    idToken: token,
    audience: requireGoogleClientId(),
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('Google credential did not include a valid subject');
  }

  return {
    google_sub: payload.sub,
    email: payload.email || null,
    name: payload.name || null,
    picture_url: payload.picture || null,
  };
}

async function upsertGoogleUser(profile) {
  const result = await db.query(
    `
      INSERT INTO app_users (
        google_sub,
        email,
        name,
        picture_url,
        last_login_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      ON CONFLICT (google_sub)
      DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        picture_url = EXCLUDED.picture_url,
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        google_sub,
        email,
        name,
        picture_url,
        last_login_at,
        created_at,
        updated_at;
    `,
    [profile.google_sub, profile.email, profile.name, profile.picture_url]
  );

  return result.rows[0];
}

function serializeUser(userRow) {
  if (!userRow) return null;
  return {
    id: Number(userRow.id),
    google_sub: userRow.google_sub,
    email: userRow.email,
    name: userRow.name,
    picture_url: userRow.picture_url,
    last_login_at: userRow.last_login_at,
    created_at: userRow.created_at,
    updated_at: userRow.updated_at,
  };
}

function issueSessionToken(userRow) {
  const tokenPayload = {
    sub: String(userRow.id),
    email: userRow.email || null,
    name: userRow.name || null,
    picture_url: userRow.picture_url || null,
  };

  return jwt.sign(tokenPayload, requireJwtSecret(), {
    expiresIn: SESSION_TOKEN_TTL_SECONDS,
  });
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function requireAuth(req, res, next) {
  let jwtSecret;
  try {
    jwtSecret = requireJwtSecret();
  } catch (err) {
    console.error('[auth] Misconfigured auth secret:', err.message);
    return res.status(503).json({ error: 'Auth is not configured on the server.' });
  }

  const token = parseBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const userId = Number(decoded.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid token subject.' });
    }

    req.auth = {
      user_id: userId,
      email: decoded.email || null,
      name: decoded.name || null,
      picture_url: decoded.picture_url || null,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = {
  verifyGoogleCredential,
  upsertGoogleUser,
  issueSessionToken,
  requireAuth,
  serializeUser,
};
