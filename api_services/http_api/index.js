'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const { ensureAppSchema } = require('./db');
const hackathonsRouter = require('./routes/hackathons');
const adminRouter = require('./routes/admin');
const authRouter = require('./routes/auth');
const userInputsRouter = require('./routes/userInputs');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/hackathons', hackathonsRouter);
app.use('/api/events', hackathonsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/auth', authRouter);
app.use('/api/user-inputs', userInputsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function startServer() {
  try {
    await ensureAppSchema();
  } catch (err) {
    console.error('[startup] Failed to ensure auth/user schema:', err);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`HTTP API listening on port ${PORT}`);
  });
}

if (require.main === module) {
  void startServer();
}

module.exports = app;
