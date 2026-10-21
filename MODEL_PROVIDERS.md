# PrepAI — Model Providers & Hardware Setup Guide

## 1. Overview of Supported Providers

PrepAI's Provider Abstraction Layer decouples application logic from inference backends, allowing full customization across live cloud hosting, private servers, and custom model endpoints.

```
                      ┌─────────────────────────────────┐
                      │    AIProviderFactory (:7857)    │
                      └────────────────┬────────────────┘
                                       │
        ┌──────────────┬───────────────┴───────────────┬──────────────┐
        ▼              ▼                               ▼              ▼
┌──────────────┐ ┌──────────────┐             ┌────────────────┐ ┌──────────────┐
│ Custom Models│ │Anthropic API │             │ Google Gemini  │ │OpenAI / Groq │
│ (Live Default│ │(Claude 3.5)  │             │(Flash / Pro)   │ │(vLLM / LM)   │
└──────────────┘ └──────────────┘             └────────────────┘ └──────────────┘
```

---

## 2. Custom Models Provider (Option A: 100% Hugging Face Open-Source Architecture)

PrepAI is configured to run entirely on **Custom Open-Source Models** (`AI_PROVIDER=custom`) hosted remotely via Hugging Face Serverless Inference Router, eliminating all desktop and local daemon dependencies (no local Ollama, no local PyTorch, no local vLLM).

### 2.1. Selected Custom Models by Task
- **Live Interview Turn**: `Qwen/Qwen2.5-Coder-7B-Instruct` (Fast, high-fidelity technical dialogue)
- **7-Dimension Rubric Grading**: `Qwen/Qwen2.5-Coder-7B-Instruct` (Precise JSON structured outputs and candidate evaluation)
- **Camera Proctoring & Vision Tutor**: `Qwen/Qwen2.5-VL-7B-Instruct` (Webcam frame inspection, posture & environment analysis)
- **Semantic Embeddings & RAG**: `BAAI/bge-small-en-v1.5` (768-dim dense vector embeddings)

### 2.2. Environment Configuration
Add or update these keys in your `server/.env`:

```env
AI_PROVIDER=custom
CUSTOM_MODEL_URL=https://router.huggingface.co/hf-inference/v1
CUSTOM_API_KEY=your_huggingface_token_here          # or set HF_TOKEN=
HF_TOKEN=your_huggingface_token_here

# Specific task models:
CUSTOM_MODEL=Qwen/Qwen2.5-Coder-7B-Instruct
CUSTOM_EVALUATION_MODEL=Qwen/Qwen2.5-Coder-7B-Instruct
CUSTOM_VISION_MODEL=Qwen/Qwen2.5-VL-7B-Instruct
CUSTOM_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5

# Laya Service (disabled: no local services required)
LAYA_ENABLED=false
```

### 2.3. Embeddings & Fallback
If your custom model backend only serves text/chat completions without an embeddings endpoint, PrepAI automatically activates an internal deterministic 768-dimensional normalized embedding fallback, ensuring that semantic vector comparisons and cosine similarity continue operating without errors.

---

## 3. Alternative Cloud Providers

You can switch or configure cloud fallback providers by setting the corresponding environment variables:

### 3.1. Google Gemini
- **Setup**:
  ```env
  AI_PROVIDER=gemini
  GEMINI_API_KEY=AIzaSy...
  GEMINI_MODEL=gemini-1.5-flash
  ```

### 3.2. Anthropic Claude
- **Setup**:
  ```env
  AI_PROVIDER=anthropic
  ANTHROPIC_API_KEY=sk-ant-api03-...
  ANTHROPIC_MODEL=claude-3-5-haiku-20241022
  ```

### 3.3. OpenAI & Groq
- **Setup**:
  ```env
  AI_PROVIDER=openai
  OPENAI_API_KEY=gsk_...
  OPENAI_BASE_URL=https://api.groq.com/openai/v1
  OPENAI_MODEL=llama-3.3-70b-versatile
  ```

---

## 4. Legacy Local Ollama (Optional Local Testing Only)

For developers who explicitly wish to run local desktop Ollama on their workstations:
```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

---

## 5. Live Production Deployment Checklist

When deploying PrepAI to cloud platforms (such as Render, Vercel, Railway, or AWS):
1. **Set `AI_PROVIDER=custom`** (the default).
2. **Point `CUSTOM_MODEL_URL`** to your deployed inference API or cloud provider gateway.
3. **Set `JWT_SECRET`** to a secure random string (at least 32 characters).
4. **Set `MONGODB_URI`** to your MongoDB Atlas connection string.
5. **Set `CORS_ORIGINS`** to your live frontend URL.
