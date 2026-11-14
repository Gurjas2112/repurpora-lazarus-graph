# Performance, multimodal RAG, fine-tuning and production inference: decisions with evidence

Every recommendation below is backed by a measurement from this repo. The raw A/B result files are in
`backend/evals/results/ab_*.json`.

---

## 1. Response time: where it went and what was changed

### 1.1 Profile (from `llm_usage` telemetry, prototype GPU = RTX 3060 Laptop, 6 GB)

| Stage | Model | Median time | Calls per query | Root cause |
|---|---|---|---|---|
| Synthesizer | qwen2.5 7B | 42 s | ~1.9 (draft + redraft) | 7B does not fit in 6 GB: **21% offloaded to CPU**, 28 tok/s |
| Judge | qwen2.5 3B | 8 s (mean 21 s, runaway outputs) | ~1.9 | Ran on drafts that were going to be discarded anyway |
| Planner | qwen2.5 7B | 14 s | 1 | Structured output, plus a model swap |
| Worker notes | qwen2.5 3B | 5 s each | 6, run one after another on one GPU | Decorative LLM summaries of numbers we already had |
| Model swaps | – | 5–9 s each | ~5 | 7B and 3B can't be resident together in 6 GB |

GPU benchmark (`/tmp/bench_llm.py`, 500-token generation):

| Model | Context | Placement | Decode speed | Load time |
|---|---|---|---|---|
| 7B | 8k | 21% CPU / 79% GPU | 27.9 tok/s | 8.7 s |
| 7B | 4k | 18% CPU / 82% GPU | 34.5 tok/s | 6.6 s |
| 3B | 8k / 4k | 100% GPU | 121 tok/s | 3–5 s |

Redraft value (audit log, 37 threads): first-pass coverage median **0.50 → 0.74** after redraft, and no redraft made
coverage worse. **Redrafting stays.**

### 1.2 Changes shipped

| Change | Effect |
|---|---|
| Deterministic worker notes built from computed metrics (`WORKER_LLM_NOTES=false`) | −6 LLM calls per query; notes can't hallucinate |
| Planner fast path for unambiguous queries (curated molecule or named therapy area; indication, abbreviation and angle extraction) | −1 LLM call and −1 model swap on most queries; ambiguous queries and follow-ups still use the LLM |
| LLM judge only on the final draft (redraft decided by deterministic coverage) | −1 judge call per redrafted query |
| Output caps per role (judge 400, fast 512, primary 1,400 tokens) | Removed 1,000+ token runaway judge outputs |
| **Concise brief budget** (150 + 30 words per agent, was 220 + 45) | Fewer decode tokens and higher coverage |

### 1.3 A/B on 6 golden questions (Q02, Q03, Q04, Q07, Q09, Q11), cold cache

| Configuration | p50 | p95 | Evidence coverage | Faithfulness | Routing / keywords | Verdict |
|---|---|---|---|---|---|---|
| Before this work | ~127 s | 159 s | 0.73 | – | 1.0 / 1.0 | baseline |
| New code, 7B writer + 3B judge, old budget | 120 s | 128 s | 0.71 | 2.7 | 1.0 / 1.0 | small gain |
| **New code + concise budget (shipped default)** | **94 s** | **112 s** | **0.74** | 2.8 | 1.0 / 1.0 | **adopted** |
| All-3B (one model, 100% GPU, no swaps) | 34 s | 45 s | 0.56 | 2.8 | 1.0 / 1.0 | 3.6× faster but fails the 0.75 gate |
| 7B draft + 3B redraft | 73 s | 80 s | 0.37 | 2.8 | 1.0 / 1.0 | **rejected**: the 3B repair degrades the 7B draft |

**Conclusion.** On a 6 GB laptop GPU the remaining latency is hardware-bound: the 7B decodes at about 28 tok/s because
it partly runs on the CPU. Admins can switch to an **all-3B "fast mode"** at runtime (Admin → Models & safety →
primary model `qwen2.5:3b-instruct`) for demos where speed matters more than citation density. The real fix is a GPU
that holds the 7B entirely (§4), plus optionally a fine-tuned small model (§3).

---

## 2. Is multimodal RAG required? **No, not now. Add targeted ingestion for slide decks later.**

Corpus measurement (`pypdf` text extraction, first 120 pages per document):

| Document type | Pages | Pages with < 200 characters of text |
|---|---|---|
| Books and papers (6 documents) | 397 | 3–8% |
| Slide deck (PhD presentation) | 45 | **53%** |
| Image-heavy paper (Shao Jun) | 35 | 23% |
| Synthetic strategy deck, field report, MINS | 3 | 0% |
| **Total** | **502** | **11%** |

- The problem statement's questions are answered from **structured tool data** (market, trade, patents, trials) plus
  text. Retrieval quality on text is already high (Hit@5 = 1.00, MRR 0.89; `evals/results/rag_bench.md`).
- The gap is **slide decks and figures**, which matters because real "strategy decks" are slides.

**Recommendation (phase 2, cheapest first):**
1. **PPTX ingestion** (python-pptx text, notes and tables). Today `.pptx` is skipped entirely.
2. **Table-aware PDF parsing** (Docling or Unstructured) for papers with tables.
3. **Caption-then-embed** for low-text pages only. At ingestion, a vision LLM (for example `qwen2.5-vl:7b` on the same
   inference host) writes a factual description of the page or figure. That text is embedded into the *existing*
   768-d index with `modality=image_caption` provenance.
   - Keeps one index, one retriever and the existing evidence layer.
   - Costs about 11% of pages × one VLM call, at ingestion only.
4. **True multimodal retrieval** (ColPali-style page-image embeddings, or a CLIP image index) **only if** a golden set
   of *figure-dependent* questions shows caption-then-embed failing (target Hit@5 below 0.8 on that set). Examples:
   "what does the dissolution curve on slide 12 show", or chemical-structure similarity.

Decision trigger to revisit: low-text pages above 25% of the corpus, or more than 10% of user questions referencing
slides or figures (tracked through feedback and the audit log).

---

## 3. Is LLM fine-tuning required? **No, not for correctness. Yes, later, as a latency optimisation.**

What the evaluations say:

| Failure mode | Evidence | Does fine-tuning fix it? |
|---|---|---|
| Missing domain knowledge | None. Facts come from tools and RAG; keyword groundedness is 1.00 | No. Retrieval handles this, and fine-tuning facts in would go stale |
| Routing / molecule extraction | 1.00 / 1.00 | Not needed |
| Citation discipline | First-pass coverage 0.50; the 3B reaches 0.56 even after redraft | **Yes**: a formatting and behaviour skill, which is exactly what SFT teaches |
| Faithfulness | Judge about 2.8/5 (strict 3B judge) | Partly; preference tuning (DPO) helps |

**Plan: distil the 7B's cited-writing behaviour into the 3B, so the fast profile clears the gate.**
1. **Data.** Run the 7B teacher over generated queries (molecule × region × angle × agent subsets from the mock
   sources). Keep only outputs with coverage ≥ 0.85 and judge ≥ 4, and dedupe. Target 1,000–3,000 pairs of
   (evidence register + question) → cited brief. Add real user threads with positive feedback (`feedback` table,
   LangSmith datasets) once there's traffic.
2. **Training.**
   - Method: QLoRA, rank 16–32, 2–3 epochs, on `Qwen2.5-3B-Instruct` (also try 7B).
   - Tooling: TRL or Unsloth on one 24 GB GPU (g6.xlarge / g5.xlarge), or a SageMaker training job.
   - Run time: hours, not days.
3. **Preference step (optional).** DPO on pairs ranked by the deterministic coverage score and the judge.
4. **Gate** (`governance/policies/risk_appetite.yaml`): ship only if the golden set holds coverage ≥ 0.75,
   citation accuracy ≥ 0.95, guardrail block rate 1.0, and shows no routing regression.
5. **Serving.**
   - Ollama: export a GGUF adapter and reference it with `ADAPTER` in a Modelfile.
   - vLLM: `--enable-lora`. The model is selectable at runtime from the admin panel, so A/B in production needs no deploy.

Expected payoff: the all-3B profile is already **3.6× faster** (34 s vs 120 s). Fine-tuning targets its one failing metric.

Not recommended: fine-tuning embeddings, since retrieval is already at Hit@5 1.00 on the benchmark; or full fine-tunes.

---

## 4. Production LLM inference on AWS: is Ollama sound, and how to do it

**Ollama is sound for a pilot** (one team, under about 5 concurrent research runs). It's simple, it's the engine the
prototype already uses, and it runs GGUF quantisations.

**For production, use vLLM.** Ollama processes few requests concurrently and has limited batching. A Repurpora run
makes several LLM calls, and concurrent users would queue behind each other. vLLM's continuous batching and
PagedAttention give much higher throughput on the same GPU. It also exposes the **OpenAI API**, which Repurpora
already supports (`LLM_PROVIDER=openai`), so the switch is configuration only.

| Phase | Engine | Instance | Notes |
|---|---|---|---|
| Pilot | Ollama (current scripts) | g6.xlarge (L4 24 GB) or g4dn.xlarge (T4 16 GB, budget) | 7B fully on GPU (no CPU offload); `ENGINE=ollama` |
| Production | **vLLM** `v0.10.1` + Qwen2.5-7B-Instruct-AWQ, prefix caching, up to 32 sequences | g6.xlarge / g5.xlarge; scale out behind an ALB | `ENGINE=vllm infra/aws/ec2_ollama.sh` (script + user-data in repo, dry-run tested on LocalStack) |
| Managed alternative | SageMaker real-time endpoint (LMI/vLLM container) or Bedrock Custom Model Import (Qwen, pay per token) | managed | No GPU host management; check regional availability and pricing |

**Projected latency.** Once the 7B is fully on a GPU its decode is no longer CPU-limited. Measured here: the 3B fully
on GPU runs 4.3× faster than the offloaded 7B. Expect the shipped quality profile to land at roughly **35–50 s**
end-to-end, versus 94 s on the laptop. This is a projection: verify it with `evals/run_evals.py` against the new endpoint
before committing to an SLO.

### Step by step
1. **Account and quota.**
   - `aws login` (region ap-south-1).
   - In Service Quotas, request **"Running On-Demand G and VT instances"** ≥ 4 vCPUs. New accounts start at 0.
2. **Provision.**
   ```bash
   OLLAMA_PROXY_TOKEN=$(openssl rand -hex 24) ENGINE=vllm INSTANCE_TYPE=g6.xlarge infra/aws/ec2_ollama.sh
   ```
   The script prints `LLM_PROVIDER=openai OPENAI_BASE_URL=https://<ip>.sslip.io/v1` (TLS via Caddy). The host enforces
   IMDSv2, an encrypted gp3 volume, and ports 80/443 only.
3. **Point the app at it.** Set these Railway variables on `agent-server` and `mock-apis`:
   - `LLM_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`
   - `LLM_MODEL_PRIMARY` and `LLM_MODEL_FAST`, both `qwen2.5-7b-instruct`
   - `OLLAMA_BASE_URL` and `OLLAMA_PROXY_TOKEN`, used for embeddings only
4. **Validate.** Run the golden-set eval against the endpoint. It must meet `risk_appetite.yaml`, and the latency SLO
   comes from its p95.
5. **Harden for production.**
   - Move `agent-server` into the same AWS VPC (ECS on Fargate). Put the GPU hosts in private subnets behind an
     internal ALB, so the LLM is never public.
   - Secrets go in AWS Secrets Manager. The code already reads it; just unset `AWS_ENDPOINT_URL`.
   - Use an Auto Scaling group on GPU utilisation and queue depth, with min 1; or a SageMaker endpoint with autoscaling.
   - Bake model weights into the AMI, or pull from S3, to avoid cold starts from the internet.
   - Observability: CloudWatch agent + DCGM GPU metrics; LangSmith and `llm_usage` for tokens and latency.
   - Cost: stop non-production hosts out of hours (`infra/aws/teardown.sh`), set budget alarms, and use on-demand for
     production (Spot only for batch ingestion and evals).
6. **Rollback.** `LLM_PROVIDER=ollama` with the previous endpoint, or flip the model in the admin panel.
   No redeploy is needed for model changes.
