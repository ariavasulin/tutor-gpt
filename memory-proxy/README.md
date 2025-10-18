# Tutor-GPT Memory Proxy

This service exposes an OpenAI-compatible `/v1/chat/completions` endpoint that injects Honcho-backed
memory into every turn, proxies completions to OpenRouter, and persists the resulting conversation
state back to Honcho. It lets OpenWebUI use Tutor-GPT's identity and memory model while keeping its
own RAG pipeline intact.

## Features
- Authenticates OpenWebUI requests with a shared `PROXY_API_KEY`.
- Reconstructs the Tutor-GPT identity graph on demand (app → user → session).
- Fetches Honcho memory via `apps.users.sessions.chat` and injects it as an additional system
  message before forwarding the request to OpenRouter (the injected context never surfaces back to
  OpenWebUI).
- Streams responses back to OpenWebUI while collecting the assistant's text for persistence.
- Saves user/assistant messages plus the relevant Honcho and RAG ("kb") metamessages, and emits a
  light-weight rolling summary every few turns.
- Detects reasoning/tool-call turns and waits to persist history until the model produces a
  user-facing assistant reply.

## Prerequisites
- Node.js 18+
- Honcho hosted tenant + API key
- OpenRouter API key
- OpenWebUI running locally (e.g. `http://localhost:3000`)

## Configuration
Copy the example environment file and update the values for your deployment:

```bash
cp memory-proxy/.env.example memory-proxy/.env
```

| Variable | Description |
| --- | --- |
| `PORT` | Port for the proxy server (defaults to `8081`). |
| `PROXY_API_KEY` | Shared secret expected in `Authorization: Bearer <token>` from OpenWebUI. |
| `ALLOW_ORIGINS` | Comma separated list of origins that should receive CORS headers. |
| `HONCHO_URL` | Base URL for your hosted Honcho instance. |
| `HONCHO_APP_NAME` | Honcho app name to create/use for Tutor-GPT memory. |
| `HONCHO_API_KEY` | Honcho API key with access to the tenant. |
| `OPENROUTER_API_KEY` | OpenRouter API key used for upstream completions. |
| `OPENROUTER_BASE_URL` | Base URL for OpenRouter's API (defaults to `https://openrouter.ai/api/v1`). |

## Running locally

```bash
pnpm install
pnpm memory-proxy
```

The proxy listens on `http://localhost:8081` by default. Configure OpenWebUI's OpenAI-compatible
provider to point at `http://localhost:8081/v1` and use the same `PROXY_API_KEY` value you placed in
`.env`.

### Tool-call aware persistence

Reasoning models that loop through tools emit `tool_calls` before they produce a natural-language
answer. The proxy forwards those instructions to OpenWebUI unchanged, but it deliberately skips
persisting the turn to Honcho until the assistant sends a user-visible reply (i.e., no
`tool_calls` present in the completion). This keeps Honcho's transcript aligned with what users see
in OpenWebUI while still giving the model access to the retrieved memory during intermediate tool
steps.

## Health check
A simple `GET /health` endpoint returns `200 OK` once the server is ready. This is useful for local
Docker setups or supervisor checks.
