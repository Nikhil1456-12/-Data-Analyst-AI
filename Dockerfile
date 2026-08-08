FROM node:20-slim

WORKDIR /app

# Install Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Python dependencies (lightweight — no sklearn/statsmodels)
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt 2>/dev/null || \
    pip3 install --no-cache-dir -r requirements.txt

# Backend dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build frontend
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build && rm -rf node_modules

# Application code
COPY server.js .
COPY services/ ./services/
COPY routes/ ./routes/
COPY middleware/ ./middleware/

RUN mkdir -p uploads

ENV NODE_ENV=production

CMD ["node", "server.js"]
