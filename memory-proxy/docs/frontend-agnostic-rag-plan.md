# Frontend-Agnostic Memory Proxy & Semantic Retrieval Strategy

## Goals
- Allow any OpenAI-compatible frontend (OpenWebUI, custom dashboards, CLI tools) to use the memory proxy without code changes.
- Preserve Tutor-GPT's Honcho-backed memory pipeline (sessions, summaries, metamessages) regardless of frontend choice.
- Support deliberate Retrieval-Augmented Generation (RAG) via semantic search tools that can sync document knowledge between OpenWebUI and Honcho.
- Keep document management simple for operators while avoiding duplicated storage or stale indexes.

## Core Components
- **Memory Proxy**: Continues to expose `/v1/chat/completions` and `/health`, handling Honcho persistence, summary management, and OpenAI-compatible streaming.
- **Semantic Retrieval Service (SRS)**: A connector layer (could be an MCP tool service) that indexes markdown/HTML assets, performs hybrid search, and exposes tool-call endpoints (`semantic.search`, `semantic.ingest`, `semantic.delete`).
- **Honcho Sync Bridge**: Maintains mappings between external knowledge bases (OpenWebUI Knowledge, custom CMS collections, MCP indexes) and Honcho collections so Tutor-GPT metadata stays authoritative.
- **Frontend Adapters**: Thin shims for OpenWebUI, custom GUIs, or automation scripts that translate their RAG references into semantic search tool invocations or Honcho collection IDs.

## End-to-End Flow
1. **Document Onboarding**
   - Frontends push markdown files to the Semantic Retrieval Service (SRS) using their preferred UI/API.
   - SRS stores canonical assets, chunks text for embedding, and publishes change events.
   - Honcho Sync Bridge listens to change events (or polls) and mirrors the content into Honcho collections, storing `{sourceId, checksum}` metadata to detect drift.

2. **Conversation Request**
   - Any OpenAI-compatible client calls the memory proxy.
   - Request includes optional `tools` invocations (for MCP) or context identifiers (e.g., `knowledgeBaseId`).
   - Memory proxy resolves user/session with Honcho, reconstructs history, and determines whether it must fetch fresh context.

3. **Deliberate Retrieval**
   - If the model issues a tool call (e.g., `semantic.search`), the proxy forwards it to the SRS/MCP endpoint, streams results back as tool outputs, and logs the interaction for Honcho.
   - For passive retrieval (e.g., knowledge base attached), the proxy asks the Honcho Sync Bridge for the current collection ID so `collectionChat` can generate context snippets.

4. **Response Synthesis**
   - Memory proxy assembles thought and response prompts, blending Honcho summary/history with retrieved snippets from tool outputs or Honcho collections.
   - Streams assistant deltas to the frontend while buffering the full reply for persistence.

5. **Persistence & Summaries**
   - The proxy saves the turn (user message, thought, tool outputs, external context, assistant reply) via `saveConversation`.
   - After each turn, it triggers `checkAndGenerateSummary` and records knowledge source metadata in Honcho so downstream analytics can audit which documents influenced the answer.

## Optional MCP Alignment
- Implement the Semantic Retrieval Service as an MCP-compliant tool host exposing:
  - `semantic.ingest({ sourceId, files[] })`
  - `semantic.search({ sourceId, query, topK })`
  - `semantic.delete({ sourceId, fileIds[] })`
- OpenWebUI (or any MCP-capable frontend) uses these tools to manage documents and request context, ensuring the same contract works for CLI agents or custom dashboards.
- The memory proxy watches for tool outputs and either:
  - Stores them directly in Honcho as metamessages, or
  - Mirrors them into Honcho collections for subsequent passive retrieval.

## Deployment Considerations
- **Config**: Add environment knobs for SRS base URL/API key and optional MCP transport (WebSocket vs HTTP).
- **Caching**: Cache Honcho collection mappings (`{sourceId, collectionId, checksum}`) with TTL + ETag validation to avoid redundant syncs.
- **Security**: Propagate per-user access control from frontend to SRS and Honcho, ensuring only authorized sessions can query or modify collections.
- **Observability**: Expose metrics for sync latency, collection sizes, semantic search latency, and tool-call success rates.

## Using OpenWebUI Knowledge as a Honcho-Only Frontend
If we want the Knowledge UI to behave purely as a management surface while Honcho provides the RAG engine, follow this mode:

1. **Disable OpenWebUI Retrieval**
   - Turn off background embedding/jobs for Knowledge (set `KNOWLEDGE_ENABLE_RAG=false` or remove the vector DB client) so Knowledge stops serving its own search results.
   - Intercept Knowledge chat hooks to prevent OpenWebUI from injecting its snippets into the user prompt; the proxy will supply context after Honcho sync.

2. **Sync Knowledge → Honcho Collections**
   - Reuse the Semantic Retrieval Service or a lightweight sync worker that watches `knowledge`, `knowledge_files`, and `files` tables via polling or database triggers.
   - For each Knowledge base, upsert a mirrored Honcho collection whose metadata stores `{ knowledgeId, version, fileHashes }` so the proxy can reuse it across sessions.
   - When files change, pull the processed Markdown (no PDF parsing needed), chunk it, and push updates to Honcho documents; remove documents for deleted files.

3. **Proxy Flow Adjustments**
   - When a request references a Knowledge base, resolve the Honcho collection ID via the sync metadata and skip OpenWebUI’s native RAG branch.
   - Continue running the thought → memory → response pipeline so Honcho augmentation and summaries stay aligned with Tutor-GPT.
   - Persist the Knowledge identifiers in metamessages so dashboards show which curated corpus contributed to each answer.

4. **Operational UX**
   - Operators keep the familiar Knowledge GUI for uploads, tagging, and deletion while Honcho remains the execution backend.
   - Honcho dashboards reflect document usage, enabling search/debugging across sessions without fragmenting storage.
   - Because OpenWebUI no longer surfaces retrieval results, add status indicators or health checks that confirm the sync worker has mirrored the latest Knowledge changes into Honcho.

## Next Steps
1. Build the SRS/MCP facade with markdown ingest + hybrid search endpoints.
2. Extend the memory proxy with a knowledge sync manager that bridges SRS sources to Honcho collections.
3. Teach the `/v1/chat/completions` handler to negotiate context acquisition: passive (pre-attached collections) vs active (tool calls).
4. Update documentation to describe frontend-agnostic workflows, authentication, and monitoring.
