'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../opennote/config', () => ({
  parseOpenNoteConfig: jest.fn(() => ({})),
  validateOpenNoteConfig: jest.fn(() => ({
    clientId: 'cid',
    clientSecret: 'secret',
    authorizationUrl: 'https://opennote.example/auth',
    tokenUrl: 'https://opennote.example/token',
    oauthRedirectUri: 'https://api.example.com/api/opennote/oauth/callback',
    apiBaseUrl: 'https://opennote.example/api',
    userInfoUrl: 'https://opennote.example/api/me',
    journalCreatePath: '/journals',
    journalUpdateTemplate: '/journals/{id}',
    scopes: 'journals.write',
    oauthStateTtlSeconds: 900,
  })),
  buildFrontendReturnUrl: jest.fn(() => '/?view=results'),
}));

jest.mock('../../opennote/crypto', () => ({
  decryptString: jest.fn((value) => (value === 'enc_access' ? 'access-token' : 'refresh-token')),
  encryptString: jest.fn((value) => `enc_${value}`),
}));

jest.mock('../../opennote/client', () => ({
  createOpenNoteJournal: jest.fn(async () => ({ journalId: 'journal-1', journalUrl: 'https://opennote/journal-1' })),
  updateOpenNoteJournal: jest.fn(async () => ({ journalId: 'journal-1', journalUrl: 'https://opennote/journal-1' })),
  fetchOpenNoteAccount: jest.fn(),
  withOpenNoteTokenRefresh: jest.fn(async ({ accessToken, operation }) => {
    const result = await operation(accessToken);
    return { result, accessToken };
  }),
}));

jest.mock('../../opennote/oauth', () => ({
  createOauthState: jest.fn(),
  consumeOauthState: jest.fn(),
  exchangeAuthorizationCode: jest.fn(),
}));

jest.mock('../../opennote/enrichment', () => ({
  enrichEventLocation: jest.fn(async () => ({
    city: 'San Francisco',
    state: 'California',
    country: 'United States',
    latitude: 37.77,
    longitude: -122.41,
  })),
  inferSchool: jest.fn(() => 'University of California, Irvine'),
  buildVenueFallback: jest.fn(() => 'San Francisco, California, United States'),
  normalizeText: jest.requireActual('../../opennote/enrichment').normalizeText,
}));

jest.mock('../../opennote/linkBuilder', () => ({
  buildTravelLinks: jest.fn(() => ({
    googleFlightsLink: 'https://flights',
    hotelSearchLink: 'https://hotels',
    uberLink: 'https://uber',
  })),
}));

jest.mock('../../opennote/journalBuilder', () => ({
  buildOpenNoteJournalPayload: jest.fn(() => ({ title: 'Hack', content_markdown: '# Hack', metadata: {} })),
  hashJournalPayload: jest.fn(() => 'payload-hash'),
}));

const db = require('../../db');
const opennoteRouter = require('../opennote');
const {
  createOpenNoteJournal,
  updateOpenNoteJournal,
} = require('../../opennote/client');

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
  };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  res.send = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  res.redirect = jest.fn((location) => {
    res.redirectLocation = location;
    return res;
  });
  return res;
}

describe('opennote route handlers', () => {
  const { handleExportHackathon } = opennoteRouter._private;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects unauthenticated export attempts', async () => {
    const req = { auth: null, body: { result: { event: { id: 1 } } } };
    const res = mockRes();

    await handleExportHackathon(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({ error: 'Authentication required.' });
  });

  test('rejects export when opennote is not connected', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM app_user_opennote_connections')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const req = {
      auth: { user_id: 7 },
      body: { result: { event: { id: 99, name: 'Hack', start_datetime_utc: '2026-04-10T00:00:00Z' } } },
    };
    const res = mockRes();

    await handleExportHackathon(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'OpenNote account is not connected.' });
  });

  test('creates then updates journal for duplicate exports', async () => {
    const baseConnectionRow = {
      app_user_id: 7,
      opennote_account_id: 'acct-1',
      access_token_encrypted: 'enc_access',
      refresh_token_encrypted: 'enc_refresh',
    };

    let exportExists = false;
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM app_user_opennote_connections')) {
        return { rowCount: 1, rows: [baseConnectionRow] };
      }
      if (sql.includes('FROM app_user_opennote_exports')) {
        if (!exportExists) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            app_user_id: 7,
            event_id: String(params[1]),
            opennote_journal_id: 'journal-1',
            opennote_journal_url: 'https://opennote/journal-1',
          }],
        };
      }
      if (sql.includes('INSERT INTO app_user_opennote_exports')) {
        exportExists = true;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });

    const req = {
      auth: { user_id: 7 },
      body: {
        result: {
          event: {
            id: 1001,
            name: 'Hack SF',
            start_datetime_utc: '2026-04-10T00:00:00Z',
            end_datetime_utc: '2026-04-12T00:00:00Z',
            url: 'https://example.com',
          },
          route: {
            origin_airport: 'LAX',
            destination_airport: 'SFO',
          },
          cost_estimate: {
            estimated_total_cost: 500,
          },
        },
      },
    };

    const createRes = mockRes();
    await handleExportHackathon(req, createRes);

    expect(createOpenNoteJournal).toHaveBeenCalledTimes(1);
    expect(updateOpenNoteJournal).toHaveBeenCalledTimes(0);
    expect(createRes.status).toHaveBeenCalledWith(201);
    expect(createRes.body.status).toBe('created');

    const updateRes = mockRes();
    await handleExportHackathon(req, updateRes);

    expect(updateOpenNoteJournal).toHaveBeenCalledTimes(1);
    expect(updateRes.status).toHaveBeenCalledWith(201);
    expect(updateRes.body.status).toBe('updated');
  });
});
