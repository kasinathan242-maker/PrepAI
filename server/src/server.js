const express = require('express');
// Must load before any router: forwards async handler errors to the error handler
const { statusFor } = require('./middleware/asyncErrors');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');
dotenv.config();
const appConfig = require('./config/env');
const connectDB = require('./config/db');
const { seedDatabase } = require('./seeds/seedData');
const User = require('./models/User');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Request id on every request/response (spec §21) — also used in audit logs
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Baseline security headers for frontend SPA and API
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  } else {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-ancestors 'none'"
    );
  }
  next();
});

// Connect to MongoDB
connectDB().then(async () => {
  // Background workers (report generation, answer evaluation, reference packs)
  require('./services/interviewService').registerJobHandlers();
  require('./services/reportService').registerJobHandlers();
  require('./services/aptitudeService').registerJobHandlers();
  // Camera images from interviews that were never ended are deleted after 24 hours
  require('./services/visionService').purgeStaleFrames().catch(err => console.warn('[vision] purge failed:', err.message));
  require('./services/jobQueue').registerHandler('benchmark.run', payload => require('./services/benchmarkService').runBenchmark(payload));
  await require('./services/jobQueue').start();

  // Check if admin user exists, if not seed database
  try {
    const admin = await User.findOne({ email: 'admin@prep.ai' });
    if (!admin) {
      console.log('[Server] Seeding initial MongoDB data...');
      await seedDatabase();
    }
  } catch (err) {
    console.warn('[Server] Auto-seed check failed:', err.message);
  }
});

// Middleware
// Only the configured desktop web origins may call the API from a browser (spec §24)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || appConfig.corsOrigins.includes(origin) || appConfig.corsOrigins.includes('*')) return cb(null, true);
    try {
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.onrender.com') || hostname === 'localhost' || hostname === '127.0.0.1') return cb(null, true);
    } catch { /* ignore invalid url */ }
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  // Lets the browser read the download filename of exported reports
  exposedHeaders: ['Content-Disposition', 'X-Request-Id']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// NoSQL operator injection guard: request data may never contain MongoDB operators ($ne, $gt, …).
// No PrepAI request legitimately sends them. (Dotted keys are allowed: skill names like "Node.js".)
function hasOperatorKey(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  return Object.keys(value).some(k => k.startsWith('$') || hasOperatorKey(value[k], depth + 1));
}
app.use((req, res, next) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query) || hasOperatorKey(req.params)) {
    return res.status(400).json({ detail: 'Invalid request data.', request_id: req.requestId });
  }
  next();
});
app.use(morgan('dev'));

// Token Bucket Rate Limiting
const { apiLimiter } = require('./middleware/rateLimiter');
app.use('/api/v1', apiLimiter);

// Mount API Routes under /api/v1
app.use('/api/v1/health', require('./routes/health'));
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/users', require('./routes/users'));
app.use('/api/v1/intelligence', require('./routes/intelligence'));
app.use('/api/v1/aptitude', require('./routes/aptitude'));
app.use('/api/v1/interview', require('./routes/interview'));
app.use('/api/v1/interviews', require('./routes/interview'));
app.use('/api/v1/voice', require('./routes/voice'));
app.use('/api/v1/resumes', require('./routes/resumes'));
app.use('/api/v1/resume', require('./routes/resumes'));
app.use('/api/v1/admin', require('./routes/admin'));

// Spec §21 routes (profile, mastery, study plan, dashboard, evaluations, notifications, admin drill-down)
app.use('/api/v1', require('./routes/spec'));
// Internal AI routes (staff only)
app.use('/api/v1/internal', require('./routes/internal'));
// Aptitude spec paths (/aptitude/sessions/...)
app.use('/api/v1/aptitude/sessions', require('./routes/aptitude'));

// Direct aliases for roles, companies, and skill-gap
app.use('/api/v1', require('./routes/intelligence'));

// Serve frontend build if dist exists, or fallback API JSON
const fs = require('fs');
const distPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Fallback Root Route
  app.get('/', (req, res) => {
    res.json({
      name: 'PrepAI API Server',
      stack: 'MERN (MongoDB, Express, React, Node.js)',
      version: '1.0.0',
      status: 'online',
      docs: '/api/v1/health'
    });
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  const status = statusFor(err);
  if (status >= 500) console.error('[Error]:', err.stack);
  if (res.headersSent) return next(err);
  if (status === 400 && (err.name === 'ValidationError' || err.name === 'CastError')) {
    return res.status(400).json({ detail: 'Some of the submitted values are invalid.', request_id: req.requestId });
  }
  // Never leak internal error details from 5xx responses in production
  const detail = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : (err.message || 'Internal Server Error');
  res.status(status).json({ detail, request_id: req.requestId });
});

// Last line of defence: a stray rejection outside a request must be logged, not kill the API
process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
});

const PORT = process.env.PORT || appConfig.port;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`  🚀 PrepAI Server is Live on: http://${HOST}:${PORT}`);
  console.log(`=======================================================`);
});

module.exports = app;
