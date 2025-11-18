# OpenWebUI Integration Guide for Tutor-GPT

## TL;DR - Is It Possible?

**YES! It's already implemented and ready to use.** 🎉

The tutor-gpt codebase includes a **memory-proxy** that provides an **OpenAI-compatible API** specifically designed for OpenWebUI integration. You can connect OpenWebUI to the full Tutor-GPT backend (including the Empath+Bloom two-agent system and Honcho memory) right now.

---

## What You Get

When you connect OpenWebUI to the tutor-gpt memory-proxy, you get:

✅ **Full Tutor-GPT Intelligence**
- Empath agent (theory-of-mind reasoning)
- Bloom agent (Socratic tutoring)
- Honcho memory persistence across conversations
- Automatic conversation summaries
- PDF upload support with semantic search

✅ **OpenWebUI Features Preserved**
- Your existing OpenWebUI interface
- File uploads (PDFs processed via Honcho collections)
- Streaming responses
- Multi-user support
- OpenWebUI's UI/UX

✅ **Seamless Integration**
- OpenAI-compatible API (`/v1/chat/completions`)
- Server-Sent Events (SSE) streaming
- Tool-call awareness
- CORS support
- Health checks

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpenWebUI (Frontend)                     │
│                  User Interface & File Handling                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP POST /v1/chat/completions
                             │ (OpenAI-compatible format)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Memory Proxy (Port 8081)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. Authenticate (Bearer token)                           │   │
│  │ 2. Map OpenWebUI user → Honcho user                      │   │
│  │ 3. Fetch conversation history from Honcho                │   │
│  │ 4. Run Empath agent (generate queries)                   │   │
│  │ 5. Query Honcho memory (semantic search)                 │   │
│  │ 6. Query PDF collections (if files uploaded)             │   │
│  │ 7. Run Bloom agent (generate response)                   │   │
│  │ 8. Stream response to OpenWebUI                          │   │
│  │ 9. Persist to Honcho (messages + metamessages)           │   │
│  │ 10. Generate summaries (every 11 messages)               │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP (Honcho SDK)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Honcho (Memory Backend)                     │
│   - User/Session/Message storage                                │
│   - Metamessages (thoughts, memory, PDF context)                │
│   - Collections (PDF semantic search)                           │
│   - Conversation summaries                                      │
└─────────────────────────────────────────────────────────────────┘
                             │ HTTP (OpenRouter API)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    OpenRouter (LLM Provider)                     │
│              Claude, GPT-4, or other models                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Environment Setup

Create `memory-proxy/.env`:

```bash
# Server Configuration
PORT=8081
PROXY_API_KEY=your-secure-shared-secret-here

# CORS (comma-separated origins or * for all)
ALLOW_ORIGINS=http://localhost:3000,http://localhost:8080

# Honcho Configuration
HONCHO_URL=https://your-honcho-instance.com
HONCHO_APP_NAME=tutor-gpt
HONCHO_API_KEY=your-honcho-api-key

# LLM Provider (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Optional: AI Provider Override
# AI_PROVIDER=openrouter
# AI_API_KEY=your-api-key
# AI_BASE_URL=https://custom-endpoint.com/v1
# MODEL=anthropic/claude-3.5-sonnet
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Start the Memory Proxy

```bash
pnpm memory-proxy
```

The proxy will start on `http://localhost:8081` (or your configured port).

**Health Check**:
```bash
curl http://localhost:8081/health
# Expected: {"status":"ok"}
```

### 4. Configure OpenWebUI

#### Option A: Admin Panel Configuration

1. Open OpenWebUI (e.g., `http://localhost:3000`)
2. Navigate to **Admin → Settings → Connections**
3. Add a new **OpenAI API** connection:
   - **Name**: "Tutor-GPT Memory"
   - **Base URL**: `http://localhost:8081/v1`
   - **API Key**: `your-secure-shared-secret-here` (same as `PROXY_API_KEY`)
4. Save and test the connection

#### Option B: Environment Variables (Docker)

If running OpenWebUI via Docker, add these environment variables:

```bash
docker run -d \
  --name openwebui \
  -p 3000:8080 \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:8081/v1 \
  -e OPENAI_API_KEY=your-secure-shared-secret-here \
  ghcr.io/open-webui/open-webui:main
```

### 5. Start Chatting!

In OpenWebUI:
- Select the Tutor-GPT model
- Start a conversation
- The memory-proxy will handle all Honcho integration automatically
- Your conversations are persisted with full Tutor-GPT memory capabilities

---

## Features in Detail

### 🧠 Two-Agent System (Empath + Bloom)

**What happens behind the scenes:**

1. **Empath Agent** analyzes your message using theory of mind:
   - Generates semantic queries for Honcho memory
   - Determines what context the tutor needs
   - Generates PDF queries if documents are available

2. **Honcho Semantic Search** retrieves personalized context:
   - User preferences and learning style
   - Previous topics discussed
   - Deductive insights about the user

3. **Bloom Agent** generates the response:
   - Uses Socratic questioning techniques
   - Personalizes based on Honcho context
   - Always ends with a topically relevant question

**All of this is invisible to OpenWebUI** - it just sees the final response stream.

### 📄 PDF Upload Support

Upload PDFs through OpenWebUI:
- Files are automatically parsed and stored in Honcho collections
- Semantic search retrieves relevant content
- Max 5MB per file, 5MB total per conversation
- Each page stored as a separate searchable document

### 💾 Persistent Memory

Every conversation is stored in Honcho with:
- **Messages**: User and assistant messages
- **Metamessages**:
  - `thought` - Empath's internal reasoning
  - `honcho` - Memory context retrieved
  - `pdf` - PDF content used
  - `summary` - Rolling conversation summaries
  - `collection` - Active PDF collection IDs

### 📝 Automatic Summaries

Every 11 messages (configurable via `MAX_CONTEXT_SIZE`):
- First 5 messages are summarized
- Summary stored as a metamessage
- Used to maintain long-term context

### 🔄 Streaming Support

Real-time streaming via Server-Sent Events (SSE):
- Chunks sent as they're generated
- OpenAI-compatible format
- No buffering delay

### 🛠️ Tool-Call Awareness

For reasoning models that use tools:
- Tool calls streamed to OpenWebUI immediately
- Persistence delayed until natural language response
- Keeps Honcho transcript clean and user-facing

---

## User/Session Mapping

The memory-proxy maps OpenWebUI users to Honcho identities:

### User ID Resolution (in order)
1. `X-User-Id` header (if provided by OpenWebUI)
2. `payload.user` field in request
3. Fallback: `'openwebui-user'` (single shared user)

### Session ID Resolution (in order)
1. `X-Session-Id` header (if provided)
2. Deterministic hash: `SHA256(userId:model)` (default)

This means:
- **Multi-user setup**: Each OpenWebUI user gets their own Honcho user
- **Single-user setup**: All conversations share one Honcho user
- **Sessions**: Automatically created in Honcho with `external_id` mapping

---

## Request/Response Examples

### Request from OpenWebUI

```bash
curl -X POST http://localhost:8081/v1/chat/completions \
  -H "Authorization: Bearer your-secure-shared-secret-here" \
  -H "X-User-Id: user-123" \
  -H "X-Session-Id: session-456" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-3.5-sonnet",
    "messages": [
      {
        "role": "user",
        "content": "Explain photosynthesis"
      }
    ],
    "stream": true
  }'
```

### Response (OpenAI-compatible SSE)

```json
{"id":"chatcmpl-session-456-1700000000","object":"chat.completion.chunk","created":1700000000,"model":"anthropic/claude-3.5-sonnet","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}
{"id":"chatcmpl-session-456-1700000000","object":"chat.completion.chunk","created":1700000000,"model":"anthropic/claude-3.5-sonnet","choices":[{"index":0,"delta":{"content":"Great question! Let's break photosynthesis into two main stages..."},"finish_reason":null}]}
...
{"id":"chatcmpl-session-456-1700000000","object":"chat.completion.chunk","created":1700000000,"model":"anthropic/claude-3.5-sonnet","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

---

## Advanced Configuration

### Custom Headers

OpenWebUI can pass custom headers to control behavior:

```typescript
X-User-Id: string       // Map to specific Honcho user
X-Session-Id: string    // Use specific Honcho session
X-Title: string         // Conversation title (future use)
```

### CORS Configuration

Control which origins can access the proxy:

```bash
# Allow specific origins
ALLOW_ORIGINS=http://localhost:3000,https://openwebui.example.com

# Allow all origins (development only!)
ALLOW_ORIGINS=*
```

### Model Selection

The proxy respects the `model` field from OpenWebUI:

```json
{
  "model": "anthropic/claude-3.5-sonnet",
  "messages": [...]
}
```

This is passed to OpenRouter (or your configured AI provider).

### File Upload Format

Files from OpenWebUI arrive as:

```json
{
  "files": [
    {
      "name": "document.pdf",
      "data": "base64-encoded-content"
    }
  ]
}
```

The proxy automatically:
1. Decodes base64
2. Parses PDF (or text)
3. Creates/updates Honcho collection
4. Enables semantic search

---

## Monitoring & Debugging

### Health Checks

```bash
curl http://localhost:8081/health
```

Returns:
```json
{"status":"ok"}
```

Use this for Docker healthchecks or monitoring.

### Logs

The proxy logs:
- Request authentication
- Honcho operations
- Streaming events
- Errors with stack traces

### Honcho Dashboard

View stored data in your Honcho instance:
- Browse users, sessions, messages
- Inspect metamessages (thoughts, memory, PDF context)
- Monitor collection sizes
- Audit conversation summaries

---

## Limitations & Considerations

### ⚠️ Current Limitations

1. **No OpenWebUI Knowledge Integration (yet)**
   - OpenWebUI's native Knowledge base is not automatically synced
   - See "Future: Knowledge Base Sync" below for planned implementation

2. **Single AI Provider per Proxy Instance**
   - Each memory-proxy instance uses one LLM provider (e.g., OpenRouter)
   - Model selection works, but provider is fixed

3. **File Size Limits**
   - 5MB per file
   - 5MB total per conversation
   - These are tutor-gpt limits, configurable in code

4. **Session Management**
   - Default: Deterministic hash per user+model
   - Custom: Requires OpenWebUI to pass `X-Session-Id` header

### 🔐 Security Considerations

1. **Shared Secret (`PROXY_API_KEY`)**
   - Used for all OpenWebUI requests
   - Keep this secure and rotate periodically
   - Consider per-user API keys for production

2. **CORS Origins**
   - Only allow trusted origins in production
   - Avoid `ALLOW_ORIGINS=*` in production

3. **Rate Limiting**
   - Memory-proxy does NOT include rate limiting
   - Consider adding reverse proxy (nginx, Caddy) with rate limits

4. **User Isolation**
   - Honcho enforces user-level isolation
   - Each OpenWebUI user maps to separate Honcho user
   - Sessions are scoped per user

---

## Future: Knowledge Base Sync

The codebase includes plans for syncing OpenWebUI Knowledge to Honcho:

### Architecture (Planned)

```
OpenWebUI Knowledge (PostgreSQL)
    ↓ Sync Worker (polling/triggers)
Honcho Collections (mirrored)
    ↓ Memory Proxy (semantic search)
Tutor-GPT Response (augmented with knowledge)
```

### Implementation Roadmap

1. **Disable OpenWebUI Native RAG**
   - Turn off OpenWebUI's background embedding
   - Use Knowledge UI as management interface only

2. **Sync Worker**
   - Watch `knowledge`, `knowledge_files`, `files` tables
   - Push markdown to Honcho collections
   - Store metadata: `{knowledgeId, version, fileHashes}`

3. **Proxy Integration**
   - Resolve Knowledge → Honcho collection ID
   - Use `collectionChat()` for semantic search
   - Persist knowledge references in metamessages

4. **Operator UX**
   - Keep familiar Knowledge GUI
   - Honcho provides execution backend
   - Unified analytics across OpenWebUI and native Tutor-GPT

**Status**: Documented in `memory-proxy/docs/frontend-agnostic-rag-plan.md`

---

## Troubleshooting

### "Connection refused" from OpenWebUI

**Cause**: Memory-proxy not running or wrong port

**Fix**:
```bash
# Start the proxy
pnpm memory-proxy

# Check it's listening
curl http://localhost:8081/health
```

### "Unauthorized" (401) errors

**Cause**: API key mismatch

**Fix**: Ensure `PROXY_API_KEY` in `.env` matches what OpenWebUI sends:
```bash
# In memory-proxy/.env
PROXY_API_KEY=your-secret-here

# In OpenWebUI connection settings
API Key: your-secret-here
```

### "Honcho app not found" errors

**Cause**: Honcho not configured correctly

**Fix**: Check `.env`:
```bash
HONCHO_URL=https://your-instance.com
HONCHO_APP_NAME=tutor-gpt
HONCHO_API_KEY=your-api-key
```

Test Honcho connection:
```bash
curl -H "Authorization: Bearer $HONCHO_API_KEY" \
  $HONCHO_URL/api/apps
```

### Responses not streaming

**Cause**: OpenWebUI or proxy not configured for streaming

**Fix**: Ensure OpenWebUI sends `"stream": true` in request

### Files not processing

**Cause**: PDF parsing or collection limits

**Fix**: Check logs for errors. Common issues:
- File > 5MB
- Collection > 5MB total
- Malformed PDF

---

## Development & Customization

### Running Locally

```bash
# Install dependencies
pnpm install

# Start in development mode (with auto-reload)
pnpm memory-proxy

# Or with tsx directly
pnpm tsx memory-proxy/src/server.ts
```

### Code Structure

```
memory-proxy/
├── src/
│   ├── server.ts              # Main HTTP server & routing
│   ├── honchoClient.ts        # Honcho SDK initialization
│   ├── conversation.ts        # Re-exports from utils/ai/conversation.ts
│   └── [future modules]       # Knowledge sync, MCP tools, etc.
├── docs/
│   └── frontend-agnostic-rag-plan.md  # Future architecture
├── .env.example               # Example configuration
├── IMPLEMENTATION_GUIDE.md    # Developer implementation guide
└── README.md                  # Quick start guide
```

### Extending Functionality

The memory-proxy uses the same utilities as the main Tutor-GPT app:

- **Prompts**: `utils/ai/prompts.ts` (Empath + Bloom system prompts)
- **Streaming**: `utils/ai/stream.ts` (SSE formatting)
- **Conversation**: `utils/ai/conversation.ts` (Fetch/save history)
- **PDF**: `utils/pdfChat.ts` (Collection semantic search)
- **Summaries**: `utils/ai/summary.ts` (Rolling summaries)

Any changes to these utilities affect both the Next.js app and the memory-proxy.

### Testing

```bash
# Unit tests (if implemented)
pnpm test

# Manual testing with curl
curl -X POST http://localhost:8081/v1/chat/completions \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

---

## Production Deployment

### Docker Deployment

Create `memory-proxy/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY memory-proxy ./memory-proxy
COPY utils ./utils

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Build (if needed)
# RUN pnpm build

# Expose port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8081/health || exit 1

# Start server
CMD ["pnpm", "memory-proxy"]
```

Build and run:
```bash
docker build -t tutor-gpt-memory-proxy -f memory-proxy/Dockerfile .
docker run -d \
  --name memory-proxy \
  -p 8081:8081 \
  --env-file memory-proxy/.env \
  tutor-gpt-memory-proxy
```

### Docker Compose

```yaml
version: '3.8'

services:
  openwebui:
    image: ghcr.io/open-webui/open-webui:main
    ports:
      - "3000:8080"
    environment:
      - OPENAI_API_BASE_URL=http://memory-proxy:8081/v1
      - OPENAI_API_KEY=${PROXY_API_KEY}
    depends_on:
      - memory-proxy

  memory-proxy:
    build:
      context: .
      dockerfile: memory-proxy/Dockerfile
    ports:
      - "8081:8081"
    environment:
      - PORT=8081
      - PROXY_API_KEY=${PROXY_API_KEY}
      - HONCHO_URL=${HONCHO_URL}
      - HONCHO_APP_NAME=${HONCHO_APP_NAME}
      - HONCHO_API_KEY=${HONCHO_API_KEY}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - ALLOW_ORIGINS=*
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:8081/health"]
      interval: 30s
      timeout: 3s
      retries: 3
```

Start both services:
```bash
docker-compose up -d
```

### Reverse Proxy (nginx)

```nginx
upstream memory_proxy {
    server localhost:8081;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /v1/ {
        proxy_pass http://memory_proxy;
        proxy_http_version 1.1;

        # WebSocket/SSE support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for streaming
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # Buffering (disable for SSE)
        proxy_buffering off;
    }

    location /health {
        proxy_pass http://memory_proxy;
    }
}
```

---

## Comparison: OpenWebUI Integration vs Native Tutor-GPT

| Feature | OpenWebUI + Memory Proxy | Native Tutor-GPT |
|---------|-------------------------|------------------|
| **UI/UX** | OpenWebUI interface | Custom Next.js UI |
| **Authentication** | OpenWebUI users | Supabase |
| **Subscription** | N/A (proxy is open) | Stripe integration |
| **Memory** | ✅ Full Honcho support | ✅ Full Honcho support |
| **Two-Agent System** | ✅ Empath + Bloom | ✅ Empath + Bloom |
| **PDF Upload** | ✅ Via collections | ✅ Via collections |
| **Summaries** | ✅ Automatic | ✅ Automatic |
| **Knowledge Base** | ⏳ Planned sync | N/A |
| **Thinking Display** | ❌ Hidden | ✅ Visible in UI |
| **Rate Limiting** | Manual setup | ✅ Arcjet built-in |
| **Multi-tenancy** | Via OpenWebUI | Via Supabase |

---

## FAQ

### Q: Do I need the main Tutor-GPT app running?
**A**: No! The memory-proxy is standalone. It shares utilities but runs independently.

### Q: Can I use a different LLM provider?
**A**: Yes! Configure `AI_PROVIDER`, `AI_API_KEY`, and `AI_BASE_URL` for any OpenAI-compatible API.

### Q: Will my OpenWebUI users see Empath's thoughts?
**A**: No. The thought stream is internal. OpenWebUI only sees Bloom's final response.

### Q: How do I debug what Honcho is storing?
**A**: Use your Honcho dashboard to browse users → sessions → messages/metamessages.

### Q: Can I run multiple memory-proxy instances?
**A**: Yes, for horizontal scaling. They all connect to the same Honcho instance.

### Q: Does this work with OpenWebUI's Knowledge feature?
**A**: Not yet automatically. See "Future: Knowledge Base Sync" above for planned integration.

### Q: What happens if Honcho is down?
**A**: The proxy will fail to start (on boot) or return errors (during requests). Implement retry logic or circuit breakers if needed.

### Q: Can I use this with other frontends?
**A**: Yes! Any OpenAI-compatible client can use the memory-proxy. Just point them to `http://localhost:8081/v1`.

---

## Conclusion

The tutor-gpt memory-proxy makes it **100% possible** to use OpenWebUI as a frontend for the full Tutor-GPT backend.

**Setup time**: ~10 minutes
**Complexity**: Low (just environment variables)
**Functionality**: 100% of Tutor-GPT's intelligence
**Limitations**: Minimal (knowledge sync coming soon)

Give it a try and enjoy Tutor-GPT's personalized, Socratic tutoring in your familiar OpenWebUI interface! 🚀

---

## Additional Resources

- **Memory Proxy README**: `memory-proxy/README.md`
- **Implementation Guide**: `memory-proxy/IMPLEMENTATION_GUIDE.md`
- **Future Plans**: `memory-proxy/docs/frontend-agnostic-rag-plan.md`
- **Honcho Formatting Research**: `RESEARCH_FINDINGS_HONCHO_FORMATTING.md`
- **OpenWebUI Docs**: https://docs.openwebui.com/
- **Honcho SDK**: https://github.com/plastic-labs/honcho
