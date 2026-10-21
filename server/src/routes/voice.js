const express = require('express');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { protect } = require('../middleware/auth');
const InterviewSession = require('../models/InterviewSession');
const {
  NEURAL_VOICES,
  synthesizeSpeechStream,
  synthesizeSpeechBuffer,
  sanitizeTextForSpeech,
  resolveVoice
} = require('../services/ttsService');
const config = require('../config/env');

const router = express.Router();

// Simple in-memory cache for recent speech syntheses to make instant replay 0ms
const speechCache = new Map();
const MAX_CACHE_ENTRIES = 50;

/**
 * GET /api/v1/voice/voices - List available ultra-realistic human voices
 */
router.get('/voices', (req, res) => {
  res.json({
    status: 'success',
    defaultVoice: 'christopher',
    voices: [
      { id: 'christopher', name: 'Christopher (US English, male)', gender: 'Male', accent: 'US', default: true },
      { id: 'guy', name: 'Guy (US English, male)', gender: 'Male', accent: 'US' },
      { id: 'jenny', name: 'Jenny (US English, female)', gender: 'Female', accent: 'US' },
      { id: 'prabhat', name: 'Prabhat (Indian English, male)', gender: 'Male', accent: 'IN' },
      { id: 'neerja', name: 'Neerja (Indian English, female)', gender: 'Female', accent: 'IN' }
    ]
  });
});

/**
 * POST & GET /api/v1/voice/synthesize
 * Ultra-realistic Microsoft Edge Neural TTS audio generator
 * Accepts: { text: string, voice?: string }
 * Returns: audio/mpeg stream
 */
router.all('/synthesize', async (req, res) => {
  try {
    const text = req.body?.text || req.query?.text;
    const voice = resolveVoice(req.body?.voice || req.query?.voice || 'christopher');

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ detail: 'Text parameter is required for speech synthesis' });
    }
    // The endpoint is public (audio elements cannot send auth headers), so cap the work per request
    if (text.length > 1500) {
      return res.status(413).json({ detail: 'Text is too long for speech synthesis (max 1500 characters)' });
    }

    const cleanText = sanitizeTextForSpeech(text);
    if (!cleanText) {
      return res.status(400).json({ detail: 'Sanitized text is empty' });
    }

    const cacheKey = `${voice}:${cleanText}`;
    if (speechCache.has(cacheKey)) {
      const cachedBuffer = speechCache.get(cacheKey);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', cachedBuffer.length);
      res.setHeader('X-Cache', 'HIT');
      return res.send(cachedBuffer);
    }

    // Synthesize buffer
    const audioBuffer = await synthesizeSpeechBuffer(cleanText, voice);

    // Cache entry
    if (speechCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = speechCache.keys().next().value;
      speechCache.delete(firstKey);
    }
    speechCache.set(cacheKey, audioBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('X-Cache', 'MISS');
    return res.send(audioBuffer);
  } catch (err) {
    console.error('[Voice Synthesize Error]:', err);
    // Public endpoint: never expose provider/socket error details to callers
    res.status(500).json({ detail: 'Failed to synthesize neural speech' });
  }
});

// POST /start - Local voice session initialization
router.post('/start', protect, async (req, res) => {
  try {
    const { job_role, company_target, interview_type, persona } = req.body;
    const session = await InterviewSession.create({
      userId: req.user._id,
      jobRole: job_role || 'Software Developer (SDE)',
      companyTarget: company_target || 'Amazon',
      interviewType: interview_type || 'voice',
      persona: persona || 'Technical Lead',
      status: 'in_progress',
      livekitRoomId: `room_${uuidv4().substring(0, 8)}`
    });

    res.status(201).json({
      status: 'success',
      session_id: session._id.toString(),
      sessionId: session._id.toString(),
      engine: 'edge-neural-tts',
      room_id: session.livekitRoomId
    });
  } catch (err) {
    console.error('[Voice Start Error]:', err);
    res.status(500).json({ detail: 'Failed to start voice room' });
  }
});

// GET /config - Local speech configuration
router.get('/config', protect, (req, res) => {
  res.json({
    status: 'success',
    engine: 'edge-neural-tts',
    stt: 'browser-native',
    tts: 'edge-neural-tts',
    defaultVoice: 'en-US-ChristopherNeural',
    llm: config.ai.provider === 'custom' ? 'custom-model' : config.ai.provider
  });
});

// POST /:sessionId/end: same as POST /interviews/:sessionId/end (kept for older clients).
router.post('/:sessionId/end', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sessionId)) {
      return res.status(404).json({ detail: 'Voice session not found' });
    }
    const session = await InterviewSession.findById(req.params.sessionId);
    if (!session || session.userId.toString() !== req.user._id.toString()) {
      return res.status(404).json({ detail: 'Voice session not found' });
    }
    // Ending must go through the interview end flow, which awards XP once and queues the report.
    // Marking the session completed here would leave it with no report and block that flow (409).
    res.redirect(307, `/api/v1/interviews/${session._id}/end`);
  } catch (err) {
    console.error('[Voice End Error]:', err);
    res.status(500).json({ detail: 'Failed to end voice session' });
  }
});

module.exports = router;
