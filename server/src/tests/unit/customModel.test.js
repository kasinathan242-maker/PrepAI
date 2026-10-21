const test = require('node:test');
const assert = require('node:assert/strict');
require('./setup');

const CustomModelProvider = require('../../services/providers/CustomModelProvider');
const { AIProviderFactory } = require('../../services/providers/AIProviderFactory');
const { cosineSimilarity } = require('../../services/semanticEngine');
const config = require('../../config/env');

test('custom provider: initializes with custom defaults and base URLs', () => {
  const provider = new CustomModelProvider({
    modelName: 'custom-gpt',
    baseUrl: 'http://127.0.0.1:8000/v1'
  });
  assert.equal(provider.providerName, 'custom');
  assert.equal(provider.modelName, 'custom-gpt');
  assert.equal(provider.baseUrl, 'http://127.0.0.1:8000/v1');
});

test('custom provider: factory resolves custom provider by default or by key', () => {
  const factory = new AIProviderFactory();
  const provider = factory.getProvider('custom');
  assert.equal(provider.providerName, 'custom');

  // Any custom or unrecognized provider key safely resolves to CustomModelProvider
  const resolved = factory.getProvider('unknown-custom-backend');
  assert.equal(resolved.providerName, 'custom');
});

test('custom provider: deterministic fallback embeddings produce valid 768-dim normalized vectors', async () => {
  const provider = new CustomModelProvider({
    baseUrl: 'http://127.0.0.1:9999/v1' // Non-existent endpoint triggers fallback
  });

  const vec1 = await provider.generateEmbedding('Distributed systems, caching with Redis and horizontal scaling');
  const vec2 = await provider.generateEmbedding('Distributed systems, caching with Redis and horizontal scaling');
  const vec3 = await provider.generateEmbedding('Baking chocolate chip cookies in an oven');

  assert.equal(Array.isArray(vec1), true);
  assert.equal(vec1.length, 768);

  // Determinism check: same input yields identical vectors
  assert.deepEqual(vec1, vec2);

  // Cosine similarity on identical text is 1.0
  const simSelf = cosineSimilarity(vec1, vec2);
  assert.ok(Math.abs(simSelf - 1.0) < 0.001, `Expected ~1.0, got ${simSelf}`);

  // Cosine similarity on semantically different text is lower
  const simDiff = cosineSimilarity(vec1, vec3);
  assert.ok(simDiff < simSelf, `Expected lower similarity, got ${simDiff}`);
});

test('custom provider: healthCheck returns operational status with model metadata', async () => {
  const provider = new CustomModelProvider({
    modelName: 'meta-llama/Llama-3-70b-Instruct',
    baseUrl: 'http://127.0.0.1:8000/v1'
  });

  const health = await provider.checkHealth();
  assert.equal(health.healthy, true);
  assert.equal(health.provider, 'custom');
  assert.equal(health.activeModel, 'meta-llama/Llama-3-70b-Instruct');
  assert.equal(health.baseUrl, 'http://127.0.0.1:8000/v1');
});

test('custom provider: initializes with custom models and verifies no proprietary cloud fallback', () => {
  const factory = new AIProviderFactory();
  const provider = factory.getDefaultProvider();
  assert.equal(provider.providerName, 'custom');
  assert.equal(provider.modelName, config.ai.model);
  assert.equal(provider.embeddingModel, config.embeddings.model);
  assert.equal(provider.baseUrl, config.ai.customBaseUrl);

  // Verify no proprietary cloud provider (OpenAI / Claude / Gemini) is used as fallback
  const fallback = factory.getFallbackProvider();
  assert.equal(fallback, null);
});

test('custom provider: strips reasoning tokens and correctly prepares headers', () => {
  const provider = new CustomModelProvider({
    apiKey: 'hf_test_token_12345'
  });
  const headers = provider.getHeaders();
  assert.equal(headers['Authorization'], 'Bearer hf_test_token_12345');
  assert.equal(headers['Content-Type'], 'application/json');
});

