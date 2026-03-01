'use strict';

const { refreshOpenNoteToken } = require('./oauth');

class OpenNoteHttpError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'OpenNoteHttpError';
    this.status = status;
    this.payload = payload;
  }
}

function buildApiUrl(config, path) {
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${config.apiBaseUrl}${cleanPath}`;
}

function buildUpdatePath(template, journalId) {
  const id = encodeURIComponent(String(journalId || '').trim());
  return template.replace('{id}', id);
}

async function requestOpenNote({ method, url, accessToken, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { raw };
    }
  }

  if (!response.ok) {
    const message = payload.error || payload.message || `OpenNote request failed (${response.status})`;
    throw new OpenNoteHttpError(message, response.status, payload);
  }

  return payload;
}

async function fetchOpenNoteAccount(config, accessToken) {
  const payload = await requestOpenNote({
    method: 'GET',
    url: config.userInfoUrl,
    accessToken,
  });

  const candidate = payload.account || payload.user || payload.profile || payload;
  return {
    id: String(candidate.id || candidate.account_id || candidate.sub || '').trim(),
    email: candidate.email || null,
    name: candidate.name || candidate.display_name || null,
  };
}

function normalizeJournalResponse(payload) {
  const journal = payload.journal || payload.data || payload;
  const journalId = String(journal.id || journal.journal_id || '').trim();
  const journalUrl = journal.url || journal.journal_url || null;
  return {
    journalId,
    journalUrl,
    raw: payload,
  };
}

async function createOpenNoteJournal(config, accessToken, journalPayload) {
  const payload = await requestOpenNote({
    method: 'POST',
    url: buildApiUrl(config, config.journalCreatePath),
    accessToken,
    body: journalPayload,
  });
  return normalizeJournalResponse(payload);
}

async function updateOpenNoteJournal(config, accessToken, journalId, journalPayload) {
  const payload = await requestOpenNote({
    method: 'PATCH',
    url: buildApiUrl(config, buildUpdatePath(config.journalUpdateTemplate, journalId)),
    accessToken,
    body: journalPayload,
  });
  return normalizeJournalResponse(payload);
}

async function withOpenNoteTokenRefresh({
  config,
  accessToken,
  refreshToken,
  onTokenRefresh,
  operation,
}) {
  try {
    const result = await operation(accessToken);
    return { result, accessToken, refreshToken };
  } catch (err) {
    const shouldRefresh = err instanceof OpenNoteHttpError && err.status === 401 && refreshToken;
    if (!shouldRefresh) throw err;

    const refreshed = await refreshOpenNoteToken({ config, refreshToken });
    if (!refreshed.accessToken) {
      throw new Error('OpenNote token refresh did not return an access token');
    }

    if (typeof onTokenRefresh === 'function') {
      await onTokenRefresh(refreshed);
    }

    const result = await operation(refreshed.accessToken);
    return {
      result,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || refreshToken,
      scope: refreshed.scope || null,
      tokenExpiresAt: refreshed.tokenExpiresAt || null,
    };
  }
}

module.exports = {
  OpenNoteHttpError,
  createOpenNoteJournal,
  fetchOpenNoteAccount,
  updateOpenNoteJournal,
  withOpenNoteTokenRefresh,
};
