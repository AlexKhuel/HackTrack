#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const SPACE_RE = /\s+/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function loadEnvFiles() {
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });
  dotenv.config({ path: path.join(SCRIPT_DIR, '.env'), override: false });
}

function parseArgs(argv) {
  const args = {
    input: null,
    table: process.env.EVENTS_TABLE || 'events',
    dbUrl: null,
    batchSize: 500,
    replaceExisting: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') {
      args.input = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === '--table') {
      args.table = argv[i + 1] || args.table;
      i += 1;
      continue;
    }
    if (token === '--db-url') {
      args.dbUrl = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === '--batch-size') {
      const raw = argv[i + 1];
      i += 1;
      if (raw && Number.isFinite(Number(raw)) && Number(raw) > 0) {
        args.batchSize = Number(raw);
      }
      continue;
    }
    if (token === '--replace-existing') {
      args.replaceExisting = true;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.input) {
    throw new Error('Missing required --input <cleaned_events.json>');
  }

  return args;
}

function validateTableName(table) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return table;
}

function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeNameKey(name) {
  if (!name) return null;
  const text = String(name)
    .replace(SPACE_RE, ' ')
    .trim()
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(NON_ALNUM_RE, ' ')
    .trim();
  if (!text) return null;
  const tokens = text.split(' ').filter((token) => !['the', 'a', 'an'].includes(token));
  return tokens.length ? tokens.join(' ') : null;
}

function normalizeUrlKey(value) {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
    text = `https://${text}`;
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }

  const protocol = parsed.protocol ? parsed.protocol.toLowerCase() : 'https:';
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return null;

  let pathname = parsed.pathname || '/';
  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname !== '/') pathname = pathname.replace(/\/+$/, '');

  return `${protocol}//${host}${pathname}`;
}

function normalizeNameStartKey(name, startDatetimeUtc) {
  const nameKey = normalizeNameKey(name);
  if (!nameKey) return null;
  if (startDatetimeUtc == null) return null;

  const startText = String(startDatetimeUtc).trim();
  if (startText.length < 10) return null;
  const startDate = startText.slice(0, 10);
  return `${nameKey}||${startDate}`;
}

async function readCleanedRows(inputPath) {
  const payload = await fs.readFile(inputPath, 'utf8');
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed)) {
    throw new Error(`Input file is not a JSON array: ${inputPath}`);
  }
  return parsed.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

async function fetchExistingKeys(client, table) {
  const urlKeys = new Set();
  const nameStartKeys = new Set();

  const tableIdent = quoteIdent(table);
  const result = await client.query(`SELECT url, name, start_datetime_utc FROM ${tableIdent}`);

  for (const row of result.rows) {
    const urlKey = normalizeUrlKey(row.url);
    if (urlKey) urlKeys.add(urlKey);

    const nameStartKey = normalizeNameStartKey(row.name, row.start_datetime_utc);
    if (nameStartKey) nameStartKeys.add(nameStartKey);
  }

  return { urlKeys, nameStartKeys };
}

function prepareInsertRows(cleanedRows, existingUrlKeys, existingNameStartKeys) {
  const rowsToInsert = [];
  const seenNewUrl = new Set();
  const seenNewNameStart = new Set();

  let skippedExisting = 0;
  let skippedInternalDuplicate = 0;

  for (const row of cleanedRows) {
    const source = row.source || 'mlh';
    const name = row.name ?? null;
    const city = row.city ?? null;
    const country = row.country ?? null;
    const start = row.start_datetime_utc ?? null;
    const end = row.end_datetime_utc ?? null;
    const inPerson = row.in_person ?? null;
    const prizePool = row.prize_pool ?? null;
    const rowUrl = row.url ?? null;

    const urlKey = normalizeUrlKey(rowUrl);
    const nameStartKey = normalizeNameStartKey(name, start);

    if (urlKey && (existingUrlKeys.has(urlKey) || seenNewUrl.has(urlKey))) {
      if (existingUrlKeys.has(urlKey)) skippedExisting += 1;
      else skippedInternalDuplicate += 1;
      continue;
    }

    if (nameStartKey && (existingNameStartKeys.has(nameStartKey) || seenNewNameStart.has(nameStartKey))) {
      if (existingNameStartKeys.has(nameStartKey)) skippedExisting += 1;
      else skippedInternalDuplicate += 1;
      continue;
    }

    rowsToInsert.push([source, name, city, country, start, end, inPerson, prizePool, rowUrl]);

    if (urlKey) seenNewUrl.add(urlKey);
    if (nameStartKey) seenNewNameStart.add(nameStartKey);
  }

  return { rowsToInsert, skippedExisting, skippedInternalDuplicate };
}

async function insertBatch(client, table, rows) {
  if (!rows.length) return 0;

  const tableIdent = quoteIdent(table);
  const columns = [
    'source',
    'name',
    'city',
    'country',
    'start_datetime_utc',
    'end_datetime_utc',
    'in_person',
    'prize_pool',
    'url',
  ];

  const values = [];
  const placeholders = [];

  for (let i = 0; i < rows.length; i += 1) {
    const offset = i * columns.length;
    const row = rows[i];
    const rowPlaceholders = [];
    for (let j = 0; j < columns.length; j += 1) {
      rowPlaceholders.push(`$${offset + j + 1}`);
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
    values.push(...row);
  }

  const sql = `
    INSERT INTO ${tableIdent} (
      source,
      name,
      city,
      country,
      start_datetime_utc,
      end_datetime_utc,
      in_person,
      prize_pool,
      url
    ) VALUES ${placeholders.join(', ')}
  `;

  await client.query(sql, values);
  return rows.length;
}

async function insertRows(client, table, rows, batchSize) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    inserted += await insertBatch(client, table, chunk);
  }
  return inserted;
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));

  const inputPath = path.resolve(args.input);
  const table = validateTableName(args.table);
  const cleanedRows = await readCleanedRows(inputPath);

  log(`Cleaned rows ready: ${cleanedRows.length}`);

  if (args.dryRun) {
    log('Dry run enabled: skipping database write.');
    return;
  }

  const dbUrl = args.dbUrl || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('Missing DB URL. Set SUPABASE_DB_URL or DATABASE_URL, or pass --db-url.');
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  let inserted = 0;
  let skippedExisting = 0;
  let skippedInternalDuplicate = 0;

  try {
    await client.query('BEGIN');

    if (args.replaceExisting) {
      await client.query(`TRUNCATE TABLE ${quoteIdent(table)}`);
      log(`Truncated table '${table}'.`);
    }

    let existingUrlKeys = new Set();
    let existingNameStartKeys = new Set();
    if (!args.replaceExisting) {
      const existing = await fetchExistingKeys(client, table);
      existingUrlKeys = existing.urlKeys;
      existingNameStartKeys = existing.nameStartKeys;
      log(
        `Existing keys loaded: ${existingUrlKeys.size} urls, ${existingNameStartKeys.size} name+start keys`,
      );
    }

    const prepared = prepareInsertRows(cleanedRows, existingUrlKeys, existingNameStartKeys);
    skippedExisting = prepared.skippedExisting;
    skippedInternalDuplicate = prepared.skippedInternalDuplicate;

    inserted = await insertRows(client, table, prepared.rowsToInsert, args.batchSize);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  log(
    `Load complete: inserted=${inserted}, skipped_existing=${skippedExisting}, ` +
      `skipped_internal_duplicate=${skippedInternalDuplicate}, total_cleaned=${cleanedRows.length}`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
