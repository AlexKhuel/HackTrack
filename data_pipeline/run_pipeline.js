#!/usr/bin/env node
/**
 * Run scrapers + cleaner, then call JS loader to insert into Supabase Postgres.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function log(message) {
    process.stdout.write(`${message}\n`);
}

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const splitIdx = line.indexOf('=');
        const key = line.slice(0, splitIdx).trim();
        let value = line.slice(splitIdx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function runCommand(cmd, args, cwd) {
    log(`$ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`Command failed with exit code ${result.status}`);
    }
}

function parseArgs(argv) {
    const args = {
        outputDir: path.join(SCRIPT_DIR, 'output'),
        cleanedOutput: null,
        mlhInput: null,
        devpostInput: null,
        skipMlh: false,
        skipDevpost: false,
        mlhNoEnrich: false,
        devpostEnrichMissingPrize: false,
        devpostStatuses: 'open,upcoming',
        mlhMaxEvents: null,
        devpostMaxHackathons: null,
        includeFlights: false,
        flightsInput: null,
        routesTable: 'routes',
        includeHotels: false,
        hotelsBookingInput: null,
        hotelsTripadvisorInput: null,
        lodgingTable: 'lodging',
        table: 'events',
        dbUrl: null,
        batchSize: 500,
        replaceExisting: false,
        dryRun: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--output-dir') args.outputDir = argv[++i];
        else if (token === '--cleaned-output') args.cleanedOutput = argv[++i];
        else if (token === '--mlh-input') args.mlhInput = argv[++i];
        else if (token === '--devpost-input') args.devpostInput = argv[++i];
        else if (token === '--skip-mlh') args.skipMlh = true;
        else if (token === '--skip-devpost') args.skipDevpost = true;
        else if (token === '--mlh-no-enrich') args.mlhNoEnrich = true;
        else if (token === '--devpost-enrich-missing-prize') args.devpostEnrichMissingPrize = true;
        else if (token === '--devpost-statuses') args.devpostStatuses = argv[++i];
        else if (token === '--mlh-max-events') args.mlhMaxEvents = parseInt(argv[++i], 10);
        else if (token === '--devpost-max-hackathons') args.devpostMaxHackathons = parseInt(argv[++i], 10);
        else if (token === '--include-flights') args.includeFlights = true;
        else if (token === '--flights-input') args.flightsInput = argv[++i];
        else if (token === '--routes-table') args.routesTable = argv[++i];
        else if (token === '--include-hotels') args.includeHotels = true;
        else if (token === '--hotels-booking-input') args.hotelsBookingInput = argv[++i];
        else if (token === '--hotels-tripadvisor-input') args.hotelsTripadvisorInput = argv[++i];
        else if (token === '--lodging-table') args.lodgingTable = argv[++i];
        else if (token === '--table') args.table = argv[++i];
        else if (token === '--db-url') args.dbUrl = argv[++i];
        else if (token === '--batch-size') args.batchSize = parseInt(argv[++i], 10);
        else if (token === '--replace-existing') args.replaceExisting = true;
        else if (token === '--dry-run') args.dryRun = true;
        else if (token === '--help' || token === '-h') {
            log("Usage: node run_pipeline.js [options]");
            log("Run MLH + Devpost scrapers, clean merged data, and load into Supabase Postgres via JS.");
            process.exit(0);
        }
    }
    return args;
}

function main(argv) {
    const args = parseArgs(argv);

    loadEnvFile(path.join(REPO_ROOT, '.env'));

    if (args.table === 'events' && process.env.EVENTS_TABLE) {
        args.table = process.env.EVENTS_TABLE;
    }
    if (args.routesTable === 'routes' && process.env.ROUTES_TABLE) {
        args.routesTable = process.env.ROUTES_TABLE;
    }
    if (args.lodgingTable === 'lodging' && process.env.LODGING_TABLE) {
        args.lodgingTable = process.env.LODGING_TABLE;
    }

    const outputDir = path.resolve(args.outputDir);
    fs.mkdirSync(outputDir, { recursive: true });

    const cleanedOutput = args.cleanedOutput
        ? path.resolve(args.cleanedOutput)
        : path.join(outputDir, 'cleaned_events.json');

    let mlhInput = null;
    let devpostInput = null;

    if (!args.skipMlh) {
        if (args.mlhInput) {
            mlhInput = path.resolve(args.mlhInput);
        } else {
            const mlhOutput = path.join(outputDir, 'mlh_2026_events.json');
            const cmdArgs = [
                path.join(SCRIPT_DIR, 'scrapers', 'mlh', 'scrape_mlh_2026.py'),
                '--output',
                mlhOutput,
            ];
            if (args.mlhNoEnrich) cmdArgs.push('--no-enrich');
            if (args.mlhMaxEvents !== null && !isNaN(args.mlhMaxEvents)) {
                cmdArgs.push('--max-events', String(args.mlhMaxEvents));
            }
            runCommand('python3', cmdArgs, REPO_ROOT);
            mlhInput = mlhOutput;
        }
    }

    if (!args.skipDevpost) {
        if (args.devpostInput) {
            devpostInput = path.resolve(args.devpostInput);
        } else {
            const devpostOutput = path.join(outputDir, 'devpost_hackathons.json');
            const cmdArgs = [
                path.join(SCRIPT_DIR, 'scrapers', 'devpost', 'scrape_devpost.py'),
                '--output',
                devpostOutput,
                '--statuses',
                args.devpostStatuses,
            ];
            if (args.devpostEnrichMissingPrize) cmdArgs.push('--enrich-missing-prize');
            if (args.devpostMaxHackathons !== null && !isNaN(args.devpostMaxHackathons)) {
                cmdArgs.push('--max-hackathons', String(args.devpostMaxHackathons));
            }
            runCommand('python3', cmdArgs, REPO_ROOT);
            devpostInput = devpostOutput;
        }
    }

    if (mlhInput === null && devpostInput === null && !args.includeFlights && !args.includeHotels) {
        log("No data sources selected. Use default settings or provide --mlh-input/--devpost-input.");
        process.exit(2);
    }

    if (!args.skipMlh || !args.skipDevpost) {
        const cleanCmdArgs = [
            path.join(SCRIPT_DIR, 'formatters', 'events', 'clean_events.py'),
            '--output',
            cleanedOutput,
            '--format',
            'json',
        ];
        if (mlhInput) cleanCmdArgs.push('--mlh', mlhInput);
        if (devpostInput) cleanCmdArgs.push('--devpost', devpostInput);

        runCommand('python3', cleanCmdArgs, REPO_ROOT);

        const loadCmdArgs = [
            path.join(SCRIPT_DIR, 'loaders', 'load_to_supabase.js'),
            '--input',
            cleanedOutput,
            '--table',
            args.table,
            '--batch-size',
            String(args.batchSize),
        ];
        if (args.dbUrl) loadCmdArgs.push('--db-url', args.dbUrl);
        if (args.replaceExisting) loadCmdArgs.push('--replace-existing');
        if (args.dryRun) loadCmdArgs.push('--dry-run');

        runCommand('node', loadCmdArgs, REPO_ROOT);
        log(`Cleaned events output: ${cleanedOutput}`);
    }

    if (args.includeFlights) {
        if (!args.flightsInput) {
            log("Missing --flights-input required for flights pipeline.");
            process.exit(2);
        }
        const flightsInput = path.resolve(args.flightsInput);
        const routesOutput = path.join(outputDir, 'routes_formatted.json');

        const formatRoutesArgs = [
            path.join(SCRIPT_DIR, 'formatters', 'flights', 'format_routes_from_flights.py'),
            '--input', flightsInput,
            '--output', routesOutput
        ];
        runCommand('python3', formatRoutesArgs, REPO_ROOT);

        const loadRoutesArgs = [
            path.join(SCRIPT_DIR, 'loaders', 'load_routes.js'),
            '--input', routesOutput,
            '--table', args.routesTable,
            '--batch-size', String(args.batchSize)
        ];
        if (args.dbUrl) loadRoutesArgs.push('--db-url', args.dbUrl);
        if (args.replaceExisting) loadRoutesArgs.push('--replace-existing');
        if (args.dryRun) loadRoutesArgs.push('--dry-run');

        runCommand('node', loadRoutesArgs, REPO_ROOT);
        log(`Routes output: ${routesOutput}`);
    }

    if (args.includeHotels) {
        if (!args.hotelsBookingInput || !args.hotelsTripadvisorInput) {
            log("Missing --hotels-booking-input or --hotels-tripadvisor-input required for hotels pipeline.");
            process.exit(2);
        }

        const bookingInput = path.resolve(args.hotelsBookingInput);
        const tripadvisorInput = path.resolve(args.hotelsTripadvisorInput);
        const lodgingOutput = path.join(outputDir, 'lodging_formatted.json');

        const formatLodgingArgs = [
            path.join(SCRIPT_DIR, 'formatters', 'hotels', 'format_lodging_from_hotels.py'),
            '--booking', bookingInput,
            '--tripadvisor', tripadvisorInput,
            '--output', lodgingOutput
        ];
        runCommand('python3', formatLodgingArgs, REPO_ROOT);

        const loadLodgingArgs = [
            path.join(SCRIPT_DIR, 'loaders', 'load_lodging.js'),
            '--input', lodgingOutput,
            '--table', args.lodgingTable,
            '--batch-size', String(args.batchSize)
        ];
        if (args.dbUrl) loadLodgingArgs.push('--db-url', args.dbUrl);
        if (args.replaceExisting) loadLodgingArgs.push('--replace-existing');
        if (args.dryRun) loadLodgingArgs.push('--dry-run');

        runCommand('node', loadLodgingArgs, REPO_ROOT);
        log(`Lodging output: ${lodgingOutput}`);
    }
}

try {
    main(process.argv.slice(2));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
