const config = require('../config/env');
const InterviewFrame = require('../models/InterviewFrame');
const { renderPrompt } = require('../prompts');
const { parseModelJson } = require('./jsonOutput');
const { recordExecution } = require('./observability');
const { providerFactory } = require('./providers/AIProviderFactory');

const ALLOWED = {
  facing: ['camera', 'screen', 'away', 'unclear'],
  eyeLine: ['camera', 'screen', 'down', 'away', 'unclear'],
  posture: ['upright', 'leaning', 'slouched', 'too-close', 'too-far', 'unclear'],
  framing: ['centered', 'off-center', 'cut-off'],
  lighting: ['good', 'dim', 'backlit'],
  attire: ['formal', 'smart-casual', 'casual', 'not-visible'],
  background: ['clean', 'cluttered', 'distracting']
};
const ACTIVITIES = ['looking at phone', 'reading notes', 'another person visible', 'eating or drinking', 'touching face', 'talking to someone off-camera', 'leaving frame'];
const MAX_FRAMES_PER_SESSION = 90;
const MAX_FRAME_BYTES = 300 * 1024;

const lower = v => String(v || '').trim().toLowerCase();
function normaliseFrameAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { faceVisible: Boolean(raw.faceVisible) };
  for (const [key, values] of Object.entries(ALLOWED)) {
    const v = lower(raw[key]);
    if (!values.includes(v)) return null;
    out[key] = v;
  }
  out.attireNote = typeof raw.attireNote === 'string' ? raw.attireNote.trim().slice(0, 120) : '';
  out.activities = Array.isArray(raw.activities)
    ? Array.from(new Set(raw.activities.map(lower).filter(a => ACTIVITIES.includes(a))))
    : [];
  if (out.eyeLine === 'camera' && out.facing === 'camera') {
    out.activities = out.activities.filter(a => a !== 'reading notes' && a !== 'talking to someone off-camera' && a !== 'looking at phone');
  }
  out.fixes = Array.isArray(raw.fixes)
    ? raw.fixes.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim().replace(/\s+/g, ' ').slice(0, 160)).slice(0, 3)
    : [];
  return out;
}

async function analyseImage(base64, { model = config.ai.visionModel } = {}) {
  const prompt = renderPrompt('vision_frame');
  let lastError = null;
  const isOllama = config.ai.provider === 'ollama';

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      let rawJsonContent = null;
      let usedProvider = config.ai.provider;

      if (!isOllama) {
        // Use custom model provider (or OpenAI-compatible vision endpoint)
        const customProvider = providerFactory.getProvider('custom');
        const visionResult = await customProvider.analyseVision(base64, {
          prompt: prompt.text,
          model,
          maxTokens: 400
        });
        rawJsonContent = visionResult.content;
        usedProvider = 'custom';
      } else {
        // Ollama local endpoint
        const res = await fetch(`${config.ai.ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            format: 'json',
            options: { temperature: 0.1, num_predict: 400 },
            messages: [
              { role: 'system', content: prompt.text },
              { role: 'user', content: 'Analyse this interview webcam frame.', images: [base64] }
            ]
          }),
          signal: AbortSignal.timeout(90000)
        });
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const body = await res.json();
        rawJsonContent = body.message && body.message.content;
        usedProvider = 'ollama';
      }

      const analysis = normaliseFrameAnalysis(parseModelJson(rawJsonContent));
      recordExecution({
        feature: 'vision_frame',
        kind: 'generation',
        provider: usedProvider,
        model,
        latencyMs: Date.now() - started,
        success: Boolean(analysis),
        errorType: analysis ? null : 'invalid_output',
        retries: attempt,
        structuredOutputValid: Boolean(analysis)
      });
      if (analysis) return { analysis, model, promptVersion: prompt.version, latencyMs: Date.now() - started };
      lastError = new Error('Vision model returned output that does not match the schema');
    } catch (err) {
      lastError = err;
      recordExecution({
        feature: 'vision_frame',
        kind: 'generation',
        provider: isOllama ? 'ollama' : 'custom',
        model,
        latencyMs: Date.now() - started,
        success: false,
        errorType: 'provider_error',
        retries: attempt
      });
    }
  }
  throw lastError;
}
async function analyseSessionFrames(sessionId) {
  const frames = await InterviewFrame.find({ sessionId, status: 'pending' }).select('+image').sort({ seq: 1 });
  let analysed = 0;
  for (const frame of frames) {
    if (!frame.image || !frame.image.length) {
      frame.status = 'failed';
      frame.failureReason = 'image missing';
    } else {
      try {
        const out = await analyseImage(frame.image.toString('base64'));
        Object.assign(frame, { status: 'analysed', analysis: out.analysis, model: out.model, promptVersion: out.promptVersion, latencyMs: out.latencyMs, failureReason: null });
        analysed += 1;
      } catch (err) {
        frame.status = 'failed';
        frame.failureReason = String(err.message || err).slice(0, 200);
      }
    }
    frame.image = null;
    await frame.save();
  }
  return { total: frames.length, analysed };
}

const mmss = sec => `${String(Math.floor(Math.max(0, sec) / 60)).padStart(2, '0')}:${String(Math.round(Math.max(0, sec) % 60)).padStart(2, '0')}`;
const mostCommon = values => {
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
};

const ISSUE_TEXT = {
  'eyeLine:down': 'Looking down instead of at the camera',
  'eyeLine:away': 'Looking away from the screen',
  'posture:slouched': 'Slouching',
  'posture:leaning': 'Leaning to one side',
  'posture:too-close': 'Sitting too close to the camera',
  'posture:too-far': 'Sitting too far from the camera',
  'framing:cut-off': 'Face or shoulders cut off by the frame',
  'framing:off-center': 'Not centred in the frame',
  'lighting:dim': 'Face poorly lit',
  'lighting:backlit': 'Light source behind you (face in shadow)',
  'background:distracting': 'Distracting background',
  'background:cluttered': 'Cluttered background',
  'faceVisible:false': 'Face not visible'
};
const FIX_TEXT = {
  'eyeLine:down': 'Raise your screen or camera to eye level and look at the lens when you answer.',
  'eyeLine:away': 'Keep your attention on the interview window; close other apps before you start.',
  'posture:slouched': 'Sit back in the chair with your back straight and shoulders relaxed.',
  'posture:leaning': 'Sit centred and square to the camera.',
  'posture:too-close': 'Move back so your head and shoulders fit in the frame.',
  'posture:too-far': 'Move closer so your face fills about a third of the frame.',
  'framing:cut-off': 'Adjust the camera so your head and shoulders are fully in view.',
  'framing:off-center': 'Centre yourself in the frame.',
  'lighting:dim': 'Add a light in front of you, such as a desk lamp or a window facing you.',
  'lighting:backlit': 'Do not sit with a window or lamp behind you; face the light instead.',
  'background:distracting': 'Use a plain wall behind you or tidy the space in view.',
  'background:cluttered': 'Clear visible clutter from behind you.',
  'faceVisible:false': 'Make sure your face stays visible on camera for the whole interview.',
  'activity:looking at phone': 'Put your phone away and silence it before the interview.',
  'activity:reading notes': 'Avoid reading from notes; interviewers notice the eye movement.',
  'activity:another person visible': 'Interview alone, in a room where no one else is in view.',
  'activity:eating or drinking': 'Do not eat during the interview; a sip of water between answers is fine.',
  'activity:touching face': 'Keep your hands relaxed and away from your face.',
  'activity:talking to someone off-camera': 'Avoid talking to anyone else during the interview.',
  'activity:leaving frame': 'Stay seated and in view until the interview ends.'
};
function buildVisualAudit(frames) {
  const ok = frames.filter(f => f.status === 'analysed' && f.analysis);
  const failed = frames.filter(f => f.status === 'failed').length;
  if (!ok.length) return frames.length ? { framesCaptured: frames.length, framesAnalysed: 0, framesFailed: failed, unavailable: true } : null;
  const n = ok.length;
  const share = (key, value) => ok.filter(f => String(f.analysis[key]) === value).length;

  const attributes = [
    { key: 'eyeLine', label: 'Looking at the camera or screen', good: share('eyeLine', 'camera') + share('eyeLine', 'screen') },
    { key: 'posture', label: 'Sitting upright', good: share('posture', 'upright') },
    { key: 'framing', label: 'Well framed', good: share('framing', 'centered') },
    { key: 'lighting', label: 'Face well lit', good: share('lighting', 'good') },
    { key: 'background', label: 'Clean background', good: share('background', 'clean') }
  ].map(a => ({ ...a, frames: n, percent: Math.round((a.good / n) * 100) }));

  const issueCounts = new Map();
  const timeline = [];
  ok.forEach(f => {
    const a = f.analysis;
    const at = mmss(f.offsetSec || 0);
    const moments = [];
    if (!a.faceVisible) moments.push('faceVisible:false');
    ['eyeLine', 'posture', 'framing', 'lighting', 'background'].forEach(k => { if (ISSUE_TEXT[`${k}:${a[k]}`]) moments.push(`${k}:${a[k]}`); });
    moments.forEach(m => issueCounts.set(m, (issueCounts.get(m) || 0) + 1));
    a.activities.forEach(act => issueCounts.set(`activity:${act}`, (issueCounts.get(`activity:${act}`) || 0) + 1));
    const notes = [...moments.map(m => ISSUE_TEXT[m]), ...a.activities.map(act => act.charAt(0).toUpperCase() + act.slice(1))];
    if (notes.length) timeline.push({ at, offsetSec: f.offsetSec || 0, notes });
  });

  const fixes = [...issueCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .filter(([k]) => FIX_TEXT[k])
    .slice(0, 6)
    .map(([k, count]) => ({ issue: ISSUE_TEXT[k] || (k.startsWith('activity:') ? k.slice(9) : k), fix: FIX_TEXT[k], frames: count, of: n }));

  const [attire, attireFrames] = mostCommon(ok.map(f => f.analysis.attire).filter(a => a !== 'not-visible'));
  const attireNotes = Array.from(new Set(ok.map(f => f.analysis.attireNote).filter(Boolean))).slice(0, 3);
  const attireVerdict = !attire
    ? 'Your clothing was not visible in the frames.'
    : attire === 'formal'
      ? 'Formal attire, appropriate for a placement interview.'
      : attire === 'smart-casual'
        ? 'Smart-casual attire. For campus placements a plain formal shirt is the safer choice.'
        : 'Casual attire. Wear a plain, ironed formal shirt for real interviews.';

  return {
    framesCaptured: frames.length,
    framesAnalysed: n,
    framesFailed: failed,
    attributes,
    attire: { verdict: attireVerdict, style: attire, frames: attireFrames, notes: attireNotes },
    timeline: timeline.slice(0, 40),
    fixes,
    model: ok[0].model
  };
}
function auditSummary(audit) {
  if (!audit || audit.unavailable) return '';
  const best = [...audit.attributes].sort((a, b) => b.percent - a.percent)[0];
  const worst = [...audit.attributes].sort((a, b) => a.percent - b.percent)[0];
  const parts = [`I looked at ${audit.framesAnalysed} frames from your interview.`];
  if (best) parts.push(`Your strongest habit: ${best.label.toLowerCase()} (${best.good} of ${best.frames} frames).`);
  if (worst && worst.percent < 80) parts.push(`Work on this first: ${worst.label.toLowerCase()} was true in only ${worst.good} of ${worst.frames} frames.`);
  parts.push(audit.attire.verdict);
  if (audit.fixes[0]) parts.push(`Most frequent issue: ${audit.fixes[0].issue.toLowerCase()} (${audit.fixes[0].frames} frames). ${audit.fixes[0].fix}`);
  return parts.join(' ');
}
async function purgeStaleFrames(maxAgeMs = 24 * 60 * 60 * 1000) {
  const res = await InterviewFrame.updateMany(
    { status: 'pending', createdAt: { $lt: new Date(Date.now() - maxAgeMs) } },
    { $set: { image: null, status: 'failed', failureReason: 'interview was not ended; image deleted' } }
  );
  return res.modifiedCount || 0;
}

module.exports = {
  purgeStaleFrames,
  ALLOWED,
  ACTIVITIES,
  MAX_FRAMES_PER_SESSION,
  MAX_FRAME_BYTES,
  normaliseFrameAnalysis,
  analyseImage,
  analyseSessionFrames,
  buildVisualAudit,
  auditSummary
};
