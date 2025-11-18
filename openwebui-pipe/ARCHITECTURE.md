# Tutor-GPT OpenWebUI Pipe Architecture

## Overview

This document explains the technical architecture of the Tutor-GPT OpenWebUI Pipe and how it integrates with the existing Tutor-GPT system.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         OpenWebUI                            │
│                     (User Interface)                         │
│  - Chat interface                                            │
│  - Model selection                                           │
│  - File uploads                                              │
│  - User authentication                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ pipe(body, __user__)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              tutor_gpt_pipe.py (THIS COMPONENT)              │
│                    Python Adapter Layer                      │
│                                                               │
│  Responsibilities:                                            │
│  • Extract user identity from __user__["id"]                 │
│  • Map to Honcho user ID (openwebui_{id})                   │
│  • Forward requests to memory-proxy                          │
│  • Stream responses back to OpenWebUI                        │
│  • Handle errors gracefully                                  │
│                                                               │
│  Components:                                                  │
│  • Valves (Pydantic config)                                  │
│  • Async HTTP client (httpx)                                 │
│  • SSE streaming handler                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ HTTP POST /v1/chat/completions
                       │ Headers:
                       │   Authorization: Bearer {key}
                       │   X-User-Id: openwebui_{user_id}
                       │ Body: {messages, stream: true}
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Memory Proxy Server                       │
│                   (Node.js + TypeScript)                     │
│                   Port: 8081 (default)                       │
│                                                               │
│  Responsibilities:                                            │
│  • Authenticate requests (PROXY_API_KEY)                     │
│  • Manage Honcho user/session lifecycle                     │
│  • Run thought generation pipeline                           │
│  • Retrieve memory context from Honcho                       │
│  • Handle PDF collection queries                             │
│  • Generate final response via LLM                           │
│  • Stream SSE chunks back to caller                          │
│  • Persist conversation to Honcho                            │
│                                                               │
│  Key Functions:                                               │
│  • handleChatCompletion() - Main request handler            │
│  • ensureSession() - Session management                      │
│  • fetchConversationHistory() - Memory retrieval            │
│  • saveConversation() - Persistence                          │
└──────┬──────────────┬──────────────┬────────────────────────┘
       │              │              │
       │              │              │
       ▼              ▼              ▼
  ┌─────────┐   ┌─────────┐   ┌──────────┐
  │ Honcho  │   │OpenRouter│  │  Tutor   │
  │  SDK    │   │   API    │  │ Pipeline │
  └─────────┘   └─────────┘   └──────────┘
       │              │              │
       └──────────────┴──────────────┘
                  │
                  ▼
        ┌──────────────────┐
        │  Thought Pipeline │
        │  1. Generate      │
        │     Thought       │
        │  2. Extract       │
        │     Queries       │
        │  3. Retrieve      │
        │     Memory        │
        │  4. Generate      │
        │     Response      │
        └──────────────────┘
```

## Data Flow

### 1. Request Flow (OpenWebUI → Memory Proxy)

```python
# In OpenWebUI
user_message = "Help me learn about neural networks"

# OpenWebUI calls pipe()
pipe.pipe(
    body={
        "messages": [
            {"role": "user", "content": user_message}
        ],
        "model": "tutor-gpt",
        "stream": True
    },
    __user__={
        "id": "abc123",
        "email": "user@example.com",
        "name": "John Doe"
    }
)

# Pipe extracts user_id
user_id = f"openwebui_{__user__['id']}"  # → "openwebui_abc123"

# Pipe forwards to memory proxy
POST http://localhost:8081/v1/chat/completions
Headers:
    Authorization: Bearer {PROXY_API_KEY}
    X-User-Id: openwebui_abc123
Body:
    {
        "messages": [...],
        "stream": true
    }
```

### 2. Processing Flow (Memory Proxy)

```typescript
// In memory-proxy/src/server.ts

async function handleChatCompletion(req, res, payload) {
    // 1. Authenticate
    if (authHeader !== `Bearer ${PROXY_API_KEY}`) {
        return 401;
    }

    // 2. Extract user identity
    const userId = getHeader('x-user-id') || 'openwebui-user';
    const sessionId = deterministicId(`${userId}:${model}`);

    // 3. Get or create Honcho entities
    const app = await getHonchoApp();
    const user = await getHonchoUser(userId);
    const session = await ensureSession(app.id, user.id, sessionId);

    // 4. Fetch conversation history
    const history = await fetchConversationHistory(
        app.id, user.id, session.id
    );

    // 5. Generate thought
    const thoughtPrompt = buildThoughtPrompt(history, latestMessage);
    const thoughtStream = streamText({ messages: thoughtPrompt });

    // Parse thought into sections:
    // - thought: internal reasoning
    // - honchoQuery: what to retrieve from memory
    // - pdfQuery: what to search in PDFs

    // 6. Retrieve context in parallel
    const [honchoContent, pdfContent] = await Promise.all([
        honcho.sessions.chat(appId, userId, sessionId, {
            queries: honchoQuery
        }),
        collectionChat({ collectionId, question: pdfQuery })
    ]);

    // 7. Generate final response
    const responsePrompt = buildResponsePrompt(
        history,
        latestMessage,
        honchoContent,
        pdfContent
    );
    const responseStream = streamText({ messages: responsePrompt });

    // 8. Stream back to client (OpenWebUI pipe)
    for await (const chunk of responseStream) {
        sendSseData(res, {
            id: completionId,
            object: 'chat.completion.chunk',
            delta: { content: chunk }
        });
    }

    // 9. Persist conversation
    await saveConversation(
        appId, userId, sessionId,
        latestMessage,
        thought,
        honchoContent,
        pdfContent,
        responseText
    );
}
```

### 3. Response Flow (Memory Proxy → OpenWebUI)

```python
# In tutor_gpt_pipe.py

async def pipe(self, body, __user__):
    async with httpx.AsyncClient() as client:
        async with client.stream("POST", url, ...) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    # Forward SSE chunks directly to OpenWebUI
                    yield f"{line}\n\n"

# OpenWebUI receives SSE events:
data: {"id":"chatcmpl-...","delta":{"role":"assistant"},...}
data: {"id":"chatcmpl-...","delta":{"content":"Neural"},...}
data: {"id":"chatcmpl-...","delta":{"content":" networks"},...}
...
data: [DONE]
```

## Component Responsibilities

### Python Pipe (tutor_gpt_pipe.py)

**Role**: Thin adapter layer between OpenWebUI and memory proxy

**Does**:
- ✅ Extract user identity from OpenWebUI
- ✅ Authenticate requests to memory proxy
- ✅ Forward chat requests
- ✅ Stream responses back
- ✅ Handle connection errors
- ✅ Provide configuration via Valves

**Does NOT**:
- ❌ Implement thought generation
- ❌ Manage Honcho connections
- ❌ Store conversation state
- ❌ Call LLM providers directly
- ❌ Process PDFs

**Why**: Keep the Python component minimal to avoid duplication with the existing Node.js codebase.

### Memory Proxy (memory-proxy/src/server.ts)

**Role**: Core intelligence and orchestration layer

**Does**:
- ✅ Implement thought generation pipeline
- ✅ Manage Honcho user/session/app lifecycle
- ✅ Retrieve conversation history
- ✅ Fetch memory context via Honcho SDK
- ✅ Handle PDF collections
- ✅ Call OpenRouter for LLM completions
- ✅ Stream responses with proper SSE formatting
- ✅ Persist conversations to Honcho
- ✅ Generate rolling summaries

**Does NOT**:
- ❌ Handle OpenWebUI-specific logic
- ❌ Render UI
- ❌ Manage user authentication (delegates to Honcho)

**Why**: Contains the sophisticated reasoning pipeline and all business logic.

## User Identity Mapping

### Problem
OpenWebUI and Tutor-GPT (via Honcho) each have their own user identity systems.

### Solution
Prefix-based mapping:

| System | User ID Format | Example |
|--------|---------------|---------|
| OpenWebUI | Native UUID/ID | `abc-123-def-456` |
| Pipe → Proxy | Prefixed ID | `openwebui_abc-123-def-456` |
| Honcho | Stored as-is | `openwebui_abc-123-def-456` |

This ensures:
- Clear separation between Next.js app users and OpenWebUI users
- No ID collisions
- Easy identification of user source in Honcho

## Session Management

### Strategy: Deterministic Session IDs

Instead of relying on OpenWebUI's session management:

```typescript
// In memory-proxy
const sessionIdentifier = deterministicId(`${userId}:${model}`);
```

This means:
- Each user gets **one persistent session per model**
- All conversations with "tutor-gpt" model go to the same Honcho session
- Memory accumulates across OpenWebUI chat sessions
- Users can close/reopen chats without losing context

**Alternative**: If OpenWebUI provides session IDs via headers, we could use those instead:
```typescript
const sessionId = getHeader('x-session-id') || deterministicId(...);
```

## Streaming Architecture

### Why Streaming?

1. **Better UX**: Users see responses appear word-by-word
2. **Longer responses**: Can handle multi-minute generations without timeouts
3. **Thought visibility**: Could optionally stream thoughts as they're generated

### SSE Format

Memory proxy sends Server-Sent Events (SSE) in OpenAI-compatible format:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"tutor-gpt","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"tutor-gpt","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"tutor-gpt","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: [DONE]
```

The Python pipe forwards these verbatim to OpenWebUI.

## Error Handling

### Layered Error Handling

```
┌─────────────────┐
│   OpenWebUI     │  ← "Model unavailable"
└────────┬────────┘
         │
┌────────▼────────┐
│  Python Pipe    │  ← Catches connection errors, auth errors
└────────┬────────┘     Returns user-friendly messages
         │
┌────────▼────────┐
│  Memory Proxy   │  ← Catches Honcho errors, LLM errors
└────────┬────────┘     Logs details, returns safe errors
         │
┌────────▼────────┐
│ External APIs   │  ← Honcho, OpenRouter, etc.
└─────────────────┘
```

### Error Types

| Error | Detected By | User Sees | Action |
|-------|-------------|-----------|--------|
| Memory proxy down | Python pipe | "Cannot connect to memory proxy" | Check if proxy is running |
| Wrong API key | Python pipe | "Authentication failed" | Check Valves config |
| Honcho error | Memory proxy | "Error retrieving memory" | Check Honcho credentials |
| OpenRouter error | Memory proxy | "LLM service unavailable" | Check OpenRouter status |
| Timeout | Python pipe | "Request timed out" | Increase timeout or check proxy |

## Security Considerations

### Authentication Flow

1. **OpenWebUI → Pipe**: No auth needed (pipe runs in OpenWebUI's process)
2. **Pipe → Memory Proxy**: Bearer token auth via `PROXY_API_KEY`
3. **Memory Proxy → Honcho**: API key auth via `HONCHO_API_KEY`
4. **Memory Proxy → OpenRouter**: API key auth via `OPENROUTER_API_KEY`

### Secrets Management

- **Never in code**: All keys configured via environment variables
- **Valves for pipe**: User-configurable in OpenWebUI admin panel
- **.env for proxy**: Server-side configuration file
- **No client exposure**: API keys never sent to browser

### User Isolation

- Each OpenWebUI user gets a unique Honcho user ID
- Sessions are isolated per user
- No cross-user data leakage via deterministic session IDs

## Performance Characteristics

### Latency Breakdown

Typical request (second message onwards):

```
User sends message
│
├─ 50ms: Pipe forwards to proxy
├─ 100ms: Proxy fetches conversation history from Honcho
├─ 3-5s: Thought generation (LLM call)
├─ 200ms: Memory retrieval from Honcho
├─ 100ms: PDF search (if applicable)
├─ 4-8s: Response generation (LLM call)
└─ Streaming: Words appear in real-time

Total time to first word: ~4-6s
Total time to complete: ~8-15s
```

First message (new user/session):
- Add 1-2s for creating Honcho user/session

### Scaling Considerations

**Bottlenecks**:
1. Memory proxy (single Node.js process)
2. Honcho API rate limits
3. OpenRouter rate limits

**Scaling strategies**:
1. Run multiple memory proxy instances
2. Load balance at the pipe level (round-robin proxy URLs)
3. Cache Honcho responses (with TTL)
4. Implement request queuing for rate limiting

## Future Enhancements

### Possible Improvements

1. **Multi-session support**: Allow multiple conversation threads per user
2. **Thought visibility**: Stream thoughts as assistant messages with metadata
3. **Real-time collaboration**: Share sessions between users
4. **Admin dashboard**: Monitor usage, token consumption, etc.
5. **A/B testing**: Run multiple thought strategies in parallel
6. **Voice integration**: Add speech-to-text / text-to-speech
7. **Mobile app**: Use same memory proxy for mobile clients

### Architecture Evolution

```
Current:
OpenWebUI → Python Pipe → Memory Proxy → Honcho

Future:
Multiple Frontends → API Gateway → Memory Proxy Pool → Honcho Cluster
                   ↓
           Semantic Retrieval Service
                   ↓
              Vector Store
```

## Conclusion

The hybrid Python/Node.js architecture allows us to:
- ✅ Integrate with OpenWebUI's Python-based pipe system
- ✅ Reuse the sophisticated thought pipeline from Tutor-GPT
- ✅ Maintain a single source of truth for business logic
- ✅ Support multiple frontends through the same proxy
- ✅ Scale each component independently

The Python pipe remains thin (~200 lines) while the Node.js memory proxy handles all complex logic, making the system maintainable and extensible.
