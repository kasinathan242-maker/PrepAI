const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { analyseResumeFile, toDiagnosticPayload } = require('../services/resumeService');
const { protect } = require('../middleware/auth');
const Resume = require('../models/Resume');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_RESUME_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname || '');
    if (!isPdf) {
      const err = new Error('Only PDF resumes are supported');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  }
});

// Same interface as multer's .any(), but upload errors become 400 responses instead of 500s.
const upload = {
  any: () => (req, res, next) => {
    multerUpload.any()(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ detail: 'Resume must be 5 MB or smaller' });
      }
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ detail: err.message });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ detail: 'Upload exactly one PDF file' });
      }
      return next(err);
    });
  }
};

// PDF files start with the "%PDF-" magic bytes
function hasPdfSignature(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return buf.toString('ascii') === '%PDF-';
  } catch {
    return false;
  }
}

const handleResumeUpload = async (req, res) => {
  const uploadedFile = req.file || (req.files && req.files[0]);
  if (!uploadedFile || !uploadedFile.path) {
    return res.status(400).json({ detail: 'Please attach your resume as a PDF file' });
  }
  if (!hasPdfSignature(uploadedFile.path)) {
    fs.unlink(uploadedFile.path, () => {});
    return res.status(400).json({ detail: 'The uploaded file is not a valid PDF' });
  }
  try {
    const targetRole = req.body.target_role || req.body.targetRole || (req.user.targetRoles && req.user.targetRoles[0]) || 'Software Developer (SDE)';
    const result = await analyseResumeFile({ filePath: uploadedFile.path, filename: uploadedFile.originalname, targetRole });
    const resume = await Resume.create({
      userId: req.user._id,
      filename: uploadedFile.originalname,
      storageKey: uploadedFile.filename,
      rawText: result.rawText.slice(0, 20000),
      parsedSkills: result.parsed.skills,
      parsed: result.parsed,
      extraction: result.extraction,
      atsScore: result.atsScore,
      domainFit: result.targetRole,
      recommendations: result.recommendations,
      analysisVersion: result.analysisVersion,
      diagnosticData: null
    });
    resume.diagnosticData = toDiagnosticPayload(resume, result);
    await resume.save();
    res.status(201).json(resume.diagnosticData);
  } catch (err) {
    fs.unlink(uploadedFile.path, () => {});
    if (err.status && err.status < 500) return res.status(err.status).json({ detail: err.message });
    console.error('Resume upload error:', err);
    res.status(500).json({ detail: 'Failed to analyse the resume' });
  }
};

async function findOwnedResume(id, user) {
  if (!mongoose.isValidObjectId(id)) return null;
  const resume = await Resume.findById(id);
  if (!resume) return null;
  const staff = ['admin', 'placement_officer', 'recruiter'].includes(user.role);
  return (staff || resume.userId.toString() === user._id.toString()) ? resume : null;
}

// POST /upload and POST / (spec: POST /resumes)
router.post('/upload', protect, upload.any(), handleResumeUpload);
router.post('/', protect, upload.any(), handleResumeUpload);

const STRONG_VERBS = ['Engineered', 'Built', 'Designed', 'Implemented', 'Optimized', 'Developed', 'Automated', 'Led'];
const WEAK_OPENERS = /^(i\s+)?(worked on|was responsible for|responsible for|helped( to)?|did|made|handled|involved in|participated in|assisted( in| with)?)\s+/i;

// Deterministic rewrite used when no LLM is reachable. It never invents numbers:
// it inserts explicit [placeholders] for the student to fill with their real metrics.
function ruleBasedBulletVariants(bullet) {
  const core = bullet.trim().replace(/^[-•*]\s*/, '').replace(/\.$/, '').replace(WEAK_OPENERS, '');
  const lowerFirst = core.charAt(0).toLowerCase() + core.slice(1);
  const startsWithVerb = /^[A-Z][a-z]+ed\b/.test(core);
  const verb = STRONG_VERBS[core.length % STRONG_VERBS.length];
  const base = startsWithVerb ? core : `${verb} ${lowerFirst}`;
  return [
    { variant: `${base}, improving [metric, e.g. response time] by [X]% for [N] users.`, focus: 'Quantified Impact', metricsAdded: true },
    { variant: `${base} using [key technologies], delivering [concrete outcome].`, focus: 'Strong Action Verb', metricsAdded: false },
    { variant: `Led ${lowerFirst.replace(/^(built|designed|developed|implemented|engineered|created)\s+/i, 'the development of ')} with a team of [N], owning [specific responsibility].`, focus: 'Tech Leadership', metricsAdded: false }
  ];
}

// POST /bullets/improve — { bullet, role }
router.post('/bullets/improve', protect, async (req, res) => {
  try {
    const bullet = String(req.body.bullet || '').trim();
    const role = String(req.body.role || 'Software Engineer').slice(0, 80);
    if (bullet.length < 8) {
      return res.status(400).json({ detail: 'Enter a resume bullet of at least 8 characters' });
    }
    if (bullet.length > 400) {
      return res.status(400).json({ detail: 'Bullet is too long (max 400 characters)' });
    }

    let variants = null;
    const { callCustomLLM } = require('../services/aiService');
    const raw = await callCustomLLM(
      `You rewrite resume bullet points for a ${role} campus placement resume. Return ONLY a JSON array of exactly 3 objects with keys "variant" (one sentence) and "focus" (one of "Quantified Impact", "Strong Action Verb", "Tech Leadership"). Keep every fact from the original. NEVER invent numbers: where a metric is needed write a placeholder like [X]% or [N] users.`,
      `Original bullet: ${bullet}`,
      { maxTokens: 300, temperature: 0.4 }
    );
    if (raw) {
      try {
        const match = raw.match(/\[[\s\S]*\]/);
        const parsed = match ? JSON.parse(match[0]) : null;
        const allowed = ['Quantified Impact', 'Strong Action Verb', 'Tech Leadership'];
        if (Array.isArray(parsed)) {
          variants = parsed
            .filter(v => v && typeof v.variant === 'string' && v.variant.trim().length > 10)
            .slice(0, 3)
            .map((v, i) => ({
              variant: v.variant.trim(),
              focus: allowed.includes(v.focus) ? v.focus : allowed[i % 3],
              metricsAdded: /\[[^\]]+\]|\d/.test(v.variant)
            }));
        }
      } catch {
        variants = null;
      }
    }
    if (!variants || variants.length === 0) {
      variants = ruleBasedBulletVariants(bullet);
    }

    res.json({
      id: `bullet-${Date.now().toString(36)}`,
      originalText: bullet,
      improvedVariants: variants
    });
  } catch (err) {
    console.error('Bullet improve error:', err);
    res.status(500).json({ detail: 'Failed to improve bullet' });
  }
});

// GET / (spec: GET /resumes)
router.get('/', protect, async (req, res) => {
  try {
    const list = await Resume.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(list.map(r => ({
      id: r._id.toString(),
      filename: r.filename,
      atsScore: r.atsScore,
      targetRole: r.domainFit,
      analysisVersion: r.analysisVersion || 'legacy',
      createdAt: r.createdAt
    })));
  } catch (err) {
    res.status(500).json({ detail: 'Failed to fetch resumes' });
  }
});

// GET /:id (spec: GET /resumes/{id})
router.get('/:id', protect, async (req, res) => {
  try {
    const resume = await findOwnedResume(req.params.id, req.user);
    if (!resume) return res.status(404).json({ detail: 'Resume not found' });
    res.json(resume.diagnosticData || { id: resume._id.toString(), filename: resume.filename, atsScore: resume.atsScore });
  } catch (err) {
    res.status(500).json({ detail: 'Failed to fetch resume' });
  }
});

// POST /:id/analyze — re-run the analysis (optionally for another target role)
router.post('/:id/analyze', protect, async (req, res) => {
  try {
    const resume = await findOwnedResume(req.params.id, req.user);
    if (!resume) return res.status(404).json({ detail: 'Resume not found' });
    if (!resume.storageKey) return res.status(409).json({ detail: 'The original file of this legacy resume is not stored; upload it again.' });
    const filePath = path.join(uploadDir, path.basename(resume.storageKey));
    if (!fs.existsSync(filePath)) return res.status(409).json({ detail: 'The original file is no longer available; upload it again.' });
    const result = await analyseResumeFile({ filePath, filename: resume.filename, targetRole: req.body.targetRole || resume.domainFit });
    resume.rawText = result.rawText.slice(0, 20000);
    resume.parsedSkills = result.parsed.skills;
    resume.parsed = result.parsed;
    resume.extraction = result.extraction;
    resume.atsScore = result.atsScore;
    resume.domainFit = result.targetRole;
    resume.recommendations = result.recommendations;
    resume.analysisVersion = result.analysisVersion;
    resume.diagnosticData = toDiagnosticPayload(resume, result);
    await resume.save();
    res.json(resume.diagnosticData);
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ detail: err.message });
    console.error('Resume analyze error:', err);
    res.status(500).json({ detail: 'Failed to analyse the resume' });
  }
});

// DELETE /:id (spec: DELETE /resumes/{id}) — removes the record and the stored file
router.delete('/:id', protect, async (req, res) => {
  try {
    const resume = await findOwnedResume(req.params.id, req.user);
    if (!resume) return res.status(404).json({ detail: 'Resume not found' });
    if (resume.storageKey) fs.unlink(path.join(uploadDir, path.basename(resume.storageKey)), () => {});
    await resume.deleteOne();
    res.json({ status: 'success', message: 'Resume deleted' });
  } catch (err) {
    res.status(500).json({ detail: 'Failed to delete resume' });
  }
});

module.exports = router;
module.exports.handleResumeUpload = handleResumeUpload;
module.exports.upload = upload;
