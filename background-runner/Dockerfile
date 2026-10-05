FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY background-runner/package*.json ./background-runner/
WORKDIR /app/background-runner
RUN npm install --include=dev
WORKDIR /app
COPY background-runner ./background-runner
COPY core/agent ./core/agent
COPY core/llm/vynorai-system-prompt.ts ./core/llm/vynorai-system-prompt.ts
RUN cd background-runner && npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/background-runner/node_modules ./node_modules
COPY --from=builder /app/background-runner/dist ./dist
ENV NODE_ENV=production
USER 65532:65532
ENTRYPOINT ["node", "/app/dist/index.js"]
