'use strict';

const DEFAULT_SCOPES = 'journals.write journals.read profile offline_access';
const DEFAULT_JOURNAL_CREATE_PATH = '/journals';
const DEFAULT_JOURNAL_UPDATE_TEMPLATE = '/journals/{id}';
const DEFAULT_OAUTH_STATE_TTL_SECONDS = 15 * 60;
const DEFAULT_WEB_RETURN_PATH = '/?view=results';

function trim(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(value) {
  return trim(value).replace(/\/+$/, '');
}

function parseStateTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OAUTH_STATE_TTL_SECONDS;
  return Math.round(parsed);
}

function parseOpenNoteConfig() {
  const clientId = trim(process.env.OPENNOTE_CLIENT_ID);
  const clientSecret = trim(process.env.OPENNOTE_CLIENT_SECRET);
  const authorizationUrl = trim(process.env.OPENNOTE_AUTHORIZATION_URL);
  const tokenUrl = trim(process.env.OPENNOTE_TOKEN_URL);
  const oauthRedirectUri = trim(process.env.OPENNOTE_OAUTH_REDIRECT_URI);
  const apiBaseUrl = normalizeBaseUrl(process.env.OPENNOTE_API_BASE_URL);

  const scopes = trim(process.env.OPENNOTE_OAUTH_SCOPES) || DEFAULT_SCOPES;
  const userInfoUrl = trim(process.env.OPENNOTE_USERINFO_URL) || (apiBaseUrl ? `${apiBaseUrl}/me` : '');
  const journalCreatePath = trim(process.env.OPENNOTE_JOURNAL_CREATE_PATH) || DEFAULT_JOURNAL_CREATE_PATH;
  const journalUpdateTemplate = trim(process.env.OPENNOTE_JOURNAL_UPDATE_PATH_TEMPLATE) || DEFAULT_JOURNAL_UPDATE_TEMPLATE;
  const oauthStateTtlSeconds = parseStateTtl(process.env.OPENNOTE_OAUTH_STATE_TTL_SECONDS);
  const webBaseUrl = normalizeBaseUrl(process.env.OPENNOTE_WEB_BASE_URL);
  const defaultReturnPath = trim(process.env.OPENNOTE_DEFAULT_RETURN_PATH) || DEFAULT_WEB_RETURN_PATH;

  return {
    apiBaseUrl,
    authorizationUrl,
    clientId,
    clientSecret,
    defaultReturnPath,
    journalCreatePath,
    journalUpdateTemplate,
    oauthRedirectUri,
    oauthStateTtlSeconds,
    scopes,
    tokenUrl,
    userInfoUrl,
    webBaseUrl,
  };
}

function validateOpenNoteConfig(config = parseOpenNoteConfig()) {
  const missing = [];

  for (const [field, value] of Object.entries({
    OPENNOTE_CLIENT_ID: config.clientId,
    OPENNOTE_CLIENT_SECRET: config.clientSecret,
    OPENNOTE_AUTHORIZATION_URL: config.authorizationUrl,
    OPENNOTE_TOKEN_URL: config.tokenUrl,
    OPENNOTE_OAUTH_REDIRECT_URI: config.oauthRedirectUri,
    OPENNOTE_API_BASE_URL: config.apiBaseUrl,
    OPENNOTE_USERINFO_URL: config.userInfoUrl,
    OPENNOTE_TOKEN_ENCRYPTION_KEY: trim(process.env.OPENNOTE_TOKEN_ENCRYPTION_KEY),
  })) {
    if (!value) missing.push(field);
  }

  if (!config.journalCreatePath || !config.journalUpdateTemplate.includes('{id}')) {
    missing.push('OPENNOTE_JOURNAL_CREATE_PATH/OPENNOTE_JOURNAL_UPDATE_PATH_TEMPLATE');
  }

  if (missing.length > 0) {
    throw new Error(`OpenNote integration is misconfigured. Missing/invalid: ${missing.join(', ')}`);
  }

  return config;
}

function buildFrontendReturnUrl(returnTo, config = parseOpenNoteConfig()) {
  const fallbackPath = config.defaultReturnPath || DEFAULT_WEB_RETURN_PATH;
  const candidate = trim(returnTo);

  if (!candidate) {
    if (config.webBaseUrl) return `${config.webBaseUrl}${fallbackPath}`;
    return fallbackPath;
  }

  if (/^https?:\/\//i.test(candidate)) {
    if (!config.webBaseUrl) return fallbackPath;
    try {
      const allowedOrigin = new URL(config.webBaseUrl).origin;
      const candidateOrigin = new URL(candidate).origin;
      return candidateOrigin === allowedOrigin ? candidate : `${config.webBaseUrl}${fallbackPath}`;
    } catch {
      return `${config.webBaseUrl}${fallbackPath}`;
    }
  }

  if (candidate.startsWith('/')) {
    if (config.webBaseUrl) return `${config.webBaseUrl}${candidate}`;
    return candidate;
  }

  if (config.webBaseUrl) {
    return `${config.webBaseUrl}${fallbackPath}`;
  }

  return fallbackPath;
}

module.exports = {
  buildFrontendReturnUrl,
  parseOpenNoteConfig,
  validateOpenNoteConfig,
};
