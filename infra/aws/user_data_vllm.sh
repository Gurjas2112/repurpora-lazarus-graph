#!/bin/bash
# EC2 user-data for the PRODUCTION inference host: vLLM (OpenAI-compatible API) instead of Ollama.
# Why vLLM for production: continuous batching + PagedAttention give far higher throughput under concurrent users
# than Ollama, while exposing the OpenAI API, so Repurpora switches with LLM_PROVIDER=openai and no code change.
#
# Target: g6.xlarge (1x NVIDIA L4 24 GB) or g5.xlarge (1x A10G 24 GB), Deep Learning Base GPU AMI (Ubuntu 22.04).
# Models: Qwen2.5-7B-Instruct-AWQ (primary) served with prefix caching; embeddings stay on a small Ollama sidecar
# (nomic-embed-text, 768-d) because the pgvector index dimension is fixed.
set -euxo pipefail
API_KEY="__VLLM_API_KEY__"
MODEL="${MODEL:-Qwen/Qwen2.5-7B-Instruct-AWQ}"
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/public-ipv4 || echo 127.0.0.1)
SITE="${PUBLIC_IP//./-}.sslip.io"

# --- Docker + NVIDIA runtime (preinstalled on the DLAMI; ensure the service is up) ---
systemctl enable --now docker

# --- vLLM OpenAI-compatible server (pinned image) ---
docker run -d --name vllm --restart unless-stopped --gpus all --ipc=host -p 127.0.0.1:8000:8000 \
  -v /opt/hf-cache:/root/.cache/huggingface \
  vllm/vllm-openai:v0.10.1 \
  --model "$MODEL" --served-model-name qwen2.5-7b-instruct \
  --quantization awq --max-model-len 8192 --gpu-memory-utilization 0.88 \
  --enable-prefix-caching --max-num-seqs 32 --api-key "$API_KEY"

# --- embeddings sidecar (Ollama, CPU/GPU) ---
curl -fsSL https://ollama.com/install.sh | sh
mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=127.0.0.1:11434"\nEnvironment="OLLAMA_KEEP_ALIVE=24h"\n' \
  > /etc/systemd/system/ollama.service.d/override.conf
systemctl daemon-reload && systemctl enable --now ollama && ollama pull nomic-embed-text

# --- TLS + routing (Caddy): /v1/* -> vLLM (its own API key), /api/embed -> Ollama (bearer-gated) ---
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
cat >/etc/caddy/Caddyfile <<CADDY
$SITE {
  handle /v1/* {
    reverse_proxy 127.0.0.1:8000 { flush_interval -1 }
  }
  @embed {
    path /api/embed /api/embeddings /api/tags
    header Authorization "Bearer $API_KEY"
  }
  handle @embed {
    reverse_proxy 127.0.0.1:11434 { header_up Host {upstream_hostport} }
  }
  handle /healthz { respond "ok" 200 }
  handle { respond "not found" 404 }
}
CADDY
systemctl restart caddy
cat > /etc/repurpora-endpoint <<ENV
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://$SITE/v1
OPENAI_API_KEY=<the VLLM_API_KEY you provisioned with>
LLM_MODEL_PRIMARY=qwen2.5-7b-instruct
LLM_MODEL_FAST=qwen2.5-7b-instruct
OLLAMA_BASE_URL=https://$SITE      # embeddings only
OLLAMA_PROXY_TOKEN=<same key>
ENV
