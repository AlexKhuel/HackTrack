'use strict';

const express = require('express');
const { spawn } = require('node:child_process');
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
 * Triggers the data pipeline orchestrator asynchronously to re-scrape MLH & Devpost events.
 */
router.post('/sync-events', checkAuth, (req, res) => {
    console.log('Admin triggered an asynchronous event data sync.');

    // The actual pipeline orchestrator is in the data_pipeline/ folder at the root.
    const pipelineScript = path.resolve(__dirname, '../../../../data_pipeline/run_pipeline.js');

    const args = [
        pipelineScript,
        // By default, this will scrape MLH & Devpost and load them into events.
        // Ensure flights and hotels aren't automatically pulled. (It only does if --include-xyz is passed).
    ];

    const child = spawn('node', args, {
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
        message: 'Data pipeline synchronization started in the background.'
    });
});

module.exports = router;
