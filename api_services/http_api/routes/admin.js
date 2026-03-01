'use strict';

const express = require('express');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();

/**
 * Check simple authorization token to protect the admin endpoints.
 */
function checkAuth(req, res, next) {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
        console.warn('ADMIN_API_KEY is not set. Admin endpoints are disabled.');
        return res.status(503).json({ error: 'Admin endpoints not configured (Missing API key).' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== adminKey) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    next();
}

/**
 * POST /api/admin/sync-events
 * Triggers the ETL orchestrator asynchronously to re-scrape events.
 */
router.post('/sync-events', checkAuth, (req, res) => {
    console.log('Admin triggered an asynchronous event data sync.');

    // The actual ETL orchestrator is in the etl_pipeline/ folder at the repo root.
    const repoRoot = path.resolve(__dirname, '../../../');
    const pipelineScript = path.resolve(repoRoot, 'etl_pipeline/run_pipeline.js');

    if (!fs.existsSync(pipelineScript)) {
        console.error(`Pipeline script not found at expected path: ${pipelineScript}`);
        return res.status(500).json({ error: 'Pipeline script path is misconfigured.' });
    }

    const args = [
        pipelineScript,
        '--include-all',
        // Keep events/routes/lodging refreshed together to avoid cross-table drift.
    ];

    const child = spawn('node', args, {
        cwd: repoRoot,
        stdio: 'inherit',
        detached: true // Let it run independently of the API request lifecycle.
    });

    child.on('error', (err) => {
        console.error('Failed to start data pipeline subprocess:', err);
    });

    // Unref so the Node process can exit if it wants to (won't hang the parent event loop).
    child.unref();

    return res.status(202).json({
        status: 'accepted',
        message: 'ETL pipeline synchronization started in the background.'
    });
});

module.exports = router;
