#!/usr/bin/env node
/**
 * Run scrapers + cleaner, then call JS loader to insert into Supabase Postgres.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_BUNDLED_ROUTES_INPUT = path.join(SCRIPT_DIR, 'data', 'routes_weighted_post2020.json');
const DEFAULT_BUNDLED_LODGING_INPUT = path.join(SCRIPT_DIR, 'data', 'lodging_formatted.json');

function timestamp() {
    return new Date().toISOString();
}

function log(message) {
    process.stdout.write(`[${timestamp()}] ${message}\n`);
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
}

function parseOptionalInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
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

function runCommand(cmd, args, cwd, options = {}) {
    const {
        hangWarningSeconds = 60,
        commandTimeoutSeconds = 0,
    } = options;

    return new Promise((resolve, reject) => {
        const commandText = `${cmd} ${args.join(' ')}`;
        const startMs = Date.now();
        let lastOutputMs = Date.now();
        let lastWarningMs = 0;
        let didTimeout = false;
        let exited = false;

        log(`$ ${commandText}`);

        const child = spawn(cmd, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const relay = (chunk, destination) => {
            lastOutputMs = Date.now();
            destination.write(chunk);
        };

        child.stdout.on('data', (chunk) => relay(chunk, process.stdout));
        child.stderr.on('data', (chunk) => relay(chunk, process.stderr));

        let monitor = null;
        if (hangWarningSeconds > 0 || commandTimeoutSeconds > 0) {
            monitor = setInterval(() => {
                const now = Date.now();
                const quietMs = now - lastOutputMs;
                const elapsedMs = now - startMs;

                if (
                    hangWarningSeconds > 0
                    && quietMs >= hangWarningSeconds * 1000
                    && now - lastWarningMs >= hangWarningSeconds * 1000
                ) {
                    log(
                        `No subprocess output for ${Math.floor(quietMs / 1000)}s `
                        + `(elapsed ${formatDuration(elapsedMs)}). Still running...`
                    );
                    lastWarningMs = now;
                }

                if (commandTimeoutSeconds > 0 && elapsedMs >= commandTimeoutSeconds * 1000 && !didTimeout) {
                    didTimeout = true;
                    log(`Command exceeded timeout (${commandTimeoutSeconds}s), sending SIGTERM.`);
                    child.kill('SIGTERM');

                    setTimeout(() => {
                        if (!exited) {
                            log('Subprocess did not exit after SIGTERM, sending SIGKILL.');
                            child.kill('SIGKILL');
                        }
                    }, 10_000).unref();
                }
            }, 5_000);
        }

        const cleanup = () => {
            if (monitor) clearInterval(monitor);
        };

        child.on('error', (error) => {
            cleanup();
            reject(error);
        });

        child.on('close', (code, signal) => {
            cleanup();
            exited = true;
            const duration = formatDuration(Date.now() - startMs);

            if (signal) {
                reject(new Error(`Command terminated by signal ${signal} after ${duration}: ${commandText}`));
                return;
            }
            if (code !== 0) {
                reject(new Error(`Command failed with exit code ${code} after ${duration}: ${commandText}`));
                return;
            }

            log(`Command completed in ${duration}: ${commandText}`);
            resolve();
        });
    });
}

function parseArgs(argv) {
    const args = {
        outputDir: path.join(SCRIPT_DIR, 'output'),
        cleanedOutput: null,
        mlhInput: null,
        devpostInput: null,
        devfolioInput: null,
        skipMlh: false,
        skipDevpost: false,
        skipDevfolio: false,
        mlhNoEnrich: false,
        devpostEnrichMissingPrize: false,
        devpostStatuses: 'open,upcoming',
        mlhMaxEvents: null,
        devpostMaxHackathons: null,
        includeAll: false,
        includeFlights: false,
        flightsInput: null,
        routesInput: null,
        routesTable: 'routes',
        includeHotels: false,
        hotelsInput: null,
        lodgingInput: null,
        lodgingTable: 'lodging',
        table: 'events',
        dbUrl: null,
        batchSize: 500,
        replaceExisting: false,
        dryRun: false,
        hangWarningSeconds: 60,
        commandTimeoutSeconds: 0,
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--output-dir') args.outputDir = argv[++i];
        else if (token === '--cleaned-output') args.cleanedOutput = argv[++i];
        else if (token === '--mlh-input') args.mlhInput = argv[++i];
        else if (token === '--devpost-input') args.devpostInput = argv[++i];
        else if (token === '--devfolio-input') args.devfolioInput = argv[++i];
        else if (token === '--skip-mlh') args.skipMlh = true;
        else if (token === '--skip-devpost') args.skipDevpost = true;
        else if (token === '--skip-devfolio') args.skipDevfolio = true;
        else if (token === '--mlh-no-enrich') args.mlhNoEnrich = true;
        else if (token === '--devpost-enrich-missing-prize') args.devpostEnrichMissingPrize = true;
        else if (token === '--devpost-statuses') args.devpostStatuses = argv[++i];
        else if (token === '--mlh-max-events') args.mlhMaxEvents = parseOptionalInt(argv[++i], null);
        else if (token === '--devpost-max-hackathons') args.devpostMaxHackathons = parseOptionalInt(argv[++i], null);
        else if (token === '--include-all') args.includeAll = true;
        else if (token === '--include-flights') args.includeFlights = true;
        else if (token === '--flights-input') args.flightsInput = argv[++i];
        else if (token === '--routes-input') args.routesInput = argv[++i];
        else if (token === '--routes-table') args.routesTable = argv[++i];
        else if (token === '--include-hotels') args.includeHotels = true;
        else if (token === '--hotels-input') args.hotelsInput = argv[++i];
        else if (token === '--lodging-input') args.lodgingInput = argv[++i];
        else if (token === '--lodging-table') args.lodgingTable = argv[++i];
        else if (token === '--table') args.table = argv[++i];
        else if (token === '--db-url') args.dbUrl = argv[++i];
        else if (token === '--batch-size') args.batchSize = parseOptionalInt(argv[++i], 500);
        else if (token === '--replace-existing') args.replaceExisting = true;
        else if (token === '--dry-run') args.dryRun = true;
        else if (token === '--hang-warning-seconds') args.hangWarningSeconds = parseOptionalInt(argv[++i], 60);
        else if (token === '--command-timeout-seconds') args.commandTimeoutSeconds = parseOptionalInt(argv[++i], 0);
        else if (token === '--help' || token === '-h') {
            log('Usage: node run_pipeline.js [options]');
            log('Run MLH + Devpost + Devfolio scrapers, clean merged data, and load into Supabase Postgres via JS.');
            log('');
            log('Options:');
            log('  --include-all                  Run events + flights + hotels (uses bundled routes/lodging data if no raw inputs)');
            log('  --hang-warning-seconds <n>     Warn if subprocess emits no output for n seconds (default: 60)');
            log('  --command-timeout-seconds <n>  Kill subprocess after n seconds (default: 0 = disabled)');
            process.exit(0);
        }
    }

    if (args.hangWarningSeconds < 0) args.hangWarningSeconds = 0;
    if (args.commandTimeoutSeconds < 0) args.commandTimeoutSeconds = 0;
    if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) args.batchSize = 500;

    return args;
}

async function main(argv) {
    const args = parseArgs(argv);

    loadEnvFile(path.join(REPO_ROOT, '.env'));

    if (args.includeAll) {
        args.includeFlights = true;
        args.includeHotels = true;
        if (!args.routesInput && !args.flightsInput) {
            args.routesInput = DEFAULT_BUNDLED_ROUTES_INPUT;
        }
        if (!args.lodgingInput && !args.hotelsInput) {
            args.lodgingInput = DEFAULT_BUNDLED_LODGING_INPUT;
        }
    }

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

    const commandOptions = {
        hangWarningSeconds: args.hangWarningSeconds,
        commandTimeoutSeconds: args.commandTimeoutSeconds,
    };

    log('Starting data pipeline run.');
    log(`Output directory: ${outputDir}`);
    log(`Hang warning threshold: ${args.hangWarningSeconds}s`);
    if (args.includeAll) {
        log('Include-all mode enabled (events + flights + hotels).');
    }
    if (args.commandTimeoutSeconds > 0) {
        log(`Command timeout: ${args.commandTimeoutSeconds}s`);
    }

    let mlhInput = null;
    let devpostInput = null;
    let devfolioInput = null;

    if (!args.skipMlh) {
        if (args.mlhInput) {
            mlhInput = path.resolve(args.mlhInput);
            log(`Using existing MLH input: ${mlhInput}`);
        } else {
            const mlhOutput = path.join(outputDir, 'mlh_2026_events.json');
            const cmdArgs = [
                path.join(SCRIPT_DIR, 'src', 'scrapers', 'mlh.py'),
                '--output',
                mlhOutput,
            ];
            if (args.mlhNoEnrich) cmdArgs.push('--no-enrich');
            if (args.mlhMaxEvents !== null && !Number.isNaN(args.mlhMaxEvents)) {
                cmdArgs.push('--max-events', String(args.mlhMaxEvents));
            }
            log('Running MLH scraper...');
            await runCommand('python3', cmdArgs, REPO_ROOT, commandOptions);
            mlhInput = mlhOutput;
        }
    } else {
        log('Skipping MLH source (--skip-mlh).');
    }

    if (!args.skipDevpost) {
        if (args.devpostInput) {
            devpostInput = path.resolve(args.devpostInput);
            log(`Using existing Devpost input: ${devpostInput}`);
        } else {
            const devpostOutput = path.join(outputDir, 'devpost_hackathons.json');
            const cmdArgs = [
                path.join(SCRIPT_DIR, 'src', 'scrapers', 'devpost.py'),
                '--output',
                devpostOutput,
                '--statuses',
                args.devpostStatuses,
            ];
            if (args.devpostEnrichMissingPrize) cmdArgs.push('--enrich-missing-prize');
            if (args.devpostMaxHackathons !== null && !Number.isNaN(args.devpostMaxHackathons)) {
                cmdArgs.push('--max-hackathons', String(args.devpostMaxHackathons));
            }
            log('Running Devpost scraper...');
            await runCommand('python3', cmdArgs, REPO_ROOT, commandOptions);
            devpostInput = devpostOutput;
        }
    } else {
        log('Skipping Devpost source (--skip-devpost).');
    }

    if (!args.skipDevfolio) {
        if (args.devfolioInput) {
            devfolioInput = path.resolve(args.devfolioInput);
            log(`Using existing Devfolio input: ${devfolioInput}`);
        } else {
            const devfolioOutput = path.join(outputDir, 'devfolio_hackathons.json');
            const cmdArgs = [
                path.join(SCRIPT_DIR, 'src', 'scrapers', 'devfolio.py'),
                '--output',
                devfolioOutput,
            ];
            log('Running Devfolio scraper...');
            await runCommand('python3', cmdArgs, REPO_ROOT, commandOptions);
            devfolioInput = devfolioOutput;
        }
    } else {
        log('Skipping Devfolio source (--skip-devfolio).');
    }

    const hasEventsSource = mlhInput !== null || devpostInput !== null || devfolioInput !== null;
    if (!hasEventsSource && !args.includeFlights && !args.includeHotels) {
        log('No data sources selected. Use default settings or provide --mlh-input/--devpost-input/--devfolio-input.');
        process.exit(2);
    }

    if (hasEventsSource) {
        log('Cleaning and loading events data...');
        const cleanCmdArgs = [
            path.join(SCRIPT_DIR, 'src', 'formatters', 'events.py'),
            '--output',
            cleanedOutput,
            '--format',
            'json',
        ];
        if (mlhInput) cleanCmdArgs.push('--mlh', mlhInput);
        if (devpostInput) cleanCmdArgs.push('--devpost', devpostInput);
        if (devfolioInput) cleanCmdArgs.push('--devfolio', devfolioInput);

        await runCommand('python3', cleanCmdArgs, REPO_ROOT, commandOptions);

        const loadCmdArgs = [
            path.join(SCRIPT_DIR, 'src', 'loaders', 'events.js'),
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

        await runCommand('node', loadCmdArgs, REPO_ROOT, commandOptions);
        log(`Cleaned events output: ${cleanedOutput}`);
    }

    if (args.includeFlights) {
        let routesInputPath = null;

        if (args.routesInput) {
            routesInputPath = path.resolve(args.routesInput);
            if (!fs.existsSync(routesInputPath)) {
                log(`Routes input file not found: ${routesInputPath}`);
                process.exit(2);
            }
            log(`Using preformatted routes input: ${routesInputPath}`);
        } else {
            if (!args.flightsInput) {
                log('Missing flights data. Provide --routes-input <routes.json> or --flights-input <flights.csv>.');
                process.exit(2);
            }

            const flightsInput = path.resolve(args.flightsInput);
            if (!fs.existsSync(flightsInput)) {
                log(`Flights input file not found: ${flightsInput}`);
                process.exit(2);
            }
            const routesOutput = path.join(outputDir, 'routes_formatted.json');

            log(`Formatting routes from flights input: ${flightsInput}`);
            const formatRoutesArgs = [
                path.join(SCRIPT_DIR, 'src', 'formatters', 'flights.py'),
                '--input', flightsInput,
                '--output', routesOutput,
            ];
            await runCommand('python3', formatRoutesArgs, REPO_ROOT, commandOptions);
            routesInputPath = routesOutput;
            log(`Routes output: ${routesOutput}`);
        }

        const loadRoutesArgs = [
            path.join(SCRIPT_DIR, 'src', 'loaders', 'routes.js'),
            '--input', routesInputPath,
            '--table', args.routesTable,
            '--batch-size', String(args.batchSize),
        ];
        if (args.dbUrl) loadRoutesArgs.push('--db-url', args.dbUrl);
        if (args.replaceExisting) loadRoutesArgs.push('--replace-existing');
        if (args.dryRun) loadRoutesArgs.push('--dry-run');

        await runCommand('node', loadRoutesArgs, REPO_ROOT, commandOptions);
        log(`Routes loaded from: ${routesInputPath}`);
    }

    if (args.includeHotels) {
        let lodgingInputPath = null;

        if (args.lodgingInput) {
            lodgingInputPath = path.resolve(args.lodgingInput);
            if (!fs.existsSync(lodgingInputPath)) {
                log(`Lodging input file not found: ${lodgingInputPath}`);
                process.exit(2);
            }
            log(`Using preformatted lodging input: ${lodgingInputPath}`);
        } else {
            if (!args.hotelsInput) {
                log('Missing lodging data. Provide --lodging-input <lodging.json> or --hotels-input <hotels.csv>.');
                process.exit(2);
            }

            const hotelsInput = path.resolve(args.hotelsInput);
            if (!fs.existsSync(hotelsInput)) {
                log(`Hotels input file not found: ${hotelsInput}`);
                process.exit(2);
            }
            const lodgingOutput = path.join(outputDir, 'lodging_formatted.json');

            log(`Formatting lodging from input: ${hotelsInput}`);
            const formatLodgingArgs = [
                path.join(SCRIPT_DIR, 'src', 'formatters', 'hotels.py'),
                '--input', hotelsInput,
                '--output', lodgingOutput,
            ];
            await runCommand('python3', formatLodgingArgs, REPO_ROOT, commandOptions);
            lodgingInputPath = lodgingOutput;
            log(`Lodging output: ${lodgingOutput}`);
        }

        const loadLodgingArgs = [
            path.join(SCRIPT_DIR, 'src', 'loaders', 'lodging.js'),
            '--input', lodgingInputPath,
            '--table', args.lodgingTable,
            '--batch-size', String(args.batchSize),
        ];
        if (args.dbUrl) loadLodgingArgs.push('--db-url', args.dbUrl);
        if (args.replaceExisting) loadLodgingArgs.push('--replace-existing');
        if (args.dryRun) loadLodgingArgs.push('--dry-run');

        await runCommand('node', loadLodgingArgs, REPO_ROOT, commandOptions);
        log(`Lodging loaded from: ${lodgingInputPath}`);
    }

    log('Data pipeline run completed successfully.');
}

main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
