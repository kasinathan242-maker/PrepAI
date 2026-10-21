# PrepAI — Production Deployment & Operations Guide

## 1. Deployment Topologies

PrepAI supports three production deployment topologies based on organization privacy requirements and infrastructure availability:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGY A: On-Premises / Air-Gapped Private Infrastructure           │
│ [Browser] ──> [Nginx SSL Proxy] ──> [Node.js Express] ──> [MongoDB]   │
│                                              │                         │
│                                              ▼                         │
│                                     [Local Ollama + GPU]               │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGY B: Hybrid Cloud (Recommended for Cost & Security)             │
│ [Vercel CDN Frontend] ──> [AWS EC2 / Render API Gateway] ──> [Atlas]   │
│                                      │                                 │
│                                      ├─ Primary: [GPU Host / Ollama]   │
│                                      └─ Failover: [Cloud AI API]       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGY C: Fully Serverless Cloud Native                              │
│ [Vercel / Cloudflare] ──> [Railway / AWS ECS Fargate] ──> [Atlas]      │
│                                      │                                 │
│                                      ▼                                 │
│                           [Groq / Anthropic / Gemini]                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Docker & Containerized Deployment

### 2.1. Docker Compose Configuration (`docker-compose.yml`)
```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:8.0
    restart: always
    environment:
      MONGO_INITDB_DATABASE: prepai
    volumes:
      - mongo_data:/data/db
    ports:
      - "27017:27017"

  ollama:
    image: ollama/ollama:latest
    restart: always
    ports:
      - "11434:11434"
    volumes:
      - ollama_models:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  prepai-server:
    build:
      context: ./server
      dockerfile: Dockerfile
    restart: always
    environment:
      PORT: 7857
      MONGO_URI: mongodb://mongodb:27017/prepai
      AI_PROVIDER: custom
      CUSTOM_MODEL_URL: http://custom-models:8000/v1 # Or your live cloud custom model URL
      CUSTOM_MODEL: custom-model
      CUSTOM_EMBEDDING_MODEL: custom-embedding-model
      JWT_SECRET: production_entropy_jwt_secret_prepai_2026
    ports:
      - "7857:7857"
    depends_on:
      - mongodb

  prepai-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: always
    ports:
      - "80:80"
    depends_on:
      - prepai-server

volumes:
  mongo_data:
  ollama_models:
```

### 2.2. Backend Dockerfile (`server/Dockerfile`)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 7857
CMD ["node", "src/server.js"]
```

---

## 3. Nginx Reverse Proxy & SSL Termination

When hosting on public internet domains, deploy Nginx in front of Express and Vite for TLS termination, gzip compression, and rate limiting:

```nginx
server {
    listen 80;
    server_name prepai.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name prepai.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/prepai.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/prepai.yourdomain.com/privkey.pem;

    # Frontend Static Assets
    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API Gateway
    location /api/ {
        proxy_pass http://127.0.0.1:7857/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Extended timeouts for deep technical evaluation inference turns
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

---

## 4. Production Environment Checklist

Before launching to live candidate cohorts, verify the following:

- [ ] **JWT Secret**: Set `JWT_SECRET` to a cryptographically random 256-bit string.
- [ ] **Database Indexes**: Run database migrations to ensure all compound indexes are compiled.
- [ ] **Ollama Model Pre-Warming**: Preload models into GPU VRAM to eliminate cold-start latency:
  ```bash
  curl http://127.0.0.1:11434/api/generate -d '{"model": "qwen2.5-coder:7b", "keep_alive": -1}'
  ```
- [ ] **Token Bucket Limits**: Ensure `rateLimiter.js` values match planned concurrent interview loads.
- [ ] **Backup Automation**: Configure automated hourly MongoDB mongodump backups to offsite cold storage:
  ```bash
  mongodump --uri="mongodb://127.0.0.1:27017/prepai" --archive=/backups/prepai_$(date +%Y%m%d_%H%M%S).gz --gzip
  ```
- [ ] **Health Monitoring**: Monitor `GET /api/health` and `GET /api/health/ai` via Datadog, Prometheus, or Uptime Kuma.
