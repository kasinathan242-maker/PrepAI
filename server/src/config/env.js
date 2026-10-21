/**
 * Central configuration. Every provider, model id, TTL and service URL is read here so
 * business logic never hardcodes a model name (spec §7.3, §31).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const list = (v, d) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() !== 'false');

const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'development';
const DEFAULT_DEV_SECRET = 'prepai_jwt_secret_key_2026_super_secure';

const config = {
  appEnv: APP_ENV,
  isProduction: APP_ENV === 'production',
  port: num(process.env.PORT, 7857),
  mongoUri: process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/prepai',
  corsOrigins: list(process.env.CORS_ORIGINS || process.env.APP_URL, [
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]),

  auth: {
    jwtSecret: process.env.JWT_SECRET || DEFAULT_DEV_SECRET,
    accessTtlMinutes: num(process.env.JWT_ACCESS_TTL_MINUTES, 15),
    refreshTtlDays: num(process.env.JWT_REFRESH_TTL_DAYS, 30)
  },

  ai: {
    // Strictly Custom & Open-Source Hugging Face Models
    provider: (process.env.AI_PROVIDER || 'custom').toLowerCase(),
    model: process.env.CUSTOM_MODEL || process.env.AI_MODEL || 'Qwen/Qwen2.5-Coder-7B-Instruct',
    evaluationModel: process.env.CUSTOM_EVALUATION_MODEL || process.env.EVALUATION_MODEL || process.env.CUSTOM_MODEL || 'Qwen/Qwen2.5-Coder-7B-Instruct',
    visionModel: process.env.CUSTOM_VISION_MODEL || process.env.VISION_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct',
    fallbackProvider: null, // Strictly custom models only (no proprietary cloud providers)
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 90000),
    customBaseUrl: (process.env.CUSTOM_MODEL_URL || process.env.CUSTOM_BASE_URL || process.env.HF_BASE_URL || 'https://router.huggingface.co/hf-inference/v1').replace(/\/$/, ''),
    customApiKey: process.env.CUSTOM_API_KEY || process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || '',
    customModel: process.env.CUSTOM_MODEL || process.env.AI_MODEL || 'Qwen/Qwen2.5-Coder-7B-Instruct',
    customVisionModel: process.env.CUSTOM_VISION_MODEL || process.env.VISION_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct',
    customVisionUrl: (process.env.CUSTOM_VISION_URL || process.env.CUSTOM_MODEL_URL || process.env.CUSTOM_BASE_URL || process.env.HF_BASE_URL || 'https://router.huggingface.co/hf-inference/v1').replace(/\/$/, ''),
    ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
  },

  embeddings: {
    provider: 'custom',
    model: process.env.CUSTOM_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5',
    customBaseUrl: (process.env.CUSTOM_EMBEDDING_URL || process.env.CUSTOM_MODEL_URL || process.env.CUSTOM_BASE_URL || process.env.HF_BASE_URL || 'https://router.huggingface.co/hf-inference/v1').replace(/\/$/, '')
  },

  laya: {
    enabled: bool(process.env.LAYA_ENABLED, false), // Disabled by default for pure cloud custom models (no local daemons)
    model: process.env.LAYA_MODEL || 'convaiinnovations/laya',
    serviceUrl: (process.env.LAYA_SERVICE_URL || 'http://127.0.0.1:7860').replace(/\/$/, ''),
    // Laya runs on CPU here (~4 s per decision batch); keep the budget realistic
    timeoutMs: num(process.env.LAYA_TIMEOUT_MS, 30000),
    // Short budget used on the live interview turn path; on timeout the signal is recorded as unavailable
    turnTimeoutMs: num(process.env.LAYA_TURN_TIMEOUT_MS, 7000)
  },

  voice: {
    sttProvider: process.env.STT_PROVIDER || 'browser',
    sttModel: process.env.STT_MODEL || null,
    ttsProvider: process.env.TTS_PROVIDER || 'edge',
    ttsModel: process.env.TTS_MODEL || null
  },

  evaluation: {
    version: 'eval-v4',
    // Spec §9.1 default weights
    weights: {
      correctness: 0.25,
      relevance: 0.15,
      technicalDepth: 0.15,
      completeness: 0.15,
      reasoning: 0.10,
      clarity: 0.10,
      communication: 0.10
    }
  }
};

// Refuse to boot a production build with the development signing key
if (config.isProduction && config.auth.jwtSecret === DEFAULT_DEV_SECRET) {
  throw new Error('JWT_SECRET must be set to a private value in production');
}

module.exports = config;
