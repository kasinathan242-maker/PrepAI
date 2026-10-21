const CustomModelProvider = require('./CustomModelProvider');
const OllamaProvider = require('./OllamaProvider');
const AnthropicProvider = require('./AnthropicProvider');
const GeminiProvider = require('./GeminiProvider');
const OpenAICompatibleProvider = require('./OpenAICompatibleProvider');
const config = require('../../config/env');
const { recordExecution, classifyError } = require('../observability');

const PROVIDER_CLASSES = {
  custom: CustomModelProvider,
  openai: OpenAICompatibleProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  ollama: OllamaProvider
};

class AIProviderFactory {
  constructor() {
    this.providers = new Map();
  }

  getProvider(name) {
    const key = String(name || config.ai.provider || 'custom').toLowerCase();
    if (!this.providers.has(key)) {
      const Cls = PROVIDER_CLASSES[key] || PROVIDER_CLASSES.custom;
      if (!Cls) throw new Error(`Unsupported AI provider "${name}"`);
      this.providers.set(key, new Cls());
    }
    return this.providers.get(key);
  }

  getDefaultProvider() {
    return this.getProvider(config.ai.provider);
  }

  getFallbackProvider() {
    const name = config.ai.fallbackProvider;
    if (!name || name === config.ai.provider) return null;
    const provider = this.getProvider(name);
    return provider.getModelInfo().configured ? provider : null;
  }

  getEmbeddingProvider() {
    return this.getProvider(config.embeddings.provider);
  }

  /**
   * Run `task(provider)` with retries on the configured provider, then on the configured
   * fallback provider. Every attempt outcome is recorded (without prompt content).
   * @param {string} feature - e.g. 'interview_turn', 'answer_evaluation'
   * @param {(provider) => Promise<any>} task
   * @param {{maxRetries?: number, validate?: (result) => boolean}} [options]
   *   validate: structured-output check; an invalid result counts as a failed attempt.
   */
  async execute(feature, task, options = {}) {
    const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 1;
    const chain = [this.getDefaultProvider()];
    const fallback = this.getFallbackProvider();
    if (fallback) chain.push(fallback);

    let lastError = null;
    for (let p = 0; p < chain.length; p++) {
      const provider = chain[p];
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const started = Date.now();
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 500));
          const result = await task(provider);
          const valid = options.validate ? Boolean(options.validate(result)) : null;
          recordExecution({
            feature,
            kind: 'generation',
            provider: provider.providerName,
            model: result?.model || provider.modelName,
            latencyMs: Date.now() - started,
            success: valid !== false,
            errorType: valid === false ? 'invalid_output' : null,
            retries: attempt,
            fallbackUsed: p > 0,
            structuredOutputValid: valid,
            promptTokens: result?.usage?.promptTokens || 0,
            completionTokens: result?.usage?.completionTokens || 0
          });
          if (valid === false) {
            lastError = new Error('Model returned output that does not match the required schema');
            continue;
          }
          return { ...result, retries: attempt, fallbackUsed: p > 0 };
        } catch (err) {
          lastError = err;
          recordExecution({
            feature,
            kind: 'generation',
            provider: provider.providerName,
            model: provider.modelName,
            latencyMs: Date.now() - started,
            success: false,
            errorType: classifyError(err),
            retries: attempt,
            fallbackUsed: p > 0
          });
          console.warn(`[AIRouter] ${feature} failed on ${provider.providerName} (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}`);
        }
      }
    }
    const error = new Error(`AI operation "${feature}" failed: ${lastError?.message || 'unknown error'}`);
    error.code = 'AI_UNAVAILABLE';
    throw error;
  }

  /** Embeds one or more texts; throws when the embedding provider is unavailable. */
  async embed(feature, input) {
    const provider = this.getEmbeddingProvider();
    const started = Date.now();
    try {
      const vectors = await provider.embed(input);
      recordExecution({ feature, kind: 'embedding', provider: provider.providerName, model: provider.embeddingModel, latencyMs: Date.now() - started, success: true });
      return { vectors, provider: provider.providerName, model: provider.embeddingModel };
    } catch (err) {
      recordExecution({ feature, kind: 'embedding', provider: provider.providerName, model: provider.embeddingModel, latencyMs: Date.now() - started, success: false, errorType: classifyError(err) });
      throw err;
    }
  }

  listModels() {
    return Object.keys(PROVIDER_CLASSES).map(name => {
      const info = this.getProvider(name).getModelInfo();
      return { ...info, role: name === config.ai.provider ? 'primary' : (name === config.ai.fallbackProvider ? 'fallback' : 'available') };
    });
  }

  async checkAllProviders() {
    const primary = this.getDefaultProvider();
    const fallback = this.getFallbackProvider();
    const embedding = this.getEmbeddingProvider();
    const results = {};
    for (const p of [primary, fallback, embedding].filter(Boolean)) {
      if (results[p.providerName]) continue;
      try {
        results[p.providerName] = await p.healthCheck();
      } catch (err) {
        results[p.providerName] = { healthy: false, error: err.message };
      }
    }
    return {
      status: results[primary.providerName]?.healthy ? 'operational' : 'degraded',
      activeProvider: primary.providerName,
      activeModel: primary.modelName,
      embeddingProvider: embedding.providerName,
      embeddingModel: embedding.embeddingModel,
      fallbackProvider: fallback ? fallback.providerName : null,
      providers: results
    };
  }
}

const factoryInstance = new AIProviderFactory();

module.exports = {
  AIProviderFactory,
  providerFactory: factoryInstance,
  getAIProvider: (name) => factoryInstance.getProvider(name),
  getDefaultProvider: () => factoryInstance.getDefaultProvider()
};
