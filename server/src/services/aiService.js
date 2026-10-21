/**
 * Thin generation helpers on top of the AI router. Interview dialogue lives in
 * interviewService, evaluation in evaluationEngine — this module only offers a generic
 * text-generation call and PII scrubbing for prompts.
 */
const { providerFactory } = require('./providers/AIProviderFactory');

/**
 * Generates text with the configured provider. Returns null when every provider fails, so
 * callers must handle "no model output" explicitly (no invented text is substituted here).
 */
async function generateText(systemPrompt, userPrompt, { feature = 'generic_generation', maxTokens = 400, temperature = 0.4, json = false } = {}) {
  try {
    const result = await providerFactory.execute(feature, provider => provider.generate({
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens,
      temperature,
      json
    }), { maxRetries: 1 });
    return result.text || null;
  } catch (err) {
    console.warn(`[AIService] ${feature} unavailable: ${err.message}`);
    return null;
  }
}

/** Removes direct personal identifiers before text is placed into a prompt. */
function scrubPII(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    // Any run of digits with phone separators totalling 10–13 digits (covers +91 98765 43210, (555) 123-4567)
    .replace(/\+?\(?\d[\d\s().-]{8,18}\d/g, m => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= 10 && digits <= 13 ? '[PHONE]' : m;
    })
    .replace(/https?:\/\/(www\.)?linkedin\.com\/[^\s)]+/gi, '[LINKEDIN]');
}

// Primary custom model generation helpers
const callCustomLLM = (system, user, opts = {}) => generateText(system, user, { feature: opts.feature || 'generic_generation', maxTokens: opts.maxTokens, temperature: opts.temperature });
const callAIModel = callCustomLLM;
// Backwards-compatible name used by legacy call sites
const callOllamaLLM = callCustomLLM;

module.exports = { generateText, callCustomLLM, callAIModel, callOllamaLLM, scrubPII };
