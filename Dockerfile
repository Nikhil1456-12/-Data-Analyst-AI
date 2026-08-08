# ─── Data Analyst AI — Production Dockerfile ──────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install Python for visualization & analytics
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

# Install Node dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Build frontend
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

# Copy production node_modules and built frontend
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/client/dist ./client/dist

# Copy application code
COPY server.js .
COPY services/ ./services/
COPY routes/ ./routes/
COPY middleware/ ./middleware/
COPY package.json .

# Create uploads directory
RUN mkdir -p uploads

# Security: run as non-root
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
RUN chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
