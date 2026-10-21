/**
 * Interview routes (spec §21 Interviews). Mounted at /api/v1/interviews and /api/v1/interview.
 */
const express = require('express');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const { protect } = require('../middleware/auth');
const { aiLimiter, reportLimiter } = require('../middleware/rateLimiter');
const InterviewSession = require('../models/InterviewSession');
const InterviewTurn = require('../models/InterviewTurn');
const InterviewReport = require('../models/InterviewReport');
const AnswerEvaluation = require('../models/AnswerEvaluation');
const { startInterview, answerTurn, InterviewError } = require('../services/interviewService');
const { requestReport, ensureImprovementAnalysis } = require('../services/reportService');
const sm = require('../services/interviewStateMachine');
const { recordPractice } = require('../services/gamification');
const jobQueue = require('../services/jobQueue');
const config = require('../config/env');
const { providerFactory } = require('../services/providers/AIProviderFactory');
const vision = require('../services/visionService');
const InterviewFrame = require('../models/InterviewFrame');

const router = express.Router();
const STAFF_ROLES = ['admin', 'placement_officer', 'recruiter'];

function canAccessSession(session, user) {
  if (!session || !user) return false;
  if (STAFF_ROLES.includes(user.role)) return true;
  return session.userId && session.userId.toString() === user._id.toString();
}

// 'latest' means the caller's own most recent session; any other id must belong to the caller (or staff).
async function findSession(sid, user) {
  if (!sid || !user) return null;
  let session = null;
  if (sid === 'latest' || sid === 'recent') {
    // Prefer the newest finished interview: an in-progress one has no report to show yet
    session = await InterviewSession.findOne({ userId: user._id, endedAt: { $ne: null } }).sort({ endedAt: -1 })
      || await InterviewSession.findOne({ userId: user._id }).sort({ createdAt: -1 });
  } else if (mongoose.isValidObjectId(sid)) {
    session = await InterviewSession.findById(sid);
  }
  return canAccessSession(session, user) ? session : null;
}

function computeDurationSeconds(session) {
  if (session.durationSeconds) return session.durationSeconds;
  const start = session.startedAt || session.createdAt;
  const end = session.endedAt || new Date();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

function sendError(res, err, fallback) {
  if (err instanceof InterviewError) return res.status(err.status).json({ detail: err.message });
  if (err && err.code === 'AI_UNAVAILABLE') {
    // Report specific connectivity or model issues
    const down = /ECONNREFUSED|fetch failed|connect|socket hang up|ENOTFOUND/i.test(String(err.message || ''));
    return res.status(503).json({
      detail: down
        ? 'The AI model server is unreachable. Please verify your custom model endpoint is active and try again.'
        : 'The AI interviewer is temporarily unavailable. Please send your answer again.',
      code: down ? 'AI_SERVER_DOWN' : 'AI_UNAVAILABLE'
    });
  }
  console.error(fallback, err);
  return res.status(500).json({ detail: fallback });
}

function sessionPayload(session) {
  const ui = sm.uiPhaseIndex(session.currentPhaseId || 'INTRODUCTION');
  return {
    id: session._id.toString(),
    sessionId: session._id.toString(),
    jobRole: session.jobRole,
    companyTarget: session.companyTarget,
    interviewType: session.interviewType,
    persona: session.persona,
    status: session.status,
    reportStatus: session.reportStatus,
    currentPhase: (sm.PHASES[session.currentPhaseId] || sm.PHASES.INTRODUCTION).name,
    currentPhaseId: session.currentPhaseId,
    currentPhaseIndex: ui,
    finished: Boolean(session.cursor && session.cursor.finished),
    startedAt: session.startedAt || session.createdAt,
    endedAt: session.endedAt,
    durationSeconds: computeDurationSeconds(session),
    transcript: (session.transcript || []).map((t, idx) => ({
      id: `msg-${idx}`,
      speaker: (t.role === 'assistant' || t.speaker === 'ai') ? 'ai' : 'student',
      role: t.role,
      text: t.content || t.text,
      content: t.content || t.text,
      timestamp: t.timestamp || session.createdAt
    })),
    resumeContext: session.resumeContext
  };
}

// POST /start and POST / — create a session (spec: POST /interviews)
/**
 * The greeting needs no model, so without this check an interview would start and only fail on the
 * first answer. Refuse to start (with the exact fix) when no generation provider is usable.
 */
async function aiReadiness() {
  const providers = [providerFactory.getDefaultProvider(), providerFactory.getFallbackProvider()].filter(Boolean);
  let last = null;
  for (const p of providers) {
    const h = await p.healthCheck().catch(err => ({ healthy: false, error: err.message }));
    if (h.healthy) return { ok: true };
    last = { provider: p, health: h };
  }
  const h = last ? last.health : {};
  if (h.error) {
    return { ok: false, detail: 'The AI model server is unreachable. Please ensure your custom model endpoint is running and try again.' };
  }
  return { ok: false, detail: `The interview model "${h.activeModel || config.ai.model}" is not responding. Please check your model endpoint configuration.` };
}

router.post(['/start', '/'], protect, aiLimiter, async (req, res) => {
  try {
    const ready = await aiReadiness();
    if (!ready.ok) return res.status(503).json({ detail: ready.detail, code: 'AI_SERVER_DOWN' });
    const { session, turn } = await startInterview(req.user, {
      jobRole: req.body.jobRole || req.body.job_role,
      companyTarget: req.body.companyTarget || req.body.company_target,
      interviewType: req.body.interviewType || req.body.interview_type,
      persona: req.body.persona
    });
    res.status(201).json({
      ...sessionPayload(session),
      totalQuestionsPlanned: session.plan.reduce((n, p) => n + p.questions, 0),
      greeting: turn.question,
      transcript: [{ id: 'msg-0', speaker: 'ai', role: 'assistant', text: turn.question, content: turn.question, timestamp: turn.askedAt }]
    });
  } catch (err) {
    sendError(res, err, 'Failed to start interview session');
  }
});

// GET / — the caller's interviews (spec: GET /interviews)
router.get(['/', '/history'], protect, async (req, res) => {
  try {
    const list = await InterviewSession.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.json(list.map(s => ({
      sessionId: s._id.toString(),
      jobRole: s.jobRole,
      companyTarget: s.companyTarget,
      interviewType: s.interviewType,
      status: s.status,
      reportStatus: s.reportStatus,
      overallScore: typeof s.overallScore === 'number' ? Math.round(s.overallScore > 0 && s.overallScore <= 10 ? s.overallScore * 10 : s.overallScore) : null,
      durationSeconds: computeDurationSeconds(s),
      createdAt: s.createdAt
    })));
  } catch (err) {
    sendError(res, err, 'Failed to fetch interview history');
  }
});

// POST /:id/answer (spec) and legacy /:id/dialogue, /:id/chat
router.post(['/:sessionId/answer', '/:sessionId/dialogue', '/:sessionId/chat'], protect, aiLimiter, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview session not found. Please start a new interview.' });
    const answer = req.body.answer || req.body.userTranscript || req.body.message || req.body.candidateMessage || req.body.text || '';
    const out = await answerTurn(session, req.user, answer, req.body.speech || {});
    res.json({ ...out, response: out.aiResponse, reply: out.aiResponse, status: 'active' });
  } catch (err) {
    sendError(res, err, 'Failed to process interview answer');
  }
});

// POST /:id/complete (spec) and legacy /:id/end — ends the interview and queues the report
router.post(['/:sessionId/complete', '/:sessionId/end'], protect, reportLimiter, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview session not found' });

    let xpEarned = 0;
    if (!session.endedAt) {
      session.endedAt = new Date();
      session.durationSeconds = computeDurationSeconds(session);
    }
    const answered = await InterviewTurn.countDocuments({ sessionId: session._id, answer: { $ne: null } });
    // XP only for a real practice session (at least one answer), awarded once
    // The flag is claimed atomically so two quick End clicks cannot both award XP
    const claimed = !session.xpAwarded && answered > 0 &&
      (await InterviewSession.updateOne({ _id: session._id, xpAwarded: { $ne: true } }, { $set: { xpAwarded: true } })).modifiedCount === 1;
    if (claimed) {
      xpEarned = 50;
      recordPractice(req.user, xpEarned);
      await req.user.save();
      session.xpAwarded = true;
    }
    if (!['processing', 'ready', 'partial'].includes(session.reportStatus)) {
      await requestReport(session);
    } else {
      await session.save();
    }
    res.json({
      sessionId: session._id.toString(),
      status: session.status,
      reportStatus: session.reportStatus,
      processingStatus: session.reportStatus === 'ready' ? 'ready' : 'processing',
      durationSeconds: session.durationSeconds,
      questionCount: answered,
      reportId: session._id.toString(),
      xpEarned
    });
  } catch (err) {
    sendError(res, err, 'Failed to end interview');
  }
});

// GET /:id/progress — report generation progress for the end screen
// POST /:id/frames — one webcam frame for the camera tutor ({ dataUrl, offsetSec })
router.post('/:sessionId/frames', protect, async (req, res) => {
  const session = await findSession(req.params.sessionId, req.user);
  if (!session || String(session.userId) !== String(req.user._id)) return res.status(404).json({ detail: 'Interview session not found' });
  if (session.endedAt || session.status === 'completed' || session.status === 'processing_report') {
    return res.status(409).json({ detail: 'The interview has ended; no more frames are accepted.' });
  }
  const dataUrl = typeof req.body.dataUrl === 'string' ? req.body.dataUrl : '';
  const match = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ detail: 'A JPEG frame (data:image/jpeg;base64,...) is required.' });
  const image = Buffer.from(match[1], 'base64');
  // JPEG files start with FF D8 FF
  if (image.length < 100 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
    return res.status(400).json({ detail: 'The frame is not a valid JPEG image.' });
  }
  if (image.length > vision.MAX_FRAME_BYTES) return res.status(413).json({ detail: 'Frame is too large (max 300 KB).' });
  const count = await InterviewFrame.countDocuments({ sessionId: session._id });
  if (count >= vision.MAX_FRAMES_PER_SESSION) {
    return res.status(429).json({ detail: 'Frame limit reached for this interview.' });
  }
  const offsetSec = Number(req.body.offsetSec);
  await InterviewFrame.create({
    sessionId: session._id,
    userId: req.user._id,
    seq: count + 1,
    offsetSec: Number.isFinite(offsetSec) && offsetSec >= 0 ? Math.round(offsetSec) : Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000),
    image
  });
  res.status(201).json({ stored: true, frames: count + 1 });
});

router.get('/:sessionId/progress', protect, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview session not found' });
    const turns = await InterviewTurn.find({ sessionId: session._id, answer: { $ne: null }, phase: { $ne: 'FINAL' } }, { evaluationStatus: 1 });
    const done = turns.filter(t => ['completed', 'insufficient', 'failed'].includes(t.evaluationStatus)).length;
    res.json({
      sessionId: session._id.toString(),
      reportStatus: session.reportStatus,
      reportError: session.reportError,
      answersEvaluated: done,
      answersTotal: turns.length,
      durationSeconds: computeDurationSeconds(session)
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch progress');
  }
});

async function ensureShareToken(session) {
  if (!session.shareToken) {
    session.shareToken = crypto.randomBytes(16).toString('hex');
    await session.save();
  }
  return session.shareToken;
}

async function reportResponse(session, res, { includeShareToken }) {
  let report = await InterviewReport.findOne({ sessionId: session._id });
  if (report && report.status !== 'failed') report = await ensureImprovementAnalysis(report);
  if (!report) {
    if (session.reportStatus === 'none' && (session.status === 'completed' || session.endedAt)) {
      await requestReport(session); // legacy sessions completed before reports were persisted
    }
    return res.status(202).json({ status: 'processing', detail: 'The report is being generated.', reportStatus: session.reportStatus });
  }
  if (report.status === 'failed') {
    return res.status(503).json({ status: 'failed', detail: session.reportError || 'The evaluation model was unavailable. Retry the report.' });
  }
  const payload = { ...report.payload };
  if (includeShareToken) payload.shareToken = await ensureShareToken(session);
  else delete payload.shareToken;
  return res.json(payload);
}

// GET /shared/:token/report — public read-only view chosen by the owner
router.get('/shared/:token/report', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).json({ detail: 'Shared report not found' });
    const session = await InterviewSession.findOne({ shareToken: token });
    if (!session) return res.status(404).json({ detail: 'Shared report not found' });
    return reportResponse(session, res, { includeShareToken: false });
  } catch (err) {
    sendError(res, err, 'Failed to fetch shared report');
  }
});

// GET /:id/report
router.get('/:sessionId/report', protect, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview report not found' });
    return reportResponse(session, res, { includeShareToken: true });
  } catch (err) {
    sendError(res, err, 'Failed to fetch interview report');
  }
});

// POST /:id/report/retry — regenerate after a failure
router.post('/:sessionId/report/retry', protect, reportLimiter, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview session not found' });
    await InterviewReport.deleteOne({ sessionId: session._id });
    await InterviewTurn.updateMany({ sessionId: session._id, evaluationStatus: 'failed' }, { $set: { evaluationStatus: 'pending' } });
    await requestReport(session);
    res.status(202).json({ status: 'processing' });
  } catch (err) {
    sendError(res, err, 'Failed to retry report');
  }
});

// GET /:id/report.pdf
router.get('/:sessionId/report.pdf', protect, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview report not found' });
    const report = await InterviewReport.findOne({ sessionId: session._id });
    if (!report || report.status === 'failed') return res.status(409).json({ detail: 'The report is not ready yet.' });
    const r = report.payload;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="prepai_report_${r.sessionId}.pdf"`);
    doc.pipe(res);
    doc.fontSize(20).fillColor('#1e3a8a').text('PrepAI Placement Interview Report');
    doc.moveDown(0.6);
    doc.fontSize(11).fillColor('#475569')
      .text(`Role: ${r.role}   Company: ${r.company || 'Not set'}   Round: ${r.interviewType}`)
      .text(`Date: ${new Date(r.createdAt).toLocaleDateString()}   Duration: ${Math.round(r.durationSeconds / 60)} min   Evaluator: ${r.evaluatorVersion}`);
    doc.moveDown(0.8);
    doc.fontSize(15).fillColor('#0f172a').text(`Overall: ${r.overallScore}/100 (Grade ${r.grade})`);
    if (r.nextRecommendation && r.nextRecommendation.readinessComment) doc.moveDown(0.3).fontSize(10).fillColor('#334155').text(r.nextRecommendation.readinessComment);
    doc.moveDown(0.8);
    doc.fontSize(13).fillColor('#1e293b').text('Dimension scores');
    doc.fontSize(10).fillColor('#475569');
    r.dimensions.forEach(d => doc.text(`• ${d.name} (${d.weightPercentage}%): ${d.score}`));
    doc.moveDown(0.8);
    doc.fontSize(13).fillColor('#1e293b').text('Question-by-question');
    r.questionAnalysis.forEach(q => {
      doc.moveDown(0.4).fontSize(10).fillColor('#0f172a').text(`Q${q.questionNumber} [${q.topic}, ${q.difficulty}] ${q.score}/100, ${q.verdict}${q.reviewRequired ? ' (review required)' : ''}`);
      doc.fontSize(9).fillColor('#475569').text(`Question: ${q.question}`).text(`Answer: ${q.candidateAnswer}`);
      if (q.missingConcepts.length) doc.text(`Missing: ${q.missingConcepts.join(', ')}`);
      if (q.incorrectClaims.length) doc.text(`Incorrect claims: ${q.incorrectClaims.join(' | ')}`);
    });
    if (r.studyPlan && r.studyPlan.items.length) {
      doc.moveDown(0.8).fontSize(13).fillColor('#166534').text('Study plan');
      doc.fontSize(10).fillColor('#14532d');
      r.studyPlan.items.forEach(i => doc.text(`• ${i.topic}: ${i.description}`));
    }
    doc.end();
  } catch (err) {
    if (!res.headersSent) sendError(res, err, 'Failed to generate PDF report');
  }
});

// GET /:id/evaluations — per-answer evaluations with evidence (owner/staff)
router.get('/:sessionId/evaluations', protect, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview session not found' });
    const evals = await AnswerEvaluation.find({ sessionId: session._id }).sort({ createdAt: 1 });
    res.json(evals.map(e => e.toJSON()));
  } catch (err) {
    sendError(res, err, 'Failed to fetch evaluations');
  }
});

// GET /:id
router.get('/:sessionId', protect, async (req, res) => {
  try {
    const session = await findSession(req.params.sessionId, req.user);
    if (!session) return res.status(404).json({ detail: 'Interview session not found' });
    res.json(sessionPayload(session));
  } catch (err) {
    sendError(res, err, 'Failed to fetch interview session');
  }
});

module.exports = router;
module.exports.findSession = findSession;
module.exports.jobQueue = jobQueue;
