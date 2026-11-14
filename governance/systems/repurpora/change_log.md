# Change log (model swaps and prompt changes)

| Date | Change | Reason | Evidence |
|---|---|---|---|
| 2026-11-14 | Replaced the CrewAI prototype with a LangGraph master/worker graph | PS alignment; the old system made no LLM calls | backend/tests, evals/results |
| 2026-11-14 | LLMs: Mistral-7B GGUF -> qwen2.5 7B/3B via Ollama behind a bearer proxy | Tool and JSON-schema reliability | evals/results/latest.md |
| 2026-11-14 | Embeddings: padded-Mistral 1536-d -> nomic-embed-text 768-d | Real semantic retrieval | evals/results/rag_bench.md |
| 2026-11-14 | Evidence coverage gate 0.80 -> 0.75 | 3B judge + strict sentence splitter over-triggered redrafts | golden-set run |
| 2026-11-14 | Off-topic guard risk 0.5 -> 0.6 (now blocks) | Unit test showed off-topic requests passing | backend/tests/test_units.py |
| 2026-11-14 | Synthetic patent generator: older compound patents, fewer active secondaries | Off-patent generics were showing FTO 10/10 | API e2e run |
| 2026-11-14 | Post-hoc citation attribution + routing floor + section-aware synthesis prompt | v1 golden set: evidence coverage 0.29, Q04 mis-routed | evals/results/baseline_v1.md vs latest.md |
| 2026-11-14 | Memory layer v2: versioned facts, stale flags, relevance ranking, region profile, "show"/"forget" commands | Memory audit: overwrites lost history; no user control | backend/tests/test_graph.py |
| 2026-11-14 | Universal coverage: any molecule (live CT.gov enrichment), 11 canonical regions, OpenAI-compatible provider option, non-English queries | Prototype only covered 8 curated molecules and India/US | backend/tests/test_units.py |
| 2026-11-14 | ML scorer v2: dataset card, EDA, leakage drop, feature engineering, out-of-time split, baselines, CV search, one-SE rule, calibration, cost-based threshold, expected-output regression test | v1 was a single script with no EDA, baselines or persisted splits | backend/src/repurpora/ml/reports/model_report.md |
| 2026-11-14 | Archive SQL agent + `archive_reader` role with RLS | Archived reports could not be queried from chat; a validator-only design had a comma-join bypass found in review | backend/tests/test_sql_agent.py |
| 2026-11-14 | Admin panel + runtime config (kill switch, model/gate/agent toggles) | Settings required redeploys; no operator view of usage, cost or quality | backend/tests/test_admin_mcp.py |
| 2026-11-14 | Outbound MCP server (OAuth 2.1 resource server via Supabase) | Let external MCP clients reuse the research tools; internal calls stay in-process | backend/tests/test_admin_mcp.py |
| 2026-11-15 | Latency work: deterministic notes, planner fast path, single judge call, concise brief budget (150+30 words) | p50 ~127 s on laptop GPU | evals/results/ab_*.json, docs/PERFORMANCE_AND_INFERENCE.md |
| 2026-11-15 | Rejected: 3B redraft of 7B draft | coverage 0.71 -> 0.37 in A/B | evals/results/ab_hybrid_7b_draft_3b_redraft.json |
| 2026-11-15 | Agent as MCP client: admin MCP server registry, per-chat opt-in Tools menu, `mcp` worker (SSRF guard, vault-named secrets, schema-filtered args, 3-call budget, sanitised external evidence), MCP service token | Let the agent use client-provided MCP data sources | backend/tests/test_mcp_client.py |
| 2026-11-15 | Fix: key-data tables cited agent names instead of evidence ids | Found during the MCP e2e test | backend/tests/test_graph.py |
