# Memory Proxy Integration Guide

This document translates the high-level plan into concrete implementation steps for a Codex agent. Follow the tasks in order and reuse the existing Tutor-GPT utilities wherever possible.

## 1. Share the Honcho client setup
1. Create a new module `memory-proxy/src/honchoClient.ts` that re-exports the cached helpers from `utils/honcho.ts` so the proxy can consume the same configuration without duplicating logic.
   - Import `honcho`, `getHonchoApp`, and `getHonchoUser` directly from `@/utils/honcho`. These helpers already memoize the app/user lookups and apply the retry/timeout defaults Tutor-GPT expects.【F:utils/honcho.ts†L1-L32】
   - The new module should export the same names so the Node entrypoint can `import { honcho, getHonchoApp, getHonchoUser } from './honchoClient.js'`.
   - Ensure the proxy build step understands the `@/*` path alias by extending the existing `tsconfig.json` (or creating a local `tsconfig.json` in `memory-proxy/`) with `"paths": { "@/*": ["../*"] }` so Node-based tooling can resolve Tutor-GPT modules.【F:tsconfig.json†L2-L24】

## 2. Port Tutor-GPT conversation helpers
1. Add an index barrel inside `memory-proxy/src/conversation.ts` that re-exports `fetchConversationHistory`, `saveConversation`, `MAX_CONTEXT_SIZE`, and `SUMMARY_SIZE` from `@/utils/ai/conversation`. These functions encapsulate how Tutor-GPT loads/saves Honcho history and must remain the single source of truth.【F:utils/ai/conversation.ts†L1-L133】【F:utils/ai/conversation.ts†L135-L200】
2. When the proxy boots, call `getHonchoApp()` once and cache the result in module scope so every request only fetches the Honcho app when the cache expires.
3. During each `/v1/chat/completions` request, fetch the latest message/thought/honcho/pdf streams plus the summary and collection information by calling `fetchConversationHistory(appId, userId, conversationId)`.

## 3. Adopt the thought → memory → response pipeline
1. Import `buildThoughtPrompt` and `buildResponsePrompt` from `@/utils/ai/prompts` and `streamText` from `@/utils/ai` to mirror the Next.js chat flow.【F:utils/ai/index.ts†L1-L167】
2. After loading history, assemble the thought prompt and start `streamText` with `metadata` containing `{ sessionId, userId, type: 'thought' }`. Parse the streamed chunks exactly like Tutor-GPT does, respecting the `␁` delimiters to split the main thought, Honcho query, and PDF query sections.【F:utils/ai/index.ts†L35-L115】
3. Invoke `honcho.apps.users.sessions.chat(appId, userId, conversationId, { queries: honchoQuery })` with the generated Honcho query to retrieve the memory augmentation that Tutor-GPT expects before the response pass.【F:utils/ai/index.ts†L116-L143】
4. If files are uploaded (or a `collectionId` already exists), reuse the PDF handling logic from `utils/ai/index.ts` to maintain RAG behaviour—create/update collections, add documents, and call `collectionChat` to generate the PDF context snippet.【F:utils/ai/index.ts†L144-L235】
5. Build the final response prompt with `buildResponsePrompt(...)`, call `streamText` again with `{ type: 'response' }`, and stream the assistant deltas back to OpenWebUI while buffering the full assistant reply for persistence.【F:utils/ai/index.ts†L236-L300】

## 4. Persist turns and manage summaries
1. After the assistant produces a user-visible reply (i.e. no `tool_calls` in the final OpenAI payload), call `saveConversation` with the captured user message, thought, Honcho content, PDF content, and assistant response so Honcho receives the same metamessages Tutor-GPT stores.【F:utils/ai/conversation.ts†L135-L200】
2. Await `checkAndGenerateSummary(appId, userId, conversationId, summaryHistory, messageHistory)` once the turn is persisted so summaries stay aligned with Tutor-GPT.【F:utils/ai/index.ts†L260-L302】

## 5. Implement the OpenAI-compatible surface
1. Keep the existing Express/Fastify (or custom) HTTP server in `memory-proxy/server.mjs`, but migrate the logic into TypeScript/ESM modules under `memory-proxy/src/`. The entrypoint should:
   - Validate `Authorization: Bearer <PROXY_API_KEY>`.
   - Map `X-User-Id` and `X-Session-Id` headers (or deterministic fallbacks) to Honcho IDs.
   - Forward `model`, `messages`, and optional `stream` flags to the response pipeline described above.
2. Reuse Tutor-GPT's streaming helper `formatStreamChunk` to transform internal chunk events into OpenAI delta objects that OpenWebUI understands.【F:utils/ai/index.ts†L20-L103】
3. Preserve tool-call awareness: if the upstream model responds with `tool_calls`, stream them through immediately but skip persistence until a natural-language assistant message arrives.

## 6. Configuration and dependencies
1. Reuse the `memory-proxy/README.md` environment contract. Ensure the new modules respect `HONCHO_URL`, `HONCHO_APP_NAME`, `HONCHO_API_KEY`, `OPENROUTER_API_KEY`, and `PROXY_API_KEY`.【F:memory-proxy/README.md†L1-L80】
2. Add any new runtime dependencies (e.g. `honcho-ai`, `eventsource-parser`, `undici`) to `package.json` only if they are not already declared.
3. Provide an npm script (`"memory-proxy": "tsx memory-proxy/src/server.ts"`) so `pnpm memory-proxy` continues to launch the proxy after the refactor.

## 7. Verification checklist
1. **Unit/Integration tests:** Add targeted Vitest tests (or a local harness) that mock Honcho and OpenRouter to exercise the full thought → memory → response cycle. Ensure streaming chunks conform to OpenAI's SSE protocol.
2. **Manual validation:** Launch the proxy locally (`pnpm memory-proxy`) and register it inside OpenWebUI via *Admin ▸ Connections* as an OpenAI backend pointing at `http://localhost:8081/v1`. Confirm that:
   - Conversations stream correctly in the WebUI.
   - Honcho's dashboard shows matching messages/metamessages.
   - Summaries roll over after `MAX_CONTEXT_SIZE` turns.
3. **Health checks:** Verify `GET /health` returns `200 OK` once the proxy finishes its initial Honcho app bootstrap.

Following these steps will align the memory proxy with Tutor-GPT's production pipeline while keeping the surface area compatible with OpenWebUI.
