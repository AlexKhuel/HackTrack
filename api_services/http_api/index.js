'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const hackathonsRouter = require('./routes/hackathons');
const adminRouter = require('./routes/admin');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/hackathons', hackathonsRouter);
app.use('/api/events', hackathonsRouter);
app.use('/api/admin', adminRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HTTP API listening on port ${PORT}`);
});

module.exports = app;
