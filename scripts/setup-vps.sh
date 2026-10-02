#!/usr/bin/env bash
# ==============================================================================
# VynorAI Production Setup Script for Dedicated Washington DC VPS
# ==============================================================================
set -e

echo "🚀 [VynorAI] Initializing Production Deployment on Dedicated VPS..."

# 1. Verify Docker and Docker Compose
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

# 2. Prepare Model Directory for Local SLM (Qwen 2.5 Coder 3B)
mkdir -p ./models
MODEL_FILE="./models/qwen2.5-coder-3b-instruct-q4_k_m.gguf"

if [ ! -f "$MODEL_FILE" ]; then
    echo "📥 Downloading Qwen 2.5 Coder 3B Instruct Quantized Model (2.0 GB)..."
    curl -L -o "$MODEL_FILE" \
      "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf"
    echo "✅ Qwen 2.5 Coder 3B download complete."
else
    echo "✅ Model file already exists at $MODEL_FILE"
fi

# 3. Launch Docker Compose Stack
echo "🐳 Starting VynorAI containers (Backend + Redis + Local SLM Router)..."
docker compose -f docker-compose.vps.yml down --remove-orphans || true
docker compose -f docker-compose.vps.yml up -d --build

# 4. Await Health Check
echo "⏳ Waiting for VynorAI services to become healthy..."
sleep 5
for i in {1..15}; do
    if curl -s http://localhost:3333/health | grep -q '"status":"ok"'; then
        echo "🎉 [VynorAI] Production Backend is ONLINE & HEALTHY!"
        curl -s http://localhost:3333/health | jq . || curl -s http://localhost:3333/health
        exit 0
    fi
    echo "Waiting for health check... ($i/15)"
    sleep 2
done

echo "⚠️ Services started, but health check is taking longer. Check logs with: docker compose -f docker-compose.vps.yml logs"
