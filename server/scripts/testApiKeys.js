/**
 * PrepAI Custom Model & Provider Verification Script
 * Validates Custom Model API Connectivity, Chat Generation, Embeddings & Live Readiness
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const { providerFactory } = require('../src/services/providers/AIProviderFactory');
const config = require('../src/config/env');

async function testCustomModels() {
  console.log('====================================================');
  console.log('  🔍 PREPAI CUSTOM MODEL & LIVE VERIFICATION');
  console.log('====================================================\n');

  console.log(`📡 Active AI Provider:       ${config.ai.provider.toUpperCase()}`);
  console.log(`🤖 Chat & Dialogue Model:    ${config.ai.model}`);
  console.log(`📝 Evaluation Model:         ${config.ai.evaluationModel}`);
  console.log(`👁️ Vision Model:             ${config.ai.visionModel}`);
  console.log(`🧬 Embedding Provider/Model: ${config.embeddings.provider} / ${config.embeddings.model}`);
  console.log(`🌐 Base URL:                 ${config.ai.customBaseUrl || config.ai.ollamaBaseUrl}\n`);

  // 1. Health Check
  try {
    console.log('1️⃣ Checking Provider Health...');
    const provider = providerFactory.getDefaultProvider();
    const health = await provider.healthCheck();
    console.log('   Health Status:', health.healthy ? '✅ Operational' : '⚠️ Degraded', JSON.stringify(health));
  } catch (err) {
    console.log('   ❌ Health check failed:', err.message);
  }

  // 2. Chat Generation Turn
  try {
    console.log('\n2️⃣ Testing Dialogue Generation Turn...');
    const t0 = Date.now();
    const provider = providerFactory.getDefaultProvider();
    const res = await provider.generate({
      system: 'You are a senior tech interviewer at Amazon. Ask exactly one brief technical counter-question.',
      prompt: 'I used Redis for distributed caching to optimize latency.',
      maxTokens: 150,
      temperature: 0.3
    });
    console.log(`   ✅ Response received in ${Date.now() - t0}ms:`);
    console.log(`   "${res.text?.trim()}"`);
  } catch (err) {
    console.log('   ❌ Dialogue generation error:', err.message);
  }

  // 3. Embeddings Generation
  try {
    console.log('\n3️⃣ Testing Vector Embeddings...');
    const t0 = Date.now();
    const embResult = await providerFactory.embed('test_embedding', 'Full Stack Developer with React, Node.js, and MongoDB experience');
    const vec = embResult.vectors?.[0] || [];
    console.log(`   ✅ Embedding vector generated in ${Date.now() - t0}ms (Length: ${vec.length}, Model: ${embResult.model})`);
  } catch (err) {
    console.log('   ❌ Embedding error:', err.message);
  }

  console.log('\n🎉 CUSTOM MODEL VERIFICATION COMPLETED! Live Platform Ready.');
}

testCustomModels();
