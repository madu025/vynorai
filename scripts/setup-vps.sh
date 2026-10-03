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

# 2. Prepare models: router/summarizer (Qwen 2.5 Coder 1.5B) + embeddings (bge-small)
mkdir -p ./models

download_model() {
    local file="$1" url="$2" label="$3"
    if [ ! -f "$file" ]; then
        echo "📥 Downloading $label..."
        curl -fL -o "$file.part" "$url"
        mv "$file.part" "$file"
        echo "✅ $label download complete."
    else
        echo "✅ $label already exists at $file"
    fi
}

# 1.5B is ~2x faster than 3B on CPU and plenty for one-letter tier routing.
download_model "./models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf" \
  "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf" \
  "Qwen 2.5 Coder 1.5B Instruct Q4_K_M (~1.1 GB)"

download_model "./models/bge-small-en-v1.5-q8_0.gguf" \
  "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf" \
  "bge-small-en-v1.5 embeddings Q8_0 (~36 MB)"

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
