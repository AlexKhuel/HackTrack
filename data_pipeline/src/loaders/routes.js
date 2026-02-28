#!/usr/bin/env node

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const AIRPORT_CITY_MAP_PATH = path.join(REPO_ROOT, 'data_pipeline', 'data', 'airport_city_map.json');

const DEFAULT_AIRPORT_TO_CITY = Object.freeze({
  ATL: 'Atlanta',
  AUS: 'Austin',
  BNA: 'Nashville',
  BOS: 'Boston',
  BWI: 'Baltimore',
  CLE: 'Cleveland',
  CLT: 'Charlotte',
  CMH: 'Columbus',
  CMI: 'Champaign',
  DCA: 'Washington',
  DEN: 'Denver',
  DFW: 'Dallas',
  DTW: 'Detroit',
  EWR: 'Newark',
  GNV: 'Gainesville',
  IAH: 'Houston',
  ITH: 'Ithaca',
  JFK: 'New York',
  LAS: 'Las Vegas',
  LAX: 'Los Angeles',
  MCI: 'Kansas City',
  MCO: 'Orlando',
  MIA: 'Miami',
  MSP: 'Minneapolis',
  OAK: 'Oakland',
  ORD: 'Chicago',
  PDX: 'Portland',
  PHL: 'Philadelphia',
  PHX: 'Phoenix',
  PIT: 'Pittsburgh',
  RDU: 'Raleigh',
  SAN: 'San Diego',
  SAT: 'San Antonio',
  SEA: 'Seattle',
  SFO: 'San Francisco',
  SJC: 'San Jose',
  SLC: 'Salt Lake City',
  SNA: 'Irvine',
  STL: 'St. Louis',
});

function loadAirportCityMap() {
  const mapping = { ...DEFAULT_AIRPORT_TO_CITY };

  if (!fsSync.existsSync(AIRPORT_CITY_MAP_PATH)) {
    return mapping;
  }

  const normalizeCode = (value) => {
    if (value == null) return null;
    let token = String(value).trim().toUpperCase();
    if (!token) return null;
    if (token.length === 4 && token.startsWith('K') && /^[A-Z]{4}$/.test(token)) {
      token = token.slice(1);
    }
    return /^[A-Z]{3}$/.test(token) ? token : null;
  };

  try {
    const payload = JSON.parse(fsSync.readFileSync(AIRPORT_CITY_MAP_PATH, 'utf8'));
    if (Array.isArray(payload)) {
      for (const row of payload) {
        if (!row || typeof row !== 'object') continue;
        const code = normalizeCode(row.airport_code ?? row.iata ?? row.code);
        const city = typeof row.city === 'string' ? row.city.trim() : '';
        if (code && city && !(code in mapping)) mapping[code] = city;
      }
      return mapping;
    }

    if (payload && typeof payload === 'object') {
      for (const [rawCode, rawCity] of Object.entries(payload)) {
        const code = normalizeCode(rawCode);
        const city = typeof rawCity === 'string' ? rawCity.trim() : '';
        if (code && city && !(code in mapping)) mapping[code] = city;
      }
    }
  } catch (_) {
    // Keep defaults if mapping file cannot be parsed.
  }

  return mapping;
}

const AIRPORT_TO_CITY = Object.freeze(loadAirportCityMap());

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  process.stdout.write(`[${timestamp()}] ${message}\n`);
}

function loadEnvFiles() {
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });
}

function parseArgs(argv) {
  const args = {
    input: null,
    table: process.env.ROUTES_TABLE || 'routes',
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
    throw new Error('Missing required --input <routes.json>');
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

async function readCleanedRows(inputPath) {
  const payload = await fs.readFile(inputPath, 'utf8');
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed)) {
    throw new Error(`Input file is not a JSON array: ${inputPath}`);
  }
  return parsed.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

function normalizeAirportCode(raw) {
  if (raw == null) return null;
  let token = String(raw).trim().toUpperCase();
  if (!token) return null;
  if (token.length === 4 && token.startsWith('K') && /^[A-Z]{4}$/.test(token)) {
    token = token.slice(1);
  }
  if (/^[A-Z]{3}$/.test(token)) return token;
  return null;
}

function normalizeCity(raw) {
  if (raw == null) return null;
  const token = String(raw).trim();
  return token || null;
}

function resolveRouteCity(row) {
  const explicitCity = normalizeCity(row.city);
  if (explicitCity) return explicitCity;
  const originAirport = normalizeAirportCode(row.origin_airport);
  if (!originAirport) return null;
  return AIRPORT_TO_CITY[originAirport] ?? null;
}

function prepareInsertRows(cleanedRows) {
  const rowsToInsert = [];

  for (const row of cleanedRows) {
    const id = row.id ?? null;
    const origin = row.origin_airport ?? null;
    const destination = row.destination_airport ?? null;
    const avgOutboundPrice = row.avg_outbound_price ?? null;
    const avgReturnPrice = row.avg_return_price ?? null;
    const avgOutboundDuration = row.avg_outbound_duration_minutes ?? null;
    const avgReturnDuration = row.avg_return_duration_minutes ?? null;
    const city = resolveRouteCity(row);

    // Extract just the departure_scheduled timestamps for the Supabase array column
    const departureTimes = row.scheduled_flights
      ? row.scheduled_flights.map(f => f.departure_scheduled).filter(Boolean)
      : [];

    if (id === null || origin === null || destination === null) {
      continue;
    }

    rowsToInsert.push([
      id,
      origin,
      destination,
      avgOutboundPrice,
      avgReturnPrice,
      avgOutboundDuration,
      avgReturnDuration,
      departureTimes,
      city,
    ]);
  }

  return { rowsToInsert, skippedInternalDuplicate: 0, skippedExisting: 0 };
}

async function insertBatch(client, table, rows) {
  if (!rows.length) return 0;

  const tableIdent = quoteIdent(table);
  const columns = [
    'id',
    'origin_airport',
    'destination_airport',
    'avg_outbound_price',
    'avg_return_price',
    'avg_outbound_duration_minutes',
    'avg_return_duration_minutes',
    'departure_times',
    'city',
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
      id,
      origin_airport,
      destination_airport,
      avg_outbound_price,
      avg_return_price,
      avg_outbound_duration_minutes,
      avg_return_duration_minutes,
      departure_times,
      city
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      origin_airport = EXCLUDED.origin_airport,
      destination_airport = EXCLUDED.destination_airport,
      avg_outbound_price = EXCLUDED.avg_outbound_price,
      avg_return_price = EXCLUDED.avg_return_price,
      avg_outbound_duration_minutes = EXCLUDED.avg_outbound_duration_minutes,
      avg_return_duration_minutes = EXCLUDED.avg_return_duration_minutes,
      departure_times = EXCLUDED.departure_times,
      city = EXCLUDED.city
  `;

  await client.query(sql, values);
  return rows.length;
}

async function insertRows(client, table, rows, batchSize) {
  let inserted = 0;
  const totalBatches = Math.max(1, Math.ceil(rows.length / batchSize));
  for (let i = 0, batchNumber = 1; i < rows.length; i += batchSize, batchNumber += 1) {
    const chunk = rows.slice(i, i + batchSize);
    log(`Upserting routes batch ${batchNumber}/${totalBatches} (${chunk.length} rows)...`);
    inserted += await insertBatch(client, table, chunk);
  }
  return inserted;
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  log(`Starting routes load: table=${args.table}, batch_size=${args.batchSize}`);

  const inputPath = path.resolve(args.input);
  const table = validateTableName(args.table);
  log(`Reading routes input from ${inputPath}`);
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
  log(`Connecting to database for table '${table}'...`);
  await client.connect();
  log('Database connection established.');

  let inserted = 0;

  try {
    await client.query('BEGIN');

    if (args.replaceExisting) {
      await client.query(`TRUNCATE TABLE ${quoteIdent(table)}`);
      log(`Truncated table '${table}'.`);
    }

    const { rowsToInsert } = prepareInsertRows(cleanedRows);
    log(`Rows prepared for upsert: ${rowsToInsert.length}`);
    inserted = await insertRows(client, table, rowsToInsert, args.batchSize);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  log(
    `Load complete: upserted=${inserted}, total_cleaned=${cleanedRows.length}`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
