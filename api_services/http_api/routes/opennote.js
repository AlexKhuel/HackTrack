'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { decryptString, encryptString } = require('../opennote/crypto');
const {
  buildFrontendReturnUrl,
  parseOpenNoteConfig,
  validateOpenNoteConfig,
} = require('../opennote/config');
const {
  consumeOauthState,
  createOauthState,
  exchangeAuthorizationCode,
} = require('../opennote/oauth');
const {
  createOpenNoteJournal,
  fetchOpenNoteAccount,
  updateOpenNoteJournal,
  withOpenNoteTokenRefresh,
} = require('../opennote/client');
const {
  buildVenueFallback,
  enrichEventLocation,
  inferSchool,
  normalizeText,
} = require('../opennote/enrichment');
const { buildTravelLinks } = require('../opennote/linkBuilder');
const {
  buildOpenNoteJournalPayload,
  hashJournalPayload,
} = require('../opennote/journalBuilder');

const router = express.Router();

function requireAuthenticatedUser(req, res) {
  const userId = Number(req?.auth?.user_id);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return userId;
}

function getValidatedConfig(res) {
  try {
    return validateOpenNoteConfig(parseOpenNoteConfig());
  } catch (err) {
    res.status(503).json({ error: err.message });
    return null;
  }
}

function buildCallbackRedirect(url, status, errorText = null) {
  const fallback = '/?view=results';
  const target = normalizeText(url) || fallback;
  const parsed = new URL(target, 'http://localhost');
  parsed.searchParams.set('opennote', status);
  if (errorText) {
    parsed.searchParams.set('opennote_error', String(errorText).slice(0, 180));
  }

  if (target.startsWith('http://') || target.startsWith('https://')) {
    return parsed.toString();
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function normalizeEventExportKey(result) {
  const event = result?.event || {};
  if (event.id != null && String(event.id).trim() !== '') {
    return String(event.id).trim();
  }

  const fallback = [
    normalizeText(event.name) || 'unknown-event',
    normalizeText(event.start_datetime_utc) || 'unknown-date',
  ].join('|');
  return fallback.slice(0, 220);
}

async function getConnectionByUserId(appUserId) {
  const result = await db.query(
    `
      SELECT
        app_user_id,
        opennote_account_id,
        opennote_account_email,
        opennote_account_name,
        access_token_encrypted,
        refresh_token_encrypted,
        token_expires_at,
        scope
      FROM app_user_opennote_connections
      WHERE app_user_id = $1
      LIMIT 1
    `,
    [appUserId]
  );

  if (result.rowCount === 0) return null;
  return result.rows[0];
}

async function upsertConnection({
  appUserId,
  account,
  encryptedAccessToken,
  encryptedRefreshToken,
  tokenExpiresAt,
  scope,
}) {
  await db.query(
    `
      INSERT INTO app_user_opennote_connections (
        app_user_id,
        opennote_account_id,
        opennote_account_email,
        opennote_account_name,
        access_token_encrypted,
        refresh_token_encrypted,
        token_expires_at,
        scope,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (app_user_id)
      DO UPDATE SET
        opennote_account_id = EXCLUDED.opennote_account_id,
        opennote_account_email = EXCLUDED.opennote_account_email,
        opennote_account_name = EXCLUDED.opennote_account_name,
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        updated_at = NOW()
    `,
    [
      appUserId,
      account.id,
      account.email,
      account.name,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      scope,
    ]
  );
}

async function persistRefreshedTokens(appUserId, refreshedTokens) {
  const encryptedAccessToken = encryptString(refreshedTokens.accessToken);
  const encryptedRefreshToken = refreshedTokens.refreshToken
    ? encryptString(refreshedTokens.refreshToken)
    : null;

  await db.query(
    `
      UPDATE app_user_opennote_connections
      SET
        access_token_encrypted = $2,
        refresh_token_encrypted = COALESCE($3, refresh_token_encrypted),
        token_expires_at = COALESCE($4, token_expires_at),
        scope = COALESCE($5, scope),
        updated_at = NOW()
      WHERE app_user_id = $1
    `,
    [
      appUserId,
      encryptedAccessToken,
      encryptedRefreshToken,
      refreshedTokens.tokenExpiresAt,
      refreshedTokens.scope,
    ]
  );
}

async function getExistingExport(appUserId, eventId) {
  const result = await db.query(
    `
      SELECT app_user_id, event_id, opennote_journal_id, opennote_journal_url
      FROM app_user_opennote_exports
      WHERE app_user_id = $1 AND event_id = $2
      LIMIT 1
    `,
    [appUserId, eventId]
  );

  return result.rowCount > 0 ? result.rows[0] : null;
}

async function upsertExportRecord({
  appUserId,
  eventId,
  journalId,
  journalUrl,
  payloadHash,
}) {
  await db.query(
    `
      INSERT INTO app_user_opennote_exports (
        app_user_id,
        event_id,
        opennote_journal_id,
        opennote_journal_url,
        last_payload_hash,
        last_exported_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
      ON CONFLICT (app_user_id, event_id)
      DO UPDATE SET
        opennote_journal_id = EXCLUDED.opennote_journal_id,
        opennote_journal_url = EXCLUDED.opennote_journal_url,
        last_payload_hash = EXCLUDED.last_payload_hash,
        last_exported_at = NOW(),
        updated_at = NOW()
    `,
    [appUserId, eventId, journalId, journalUrl, payloadHash]
  );
}

async function handleStatus(req, res) {
  const appUserId = requireAuthenticatedUser(req, res);
  if (!appUserId) return;

  try {
    const row = await getConnectionByUserId(appUserId);
    if (!row) return res.json({ connected: false, account: null });

    return res.json({
      connected: true,
      account: {
        id: row.opennote_account_id,
        email: row.opennote_account_email,
        name: row.opennote_account_name,
      },
    });
  } catch (err) {
    console.error('[opennote] status failed:', err);
    return res.status(500).json({ error: 'Failed to read OpenNote connection status.' });
  }
}

async function handleOAuthStart(req, res) {
  const appUserId = requireAuthenticatedUser(req, res);
  if (!appUserId) return;

  const config = getValidatedConfig(res);
  if (!config) return;

  try {
    const returnTo = normalizeText(req.body?.return_to) || null;
    const { authorizationUrl } = await createOauthState({
      db,
      config,
      appUserId,
      returnTo,
    });

    return res.status(201).json({ authorization_url: authorizationUrl });
  } catch (err) {
    console.error('[opennote] oauth start failed:', err);
    return res.status(500).json({ error: 'Failed to create OpenNote authorization URL.' });
  }
}

async function handleOAuthCallback(req, res) {
  const config = parseOpenNoteConfig();
  const code = normalizeText(req.query?.code);
  const stateToken = normalizeText(req.query?.state);

  const fallbackRedirect = buildFrontendReturnUrl(null, config);

  if (!code || !stateToken) {
    return res.redirect(buildCallbackRedirect(fallbackRedirect, 'error', 'Missing OAuth callback parameters.'));
  }

  let validatedConfig;
  try {
    validatedConfig = validateOpenNoteConfig(config);
  } catch (err) {
    return res.redirect(buildCallbackRedirect(fallbackRedirect, 'error', err.message));
  }

  try {
    const state = await consumeOauthState({ db, stateToken });
    if (!state) {
      return res.redirect(buildCallbackRedirect(fallbackRedirect, 'error', 'OAuth state is invalid or expired.'));
    }

    const redirectTarget = buildFrontendReturnUrl(state.returnTo, validatedConfig);

    const tokenData = await exchangeAuthorizationCode({
      config: validatedConfig,
      code,
      codeVerifier: state.codeVerifier,
    });

    if (!tokenData.accessToken) {
      return res.redirect(buildCallbackRedirect(redirectTarget, 'error', 'OpenNote OAuth did not return an access token.'));
    }

    const account = await fetchOpenNoteAccount(validatedConfig, tokenData.accessToken);
    if (!account.id) {
      return res.redirect(buildCallbackRedirect(redirectTarget, 'error', 'OpenNote account lookup failed.'));
    }

    await upsertConnection({
      appUserId: state.appUserId,
      account,
      encryptedAccessToken: encryptString(tokenData.accessToken),
      encryptedRefreshToken: tokenData.refreshToken ? encryptString(tokenData.refreshToken) : null,
      tokenExpiresAt: tokenData.tokenExpiresAt,
      scope: tokenData.scope,
    });

    return res.redirect(buildCallbackRedirect(redirectTarget, 'connected'));
  } catch (err) {
    console.error('[opennote] oauth callback failed:', err);
    return res.redirect(buildCallbackRedirect(fallbackRedirect, 'error', err.message || 'OpenNote OAuth failed.'));
  }
}

async function handleDisconnect(req, res) {
  const appUserId = requireAuthenticatedUser(req, res);
  if (!appUserId) return;

  try {
    await db.query('DELETE FROM app_user_opennote_exports WHERE app_user_id = $1', [appUserId]);
    await db.query('DELETE FROM app_user_opennote_connections WHERE app_user_id = $1', [appUserId]);
    return res.status(204).send();
  } catch (err) {
    console.error('[opennote] disconnect failed:', err);
    return res.status(500).json({ error: 'Failed to disconnect OpenNote account.' });
  }
}

async function handleExportHackathon(req, res) {
  const appUserId = requireAuthenticatedUser(req, res);
  if (!appUserId) return;

  const config = getValidatedConfig(res);
  if (!config) return;

  const result = req.body?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return res.status(400).json({ error: 'Missing required body.result payload.' });
  }

  if (!result.event || typeof result.event !== 'object') {
    return res.status(400).json({ error: 'body.result.event is required.' });
  }

  const eventId = normalizeEventExportKey(result);

  try {
    const connection = await getConnectionByUserId(appUserId);
    if (!connection) {
      return res.status(400).json({ error: 'OpenNote account is not connected.' });
    }

    const accessToken = decryptString(connection.access_token_encrypted);
    const refreshToken = connection.refresh_token_encrypted
      ? decryptString(connection.refresh_token_encrypted)
      : null;

    const location = await enrichEventLocation(result.event);
    const school = inferSchool(result.event);
    const venueLabel = buildVenueFallback(location);
    const links = buildTravelLinks({ result, location, venueLabel });
    const journalPayload = buildOpenNoteJournalPayload({
      result,
      school,
      location,
      venueLabel,
      links,
    });
    const payloadHash = hashJournalPayload(journalPayload);

    const existing = await getExistingExport(appUserId, eventId);

    const operation = existing?.opennote_journal_id
      ? (token) => updateOpenNoteJournal(config, token, existing.opennote_journal_id, journalPayload)
      : (token) => createOpenNoteJournal(config, token, journalPayload);

    const opennoteResult = await withOpenNoteTokenRefresh({
      config,
      accessToken,
      refreshToken,
      onTokenRefresh: async (refreshedTokens) => {
        await persistRefreshedTokens(appUserId, refreshedTokens);
      },
      operation,
    });

    const journalId = opennoteResult?.result?.journalId || existing?.opennote_journal_id;
    const journalUrl = opennoteResult?.result?.journalUrl || existing?.opennote_journal_url || null;

    if (!journalId) {
      return res.status(502).json({ error: 'OpenNote journal response did not include a journal id.' });
    }

    await upsertExportRecord({
      appUserId,
      eventId,
      journalId,
      journalUrl,
      payloadHash,
    });

    return res.status(201).json({
      status: existing ? 'updated' : 'created',
      journal_id: journalId,
      journal_url: journalUrl,
    });
  } catch (err) {
    console.error('[opennote] export failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to export hackathon to OpenNote.' });
  }
}

router.get('/status', requireAuth, handleStatus);
router.post('/oauth/start', requireAuth, handleOAuthStart);
router.get('/oauth/callback', handleOAuthCallback);
router.post('/disconnect', requireAuth, handleDisconnect);
router.post('/export-hackathon', requireAuth, handleExportHackathon);

module.exports = router;
module.exports._private = {
  buildCallbackRedirect,
  handleExportHackathon,
  handleOAuthStart,
  handleStatus,
  normalizeEventExportKey,
  requireAuthenticatedUser,
};
