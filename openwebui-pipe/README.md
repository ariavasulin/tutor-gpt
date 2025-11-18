# Tutor-GPT OpenWebUI Pipe

OpenWebUI-compatible pipe that integrates the Tutor-GPT personalized learning system with OpenWebUI's interface. This pipe enables users to experience Honcho-backed memory and context-aware tutoring through OpenWebUI.

## Architecture Overview

```
┌─────────────┐
│  OpenWebUI  │  (User Interface)
└──────┬──────┘
       │ pipe() call
       ▼
┌─────────────────────┐
│  tutor_gpt_pipe.py  │  (Python Adapter - This Component)
└──────┬──────────────┘
       │ HTTP POST /v1/chat/completions
       ▼
┌─────────────────────┐
│   Memory Proxy      │  (Node.js Service)
│  (Port 8081)        │
└──────┬──────────────┘
       │
       ├─→ Honcho (Memory & Identity)
       ├─→ OpenRouter (LLM)
       └─→ Thought Pipeline (Reasoning)
```

## Features

- **Seamless Integration**: Acts as a thin adapter between OpenWebUI and Tutor-GPT's memory proxy
- **User Identity Mapping**: Automatically maps OpenWebUI users to Honcho user identities
- **Session Management**: Maintains conversation context across sessions
- **Streaming Support**: Real-time response streaming for better UX
- **Error Handling**: Comprehensive error messages and logging
- **Configurable**: All settings via OpenWebUI's Valves system (no code changes needed)

## Prerequisites

### 1. Memory Proxy Service Running

The memory proxy service **must** be running before using this pipe. See [`/memory-proxy/README.md`](../memory-proxy/README.md) for setup instructions.

Quick start:
```bash
cd /path/to/tutor-gpt
pnpm install
pnpm memory-proxy
```

Verify it's running:
```bash
curl http://localhost:8081/health
# Should return: {"status":"ok"}
```

### 2. Python Dependencies

- Python 3.10 or higher
- OpenWebUI installed and running

### 3. Required Environment Variables (for Memory Proxy)

Ensure your memory proxy has these configured in `memory-proxy/.env`:

```bash
PROXY_API_KEY=your-secret-key-here
HONCHO_URL=https://your-honcho-instance.com
HONCHO_APP_NAME=tutor-gpt
HONCHO_API_KEY=your-honcho-api-key
OPENROUTER_API_KEY=your-openrouter-key
```

## Installation

### Option 1: Install via OpenWebUI Admin Panel (Recommended)

1. **Navigate to Admin Panel**
   - Open OpenWebUI
   - Go to **Admin Panel** → **Functions**

2. **Upload the Pipe**
   - Click **"+ Add Function"**
   - Select **"Upload from File"**
   - Choose `tutor_gpt_pipe.py`
   - Click **"Import"**

3. **Configure Valves**
   - Click on the newly imported **"Tutor-GPT Pipe"**
   - Configure the following settings:
     - `PROXY_URL`: `http://localhost:8081` (or your memory proxy URL)
     - `PROXY_API_KEY`: Your proxy API key (same as in memory-proxy/.env)
     - `TIMEOUT_SECONDS`: `300` (5 minutes, adjust if needed)
     - `DEBUG_MODE`: `false` (set to `true` for troubleshooting)

4. **Enable the Function**
   - Toggle the function to **"Enabled"**
   - Click **"Save"**

### Option 2: Install via CLI

```bash
# Install dependencies
pip install -r requirements.txt

# Copy the pipe to OpenWebUI's functions directory
# (Location varies by installation method)
cp tutor_gpt_pipe.py ~/.openwebui/functions/

# Restart OpenWebUI to pick up the new function
```

### Option 3: Development Installation

For testing or development:

```bash
# Install in development mode
pip install -e .

# Set environment variables
export TUTOR_GPT_PROXY_URL=http://localhost:8081
export TUTOR_GPT_PROXY_API_KEY=your-api-key

# Run a test
python tutor_gpt_pipe.py
```

## Configuration

### Valves (Configurable Parameters)

All configuration is done through OpenWebUI's Valves system:

| Valve | Description | Default | Required |
|-------|-------------|---------|----------|
| `PROXY_URL` | Base URL of memory proxy | `http://localhost:8081` | Yes |
| `PROXY_API_KEY` | Authentication key for proxy | (empty) | **Yes** |
| `TIMEOUT_SECONDS` | Request timeout | `300` | No |
| `DEBUG_MODE` | Enable detailed logging | `false` | No |

**Important**: `PROXY_API_KEY` **must** match the `PROXY_API_KEY` set in your memory proxy's `.env` file.

### Environment Variables (Optional)

You can also set defaults via environment variables:

```bash
export TUTOR_GPT_PROXY_URL=http://localhost:8081
export TUTOR_GPT_PROXY_API_KEY=your-secret-key
```

These will be used as defaults if not overridden in the Valves configuration.

## Usage

### 1. Start the Memory Proxy

```bash
cd tutor-gpt
pnpm memory-proxy
```

### 2. Use in OpenWebUI

1. Open a chat in OpenWebUI
2. Select **"Bloom Tutor (Tutor-GPT)"** from the model dropdown
3. Start chatting! Your conversations will:
   - Generate thoughts about your learning needs
   - Retrieve relevant context from past conversations (via Honcho)
   - Provide personalized, context-aware responses
   - Persist to your personal memory graph

### 3. Features in Action

- **Memory Recall**: The tutor remembers previous conversations and learning goals
- **Context-Aware**: Responses adapt based on your learning history
- **File Upload**: Upload PDFs and ask questions about them (if supported by memory proxy)
- **Streaming**: Real-time response generation

## Troubleshooting

### "Cannot connect to memory proxy" Error

**Symptoms**: Error message about connection refused

**Solutions**:
1. Verify memory proxy is running:
   ```bash
   curl http://localhost:8081/health
   ```
2. Check `PROXY_URL` in Valves matches your memory proxy's address
3. Ensure no firewall is blocking port 8081

### "Authentication failed" Error

**Symptoms**: 401 Unauthorized error

**Solutions**:
1. Verify `PROXY_API_KEY` in Valves matches `memory-proxy/.env`
2. Check for extra spaces or quotes in the API key
3. Restart memory proxy after changing `.env`

### "Request timed out" Error

**Symptoms**: Timeout after 5 minutes

**Solutions**:
1. Increase `TIMEOUT_SECONDS` in Valves (e.g., to `600` for 10 minutes)
2. Check if OpenRouter is experiencing issues
3. Verify your OpenRouter API key is valid and has credits

### Enable Debug Mode

For detailed logging:
1. Set `DEBUG_MODE` to `true` in Valves
2. Check OpenWebUI's console/logs for detailed output
3. Look for lines prefixed with the pipe name

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No models showing | Pipe not enabled | Enable in Admin Panel |
| Empty responses | Missing API key | Configure `PROXY_API_KEY` |
| Slow responses | Thought generation overhead | Normal for personalized responses |
| Memory not working | Honcho not configured | Check memory proxy `.env` |

## Testing

### Quick Test

```bash
python tutor_gpt_pipe.py
```

Expected output:
```
Tutor-GPT Pipe initialized successfully!
Available models: [{'id': 'tutor-gpt', 'name': 'Bloom Tutor (Tutor-GPT)'}]
Proxy URL: http://localhost:8081
API Key configured: Yes
```

### Integration Test

1. Ensure memory proxy is running
2. In OpenWebUI, select "Bloom Tutor"
3. Send a test message: "Help me learn about photosynthesis"
4. Verify you receive a personalized response

## Advanced Configuration

### Custom Proxy Port

If running memory proxy on a different port:

```bash
# In Valves:
PROXY_URL = http://localhost:9000
```

### Remote Memory Proxy

To connect to a remote memory proxy:

```bash
# In Valves:
PROXY_URL = https://your-domain.com
```

**Note**: Ensure HTTPS is configured for production deployments.

### Multiple Tutor Instances

To run multiple tutor instances with different configurations:

1. Duplicate `tutor_gpt_pipe.py` → `tutor_gpt_pipe_advanced.py`
2. Change the `id` in `pipes()` method
3. Upload as a separate function
4. Configure different Valves for each

## Architecture Details

### Data Flow

```
1. User sends message in OpenWebUI
   ↓
2. OpenWebUI calls pipe() with:
   - body: {messages: [...], model: "tutor-gpt", stream: true}
   - __user__: {id: "user123", ...}
   ↓
3. Pipe extracts user_id → "openwebui_user123"
   ↓
4. Pipe forwards to memory proxy:
   POST /v1/chat/completions
   Headers: {
     Authorization: Bearer {PROXY_API_KEY},
     X-User-Id: openwebui_user123
   }
   Body: {messages, stream: true}
   ↓
5. Memory Proxy processes:
   - Creates/retrieves Honcho user
   - Generates thought about learning needs
   - Retrieves relevant memory context
   - Generates personalized response
   ↓
6. Memory Proxy streams back SSE chunks
   ↓
7. Pipe forwards chunks to OpenWebUI
   ↓
8. User sees streaming response in UI
```

### User Identity Mapping

OpenWebUI user IDs are prefixed with `openwebui_` before being sent to Honcho:

- OpenWebUI user: `abc-123`
- Honcho user: `openwebui_abc-123`

This ensures clear separation between web app users and OpenWebUI users.

### Session Management

Sessions are automatically created per user-model combination. The memory proxy generates a deterministic session ID based on:
- User ID
- Model name

This means each user gets a persistent conversation thread per model.

## Performance Considerations

- **First Request**: May take 10-15s as it initializes Honcho user/session
- **Subsequent Requests**: 5-10s for thought generation + memory retrieval
- **Streaming**: Responses appear word-by-word for better perceived performance
- **Timeouts**: Default 5 min timeout handles long generations

## Security Best Practices

1. **Never commit API keys**: Use environment variables or Valves
2. **Use HTTPS in production**: Especially for remote memory proxy
3. **Rotate API keys regularly**: Update both memory proxy and pipe Valves
4. **Limit CORS origins**: In memory proxy, restrict `ALLOW_ORIGINS`
5. **Monitor logs**: Enable `DEBUG_MODE` only during troubleshooting

## Contributing

To contribute improvements:

1. Test changes locally with `python tutor_gpt_pipe.py`
2. Verify integration with running memory proxy
3. Update this README if adding new features
4. Submit changes via your preferred workflow

## Support

For issues or questions:

1. Check **Troubleshooting** section above
2. Enable `DEBUG_MODE` and review logs
3. Verify memory proxy is working: `curl http://localhost:8081/health`
4. Review memory proxy logs: `pnpm memory-proxy`
5. Open an issue with:
   - Error messages
   - OpenWebUI version
   - Python version
   - Memory proxy logs

## License

Inherits license from parent Tutor-GPT project.

## Related Documentation

- [Memory Proxy README](../memory-proxy/README.md)
- [Memory Proxy Implementation Guide](../memory-proxy/IMPLEMENTATION_GUIDE.md)
- [Frontend-Agnostic RAG Plan](../memory-proxy/docs/frontend-agnostic-rag-plan.md)
- [OpenWebUI Pipes Documentation](https://docs.openwebui.com/pipelines/pipes/)
