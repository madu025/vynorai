FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (sqlite3, bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --include=dev


COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build

# Production runner stage
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Coolify's container health probe uses curl against /health.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3333
ENV ADMIN_PORT=3334

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Create persistent data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# API port + Admin Portal port
EXPOSE 3333
EXPOSE 3334

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:${PORT}/ready > /dev/null || exit 1

CMD ["node", "dist/index.js"]
