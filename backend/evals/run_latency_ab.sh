#!/usr/bin/env bash
# Reproduce the latency/quality A/B in docs/PERFORMANCE_AND_INFERENCE.md (needs local Ollama + Redis).
# Each arm runs the same 6 golden questions with a cold cache; the shipped latest.json is restored afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
IDS=Q02,Q03,Q04,Q07,Q09,Q11
cp evals/results/latest.json /tmp/latest.backup.json; cp evals/results/latest.md /tmp/latest.backup.md
arm() {  # name, env...
  local name=$1; shift
  docker exec repurpora-redis-1 redis-cli FLUSHALL >/dev/null
  env "$@" PYTHONUTF8=1 uv run python evals/run_evals.py --ids "$IDS" > /dev/null
  cp evals/results/latest.json "evals/results/ab_${name}.json"
}
arm mixed_concise      X=1
arm mixed_7b_3b        SYNTH_WORDS_BASE=220 SYNTH_WORDS_PER_AGENT=45
arm all_3b             LLM_MODEL_PRIMARY=qwen2.5:3b-instruct
arm hybrid_7b_draft_3b_redraft REDRAFT_WITH_FAST_MODEL=true
cp /tmp/latest.backup.json evals/results/latest.json; cp /tmp/latest.backup.md evals/results/latest.md
echo "A/B results in evals/results/ab_*.json"
