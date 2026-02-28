#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

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
    table: process.env.LODGING_TABLE || 'lodging',
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
    throw new Error('Missing required --input <lodging.json>');
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

function prepareInsertRows(cleanedRows) {
  const rowsToInsert = [];

  for (const row of cleanedRows) {
    const city = row.city ?? null;
    const nightlyRate = row.nightly_rate ?? null;

    if (city === null) {
      continue;
    }

    if (row.id !== undefined) {
      rowsToInsert.push([row.id, city, nightlyRate]);
    } else {
      rowsToInsert.push([city, nightlyRate]);
    }
  }

  const hasId = cleanedRows.length > 0 && cleanedRows[0].id !== undefined;
  return { rowsToInsert, hasId, skippedInternalDuplicate: 0, skippedExisting: 0 };
}

async function insertBatch(client, table, rows, hasId) {
  if (!rows.length) return 0;

  const tableIdent = quoteIdent(table);
  const columns = hasId ? ['id', 'city', 'nightly_rate'] : ['city', 'nightly_rate'];

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

  let sql = `
    INSERT INTO ${tableIdent} (
      ${columns.join(',\n      ')}
    ) VALUES ${placeholders.join(', ')}
  `;

  if (hasId) {
    sql += `
    ON CONFLICT (id) DO UPDATE SET
      city = EXCLUDED.city,
      nightly_rate = EXCLUDED.nightly_rate
    `;
  }

  await client.query(sql, values);
  return rows.length;
}

async function insertRows(client, table, rows, hasId, batchSize) {
  let inserted = 0;
  const totalBatches = Math.max(1, Math.ceil(rows.length / batchSize));
  for (let i = 0, batchNumber = 1; i < rows.length; i += batchSize, batchNumber += 1) {
    const chunk = rows.slice(i, i + batchSize);
    log(`Inserting lodging batch ${batchNumber}/${totalBatches} (${chunk.length} rows)...`);
    inserted += await insertBatch(client, table, chunk, hasId);
  }
  return inserted;
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  log(`Starting lodging load: table=${args.table}, batch_size=${args.batchSize}`);

  const inputPath = path.resolve(args.input);
  const table = validateTableName(args.table);
  log(`Reading lodging input from ${inputPath}`);
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

    const { rowsToInsert, hasId } = prepareInsertRows(cleanedRows);
    log(`Rows prepared for insert: ${rowsToInsert.length} (has_id=${hasId})`);
    inserted = await insertRows(client, table, rowsToInsert, hasId, args.batchSize);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  log(
    `Load complete: inserted=${inserted}, total_cleaned=${cleanedRows.length}`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
