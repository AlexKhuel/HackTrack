'use strict';

const crypto = require('crypto');
const { DateTime } = require('luxon');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function buildPkcePair() {
  const codeVerifier = randomToken(48);
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function buildAuthorizationUrl({ config, stateToken, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.oauthRedirectUri,
    scope: config.scopes,
    state: stateToken,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${config.authorizationUrl}${config.authorizationUrl.includes('?') ? '&' : '?'}${params.toString()}`;
}

async function createOauthState({ db, config, appUserId, returnTo }) {
  await db.query('DELETE FROM app_user_opennote_oauth_states WHERE expires_at < NOW()');

  const stateToken = randomToken(32);
  const { codeVerifier, codeChallenge } = buildPkcePair();
  const expiresAt = DateTime.utc().plus({ seconds: config.oauthStateTtlSeconds }).toISO();

  await db.query(
    `
      INSERT INTO app_user_opennote_oauth_states (
        state_token,
        app_user_id,
        code_verifier,
        return_to,
        expires_at,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [stateToken, appUserId, codeVerifier, returnTo || null, expiresAt]
  );

  const authorizationUrl = buildAuthorizationUrl({ config, stateToken, codeChallenge });
  return { authorizationUrl, stateToken };
}

async function consumeOauthState({ db, stateToken }) {
  const token = String(stateToken || '').trim();
  if (!token) return null;

  const result = await db.query(
    `
      DELETE FROM app_user_opennote_oauth_states
      WHERE state_token = $1
      RETURNING state_token, app_user_id, code_verifier, return_to, expires_at
    `,
    [token]
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  const expiresAt = DateTime.fromISO(String(row.expires_at), { zone: 'utc' });
  if (!expiresAt.isValid || expiresAt < DateTime.utc()) {
    return null;
  }

  return {
    appUserId: Number(row.app_user_id),
    codeVerifier: row.code_verifier,
    returnTo: row.return_to,
  };
}

function buildTokenRequestBody({ config, grantType, code, codeVerifier, refreshToken }) {
  const params = new URLSearchParams({
    grant_type: grantType,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.oauthRedirectUri,
  });

  if (grantType === 'authorization_code') {
    params.set('code', String(code || '').trim());
    params.set('code_verifier', String(codeVerifier || '').trim());
  }

  if (grantType === 'refresh_token') {
    params.set('refresh_token', String(refreshToken || '').trim());
  }

  return params.toString();
}

async function fetchTokenPayload({ config, body }) {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error_description: raw };
    }
  }

  if (!response.ok) {
    const msg = payload.error_description || payload.error || `OpenNote token exchange failed (${response.status})`;
    throw new Error(msg);
  }

  return payload;
}

function parseExpiresAt(expiresInSeconds) {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return DateTime.utc().plus({ seconds }).toISO();
}

async function exchangeAuthorizationCode({ config, code, codeVerifier }) {
  const body = buildTokenRequestBody({
    config,
    grantType: 'authorization_code',
    code,
    codeVerifier,
  });
  const payload = await fetchTokenPayload({ config, body });
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    scope: payload.scope || null,
    tokenExpiresAt: parseExpiresAt(payload.expires_in),
  };
}

async function refreshOpenNoteToken({ config, refreshToken }) {
  const body = buildTokenRequestBody({
    config,
    grantType: 'refresh_token',
    refreshToken,
  });
  const payload = await fetchTokenPayload({ config, body });
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    scope: payload.scope || null,
    tokenExpiresAt: parseExpiresAt(payload.expires_in),
  };
}

module.exports = {
  consumeOauthState,
  createOauthState,
  exchangeAuthorizationCode,
  refreshOpenNoteToken,
};
