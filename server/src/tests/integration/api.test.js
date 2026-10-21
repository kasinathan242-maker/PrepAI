/**
 * End-to-end API integration suite. Requires the live stack:
 *   MongoDB, API on :7857 (npm start), Laya on :7860, AI models on custom endpoint.
 * Run with: npm run test:integration
 * Every account it creates uses the itest_ prefix and is removed (with all its data) afterwards.
 */
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');

const ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:7857';
const BASE = `${ORIGIN}/api/v1`;
const STAMP = Date.now();
const LLM_TIMEOUT = 600000;

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json, text, headers: res.headers };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ANSWERS = [
  "Hi, I'm a final-year CSE student. I built a REST API in Node.js with Express and MongoDB and added an index on the email field to keep lookups fast.",
  'A hash map stores key-value pairs in buckets chosen by hashing the key; collisions are handled with chaining or open addressing, giving average O(1) lookups.'
];

function makePdf(lines) {
  return new Promise(resolve => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    lines.forEach(l => doc.text(l));
    doc.end();
  });
}

async function register(tag) {
  const email = `itest_${tag}_${STAMP}@test.edu`;
  const res = await call('POST', '/auth/register', { body: { email, password: 'Itest12345', full_name: `Itest ${tag}`, role: 'admin' } });
  return { email, res, token: res.json && res.json.token, refresh: res.json && res.json.refresh_token };
}

const ctx = {};

test.before(async () => {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) throw new Error(`API not reachable at ${ORIGIN} — start it with npm start`);
  ctx.a = await register('a');
  ctx.b = await register('b');
  const admin = await call('POST', '/auth/login', { body: { email: 'admin@prep.ai', password: process.env.ADMIN_PASSWORD || '20062006' } });
  ctx.adminToken = admin.json && admin.json.token;
});

test.after(async () => {
  // Remove every document owned by the itest users across all collections
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prepai');
  const db = mongoose.connection.db;
  const users = await db.collection('users').find({ email: { $regex: `^itest_.*_${STAMP}@` } }).toArray();
  const ids = users.map(u => u._id);
  if (ids.length) {
    for (const { name } of await db.listCollections().toArray()) {
      if (name === 'users') continue;
      await db.collection(name).deleteMany({ $or: [{ userId: { $in: ids } }, { actorId: { $in: ids } }] });
    }
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }
  await db.collection('placementevents').deleteMany({ title: `Itest Marathon ${STAMP}` });
  // Scheduling the event broadcast a notification to every student
  await db.collection('notifications').deleteMany({ title: `New mock event: Itest Marathon ${STAMP}` });
  await db.collection('questionbanks').deleteMany({ questionText: { $regex: `^Itest question ${STAMP}` } });
  await mongoose.disconnect();
});

test('platform: health, request ids, security headers, CORS allowlist', async () => {
  const h = await call('GET', '/health');
  assert.equal(h.status, 200);
  assert.ok(h.headers.get('x-request-id'));
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  const evil = await fetch(`${BASE}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example');
  const ok = await fetch(`${BASE}/health`, { headers: { Origin: 'http://localhost:5174' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5174');
});

test('auth: no bypass, no role escalation, duplicate rejected', async () => {
  assert.equal((await call('GET', '/users/me')).status, 401);
  assert.equal((await call('GET', '/users/me', { token: 'prepai_demo_auth_token_jwt_mock' })).status, 401);
  assert.equal(ctx.a.res.status, 201);
  assert.equal(ctx.a.res.json.user.role, 'student');
  assert.equal((await call('POST', '/auth/register', { body: { email: ctx.a.email, password: 'Itest12345' } })).status, 409);
  assert.equal((await call('GET', '/admin/students', { token: ctx.a.token })).status, 403);
  assert.equal((await call('PUT', '/users/me/xp', { token: ctx.a.token, body: { points: 999 } })).status, 403);
});

test('auth: refresh tokens rotate and logout revokes them', async () => {
  const c = await register('c');
  const r1 = await call('POST', '/auth/refresh', { body: { refresh_token: c.refresh } });
  assert.equal(r1.status, 200);
  assert.ok(r1.json.token && r1.json.refresh_token);
  assert.equal((await call('GET', '/users/me', { token: r1.json.token })).status, 200);
  assert.equal((await call('POST', '/auth/logout', { token: r1.json.token })).status, 200);
  assert.equal((await call('POST', '/auth/refresh', { body: { refresh_token: r1.json.refresh_token } })).status, 401);
  assert.equal((await call('GET', '/users/me', { token: r1.json.token })).status, 401);
});

test('auth: forgot-password does not reveal accounts; wrong OTP rejected', async () => {
  const f1 = await call('POST', '/auth/forgot-password', { body: { email: ctx.a.email } });
  const f2 = await call('POST', '/auth/forgot-password', { body: { email: 'nobody_here@x.com' } });
  assert.equal(f1.status, 200);
  assert.equal(f1.json.message, f2.json.message);
  assert.equal((await call('POST', '/auth/reset-password', { body: { email: ctx.a.email, otp: '000000', password: 'NewPass12345' } })).status, 400);
});

test('dashboard: a new user sees honest empty state', async () => {
  const d = await call('GET', '/users/me/dashboard', { token: ctx.a.token });
  assert.equal(d.status, 200);
  assert.equal(d.json.readiness.score, 0);
  assert.equal(d.json.scoreTimeline.length, 0);
  assert.equal(d.json.companyReadiness.length, 0);
  const m = await call('GET', '/mastery', { token: ctx.a.token });
  assert.equal(m.status, 200);
  for (const name of ['/dashboard/summary', '/dashboard/activity', '/study-plan', '/profile', '/profile/readiness', '/notifications', '/users/me/notifications/preferences', '/interviews/history', '/aptitude/history']) {
    assert.equal((await call('GET', name, { token: ctx.a.token })).status, 200, name);
  }
});

test('aptitude: no answer-key leak, server timing, deterministic scoring, idempotent XP, IDOR', async () => {
  const start = await call('POST', '/aptitude/start', { token: ctx.a.token, body: { jobRole: 'sde', companyPattern: 'tcs', durationMinutes: 30 } });
  assert.equal(start.status, 201);
  const qs = start.json.questions;
  assert.equal(qs.length, 6);
  assert.ok(qs.every(q => q.correctAnswer === undefined && q.explanation === undefined));
  const sid = start.json.sessionId;
  assert.equal((await call('GET', `/aptitude/${sid}`, { token: ctx.b.token })).status, 404);

  const rec = await call('POST', `/aptitude/${sid}/answer`, { token: ctx.a.token, body: { questionId: qs[0].id, selectedOption: 'A' } });
  assert.equal(rec.status, 200);
  assert.equal(rec.json.recorded, true);
  assert.equal(rec.json.afterDeadline, false);
  assert.equal(rec.json.isCorrect, undefined, 'correctness must not be revealed before submit');
  assert.equal((await call('POST', `/aptitude/${sid}/answer`, { token: ctx.a.token, body: { questionId: qs[0].id, selectedOption: 'Z' } })).status, 400);

  const sub = await call('POST', `/aptitude/${sid}/submit`, { token: ctx.a.token, body: { answers: { [qs[0].id]: 'A' } } });
  assert.equal(sub.status, 200);
  assert.equal(sub.json.totalQuestions, 6);
  assert.equal(sub.json.skippedCount, 5);
  assert.equal(sub.json.categoryBreakdown.reduce((a, c) => a + c.totalQuestions, 0), 6);
  assert.ok(sub.json.timeUsedSeconds < 120);
  const xp1 = (await call('GET', '/users/me', { token: ctx.a.token })).json.totalXp;
  await call('POST', `/aptitude/${sid}/submit`, { token: ctx.a.token, body: { answers: { [qs[0].id]: 'A' } } });
  const me = (await call('GET', '/users/me', { token: ctx.a.token })).json;
  assert.equal(me.totalXp, xp1);
  assert.equal(me.currentStreak, 1);
  assert.equal((await call('POST', `/aptitude/${sid}/answer`, { token: ctx.a.token, body: { questionId: qs[1].id, selectedOption: 'A' } })).status, 409);

  const daily = await call('GET', '/aptitude/daily', { token: ctx.a.token });
  assert.equal(daily.status, 200);
  assert.equal(daily.json.questions_count, 5);
});

test('interview: state machine, ownership, async evaluation and evidence-backed report', { timeout: LLM_TIMEOUT }, async () => {
  const iv = await call('POST', '/interviews/start', { token: ctx.a.token, body: { jobRole: 'SDE', companyTarget: 'Amazon', interviewType: 'Technical Round', persona: 'Technical Lead' } });
  assert.equal(iv.status, 201);
  assert.ok(iv.json.greeting);
  assert.ok(iv.json.totalQuestionsPlanned > 0);
  const sid = iv.json.sessionId;
  assert.equal((await call('GET', `/interviews/${sid}`, { token: ctx.b.token })).status, 404);
  assert.equal((await call('GET', '/interviews/000000000000000000000000/report', { token: ctx.a.token })).status, 404);
  assert.equal((await call('POST', '/interviews/live-abc/answer', { token: ctx.a.token, body: { answer: 'hello' } })).status, 404);

  const t1 = await call('POST', `/interviews/${sid}/answer`, { token: ctx.a.token, body: {
    answer: ANSWERS[0],
    speech: { inputMode: 'text', responseLatencyMs: 1500 }
  } });
  assert.equal(t1.status, 200, t1.text);
  assert.ok(t1.json.aiResponse && t1.json.aiResponse.length > 5);
  assert.doesNotMatch(t1.json.aiResponse, /are you all set to begin/i);

  const t2 = await call('POST', `/interviews/${sid}/answer`, { token: ctx.a.token, body: { answer: ANSWERS[1] } });
  assert.equal(t2.status, 200, t2.text);

  const end = await call('POST', `/interviews/${sid}/end`, { token: ctx.a.token });
  assert.equal(end.status, 200);
  assert.equal(end.json.sessionId, sid);
  assert.equal(end.json.questionCount, 2);
  assert.equal(end.json.xpEarned, 50);

  let report;
  for (let i = 0; i < 110; i++) {
    report = await call('GET', `/interviews/${sid}/report`, { token: ctx.a.token });
    if (report.status !== 202) break;
    const p = await call('GET', `/interviews/${sid}/progress`, { token: ctx.a.token });
    assert.equal(p.status, 200);
    await sleep(5000);
  }
  assert.equal(report.status, 200, `report not ready: ${report.text.slice(0, 200)}`);
  const r = report.json;
  assert.ok(typeof r.overallScore === 'number' && r.overallScore >= 0 && r.overallScore <= 100);
  assert.ok(r.durationSeconds < 1200);
  assert.equal(r.visualAudit, null);
  assert.match(r.shareToken, /^[a-f0-9]{32}$/);
  assert.ok(r.questionAnalysis.length >= 1);
  assert.ok(r.evaluatorVersion);

  const evals = await call('GET', `/interviews/${sid}/evaluations`, { token: ctx.a.token });
  assert.equal(evals.status, 200);
  assert.ok(evals.json.length >= 1);
  const spoken = norm(ANSWERS.join(' '));
  for (const e of evals.json) {
    if (e.status === 'completed') {
      assert.equal(e.overall, Math.round(e.overall));
      // Every evidence quote must appear verbatim in what the student said
      for (const q of e.evidence || []) assert.ok(spoken.includes(norm(q)), `unverified evidence: ${q}`);
    } else if (e.status === 'failed') {
      assert.equal(e.overall, null, 'a failed evaluation must not carry a fabricated score');
    }
    const one = await call('GET', `/evaluations/${e._id}`, { token: ctx.a.token });
    assert.equal(one.status, 200);
    assert.ok(Array.isArray(one.json.data.signals));
    assert.equal((await call('GET', `/evaluations/${e._id}`, { token: ctx.b.token })).status, 404);
  }

  const shared = await call('GET', `/interviews/shared/${r.shareToken}/report`);
  assert.equal(shared.status, 200);
  assert.equal(shared.json.shareToken, undefined);
  assert.equal((await call('GET', `/interviews/${sid}/report`)).status, 401);
  const pdf = await fetch(`${BASE}/interviews/${sid}/report.pdf`, { headers: { Authorization: `Bearer ${ctx.a.token}` } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const notifs = (await call('GET', '/users/me/notifications', { token: ctx.a.token })).json;
  assert.ok(notifs.some(n => n.type === 'report_ready'));

  const mastery = await call('GET', '/mastery', { token: ctx.a.token });
  assert.equal(mastery.status, 200);
});

test('interview: ending with no answers gives an honest zero, no XP', { timeout: LLM_TIMEOUT }, async () => {
  const iv = await call('POST', '/interviews/start', { token: ctx.b.token, body: {} });
  assert.equal(iv.status, 201);
  const end = await call('POST', `/interviews/${iv.json.sessionId}/end`, { token: ctx.b.token });
  assert.equal(end.status, 200);
  assert.equal(end.json.questionCount, 0);
  assert.equal(end.json.xpEarned, 0);
  let rep;
  for (let i = 0; i < 20; i++) {
    rep = await call('GET', `/interviews/${iv.json.sessionId}/report`, { token: ctx.b.token });
    if (rep.status !== 202) break;
    await sleep(1500);
  }
  assert.equal(rep.status, 200);
  assert.equal(rep.json.overallScore, 0);
});

test('resume: PDF-only, verified extraction, ATS dimensions, ownership, delete', { timeout: LLM_TIMEOUT }, async () => {
  const bad = new FormData();
  bad.append('resume', new Blob(['<html>not a pdf</html>'], { type: 'text/html' }), 'evil.html');
  assert.equal((await call('POST', '/resumes', { token: ctx.a.token, form: bad })).status, 400);
  assert.equal((await fetch(`${ORIGIN}/uploads/anything.pdf`)).status, 404);

  const pdf = await makePdf([
    'Itest Student', 'itest@example.com | +91 98765 43210',
    'Education', 'B.E. Computer Science, Anna University, 2026, CGPA 8.4',
    'Skills', 'Python, JavaScript, React, Node.js, MongoDB, Git, SQL',
    'Projects', 'Campus Events Portal | React, Node.js, MongoDB',
    'Built a portal used by 1200 students to register for events; cut sign-up time by 40%.',
    'Experience', 'Software Intern, Zoho, 2025', 'Developed REST APIs in Node.js and wrote unit tests.'
  ]);
  const fd = new FormData();
  fd.append('resume', new Blob([pdf], { type: 'application/pdf' }), 'itest_resume.pdf');
  fd.append('targetRole', 'Software Developer (SDE)');
  const up = await call('POST', '/resumes', { token: ctx.a.token, form: fd });
  assert.equal(up.status, 201, up.text.slice(0, 300));
  const d = up.json;
  assert.ok(typeof d.atsScore === 'number' && d.atsScore >= 0 && d.atsScore <= 100);
  const id = d.id || d.resumeId;
  assert.ok(id);
  const text = pdf.toString('latin1');
  assert.ok(text.length > 0);
  // Skills reported must exist in the resume
  const skills = (d.parsedSkills || d.skills || []).map(s => (typeof s === 'string' ? s : s.name));
  const source = 'Python, JavaScript, React, Node.js, MongoDB, Git, SQL Campus Events Portal REST APIs unit tests'.toLowerCase();
  for (const s of skills) assert.ok(source.includes(String(s).toLowerCase()), `skill not in resume: ${s}`);

  assert.equal((await call('GET', `/resumes/${id}`, { token: ctx.b.token })).status, 404);
  assert.equal((await call('GET', `/resumes/${id}`, { token: ctx.a.token })).status, 200);
  const list = await call('GET', '/resumes', { token: ctx.a.token });
  assert.ok(list.json.some(r => r.id === id));
  const bullet = await call('POST', '/resume/bullets/improve', { token: ctx.a.token, body: { bullet: 'worked on a website for college events', role: 'SDE' } });
  assert.equal(bullet.status, 200);
  assert.ok(bullet.json.improvedVariants.length >= 1);
  assert.equal((await call('DELETE', `/resumes/${id}`, { token: ctx.a.token })).status, 200);
  assert.equal((await call('GET', `/resumes/${id}`, { token: ctx.a.token })).status, 404);
});

test('study plan & skill gap: generated from real data', async () => {
  const gen = await call('POST', '/study-plan/generate', { token: ctx.a.token, body: {} });
  assert.ok([200, 201].includes(gen.status), gen.text.slice(0, 200));
  const gap = await call('POST', '/skill-gap/analyze', { token: ctx.a.token, body: { roleSlug: 'software-developer-sde', skillRatings: { 'Data Structures & Algorithms': 'strong', Git: 'weak' } } });
  assert.equal(gap.status, 200);
  // Only rated skills count: (100 + 20) / 2
  assert.equal(gap.json.overallReadiness, 60);
  assert.deepEqual(gap.json.weaknesses, ['Git']);
  const none = await call('POST', '/skill-gap/analyze', { token: ctx.a.token, body: { roleSlug: 'software-developer-sde', skillRatings: { 'Not a skill': 'strong' } } });
  assert.equal(none.status, 400);
});

test('quests: claims need real activity and cannot repeat', async () => {
  // Daily quests reset at midnight, so complete the qualifying activity right here (same day)
  const apt = await call('POST', '/aptitude/start', { token: ctx.a.token, body: { jobRole: 'sde', companyPattern: 'tcs', durationMinutes: 30 } });
  assert.equal((await call('POST', `/aptitude/${apt.json.sessionId}/submit`, { token: ctx.a.token, body: { answers: {} } })).status, 200);
  assert.equal((await call('PUT', '/users/me/claim-quest', { token: ctx.a.token, body: { questId: 'q1' } })).status, 200);
  assert.equal((await call('PUT', '/users/me/claim-quest', { token: ctx.a.token, body: { questId: 'q1' } })).status, 409);
  assert.equal((await call('PUT', '/users/me/claim-quest', { token: ctx.b.token, body: { questId: 'q3' } })).status, 400);
});

test('gamification: leaderboard is anonymized', async () => {
  const g = await call('GET', '/users/me/gamification', { token: ctx.a.token });
  assert.equal(g.status, 200);
  const board = g.json.leaderboard || [];
  for (const row of board.filter(r => !r.isCurrentUser)) assert.doesNotMatch(String(row.name || ''), /@/);
});

test('admin: analytics, events, CSV import, export, AI quality, audit log', async () => {
  assert.ok(ctx.adminToken, 'seed admin login failed');
  const an = await call('GET', '/admin/batches/analytics', { token: ctx.adminToken });
  assert.equal(an.status, 200);
  assert.ok(an.json.metrics.totalRegistered > 0);
  const ev = await call('POST', '/admin/events', { token: ctx.adminToken, body: { eventName: `Itest Marathon ${STAMP}`, scheduledDate: '2026-12-01', scheduledTime: '10:00 AM', companyName: 'TCS', batchName: '2026' } });
  assert.equal(ev.status, 201);
  assert.ok((await call('GET', '/admin/events', { token: ctx.adminToken })).json.some(e => e.eventName === `Itest Marathon ${STAMP}`));

  const csv = 'category,sub_category,job_role,company_tags,difficulty,question_text,options,correct_answer,explanation\n' +
    `Quantitative,Percentages,SDE,"tcs",Easy,"Itest question ${STAMP}: what is 10% of 50?","A:5|B:10|C:15|D:50",A,"10/100*50=5"\n` +
    'Quantitative,Percentages,SDE,"tcs",Easy,"","A:1|B:2",A,""';
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'q.csv');
  const qu = await call('POST', '/admin/questions/upload', { token: ctx.adminToken, form: fd });
  assert.equal(qu.status, 200);
  assert.equal(qu.json.acceptedRows, 1);
  assert.equal(qu.json.rejectedRows, 1);

  const exp = await fetch(`${BASE}/admin/reports/export?type=full-batch&format=csv`, { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-type') || '', /text\/csv/);
  const q = await call('GET', '/admin/ai-quality', { token: ctx.adminToken });
  assert.equal(q.status, 200);
  assert.equal((await call('GET', '/admin/ai-quality', { token: ctx.a.token })).status, 403);
});

test('internal: AI health, model registry, metrics and Laya decisions', { timeout: 60000 }, async () => {
  const h = await call('GET', '/internal/ai/health', { token: ctx.adminToken });
  assert.equal(h.status, 200);
  const models = await call('GET', '/internal/ai/models', { token: ctx.adminToken });
  assert.equal(models.status, 200);
  assert.equal((await call('GET', '/internal/ai/metrics', { token: ctx.adminToken })).status, 200);
  assert.equal((await call('GET', '/internal/ai/health', { token: ctx.a.token })).status, 403);
  assert.equal((await call('POST', '/internal/laya/decision', { token: ctx.adminToken, body: {} })).status, 400);
  const laya = await call('POST', '/internal/laya/decision', { token: ctx.adminToken, body: {
    decision_type: 'answer_state',
    state: { question: 'What is a process?', student_answer: 'A process is a program in execution with its own address space.' }
  } });
  assert.equal(laya.status, 200, laya.text.slice(0, 200));
  const d = laya.json.data;
  assert.ok(['CORRECT', 'PARTIALLY_CORRECT', 'INCORRECT', 'IRRELEVANT', 'INSUFFICIENT_EVIDENCE'].includes(d.decision));
  const pSum = Object.values(d.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(pSum - 1) < 0.01, `probabilities sum to ${pSum}`);
  assert.ok(d.decisionVersion || d.decision_version);
});

test('concurrency: a double-clicked submit or End awards XP once and still returns the result', { timeout: LLM_TIMEOUT }, async () => {
  const token = ctx.b.token;
  const xpOf = async () => (await call('GET', '/users/me', { token })).json.totalXp;

  const apt = await call('POST', '/aptitude/start', { token, body: { jobRole: 'sde', companyPattern: 'tcs', durationMinutes: 30 } });
  assert.equal(apt.status, 201);
  const q = apt.json.questions;
  const xp0 = await xpOf();
  const subs = await Promise.all([1, 2, 3].map(() =>
    call('POST', `/aptitude/${apt.json.sessionId}/submit`, { token, body: { answers: { [q[0].id]: 'A' } } })));
  assert.ok(subs.every(s => s.status === 200), subs.map(s => s.status).join(','));
  assert.ok(subs.every(s => s.json.totalQuestions === 6), 'every concurrent response carries the saved result');
  assert.equal((await xpOf()) - xp0, 100, 'the test XP is awarded exactly once');

  const iv = await call('POST', '/interviews/start', { token, body: { jobRole: 'SDE', interviewType: 'Technical Round', persona: 'Technical Lead' } });
  assert.equal(iv.status, 201);
  const sid = iv.json.sessionId;
  assert.equal((await call('POST', `/interviews/${sid}/answer`, { token, body: { answer: ANSWERS[0] } })).status, 200);
  const xp1 = await xpOf();
  const ends = await Promise.all([1, 2].map(() => call('POST', `/interviews/${sid}/end`, { token })));
  assert.deepEqual(ends.map(e => e.status), [200, 200]);
  assert.deepEqual(ends.map(e => e.json.xpEarned).sort((a, b) => a - b), [0, 50]);
  assert.equal((await xpOf()) - xp1, 50);

  // The legacy voice end route hands off to the real end flow: no second award, report still queued
  assert.equal((await call('POST', `/voice/${sid}/end`, { token: ctx.a.token })).status, 404);
  const voice = await call('POST', `/voice/${sid}/end`, { token });
  assert.equal(voice.status, 200);
  assert.equal(voice.json.xpEarned, 0);
  assert.ok(['processing', 'ready', 'partial'].includes(voice.json.reportStatus), voice.json.reportStatus);
});

test('camera frames: owner only, JPEG only, size-capped, refused after the interview ends', { timeout: LLM_TIMEOUT }, async () => {
  const token = ctx.a.token;
  const jpeg = bytes => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes)]).toString('base64')}`;
  const iv = await call('POST', '/interviews/start', { token, body: { jobRole: 'SDE', interviewType: 'HR Round', persona: 'Corporate HR' } });
  const sid = iv.json.sessionId;
  const frame = (t, dataUrl) => call('POST', `/interviews/${sid}/frames`, { token: t, body: { dataUrl, offsetSec: 5 } });
  assert.equal((await frame(ctx.b.token, jpeg(2000))).status, 404, 'another student cannot add frames');
  assert.equal((await frame(token, 'data:image/png;base64,iVBORw0KGgo=')).status, 400, 'PNG data URL rejected');
  assert.equal((await frame(token, `data:image/jpeg;base64,${Buffer.from('not a jpeg at all').toString('base64')}`)).status, 400, 'bytes must be a JPEG');
  assert.equal((await frame(token, jpeg(310 * 1024))).status, 413, 'frames over 300 KB rejected');
  const ok = await frame(token, jpeg(2000));
  assert.equal(ok.status, 201);
  await call('POST', `/interviews/${sid}/end`, { token });
  assert.equal((await frame(token, jpeg(2000))).status, 409, 'no frames after the interview ends');
});

test('authorization: students cannot reach staff routes; bad evaluation ids are 404', async () => {
  for (const path of ['/admin/analytics', '/admin/students', '/internal/ai/health']) {
    assert.equal((await call('GET', path, { token: ctx.b.token })).status, 403, path);
  }
  assert.equal((await call('POST', '/evaluations/not-an-id/retry', { token: ctx.b.token })).status, 404);
  assert.equal((await call('POST', '/evaluations/000000000000000000000000/retry', { token: ctx.b.token })).status, 404);
});
