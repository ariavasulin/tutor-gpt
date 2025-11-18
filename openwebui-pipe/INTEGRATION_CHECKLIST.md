# Integration Checklist

Use this checklist to verify your Tutor-GPT OpenWebUI Pipe installation.

## Pre-Installation

- [ ] Python 3.10+ installed (`python --version`)
- [ ] Node.js 18+ installed (`node --version`)
- [ ] pnpm installed (`pnpm --version`)
- [ ] OpenWebUI installed and accessible
- [ ] Honcho API credentials obtained
- [ ] OpenRouter API key obtained

## Memory Proxy Setup

- [ ] Dependencies installed (`pnpm install` in tutor-gpt root)
- [ ] `.env` file created in `memory-proxy/` directory
- [ ] `PROXY_API_KEY` set in memory-proxy/.env
- [ ] `HONCHO_URL` set in memory-proxy/.env
- [ ] `HONCHO_APP_NAME` set in memory-proxy/.env
- [ ] `HONCHO_API_KEY` set in memory-proxy/.env
- [ ] `OPENROUTER_API_KEY` set in memory-proxy/.env
- [ ] Memory proxy running (`pnpm memory-proxy`)
- [ ] Health check passes (`curl http://localhost:8081/health`)

## Python Pipe Installation

- [ ] Python dependencies installed (`pip install -r openwebui-pipe/requirements.txt`)
- [ ] Pipe file uploaded to OpenWebUI or copied to functions directory
- [ ] Pipe appears in OpenWebUI Admin Panel → Functions
- [ ] Pipe is **enabled** (toggle switch on)

## Configuration

- [ ] `PROXY_URL` set in Valves (default: `http://localhost:8081`)
- [ ] `PROXY_API_KEY` set in Valves (must match memory-proxy/.env)
- [ ] `PROXY_API_KEY` in Valves matches `PROXY_API_KEY` in memory-proxy/.env ⚠️
- [ ] `TIMEOUT_SECONDS` set (recommended: `300`)
- [ ] Configuration saved in OpenWebUI

## Testing

- [ ] Memory proxy health check: `curl http://localhost:8081/health`
  - Expected: `{"status":"ok"}`

- [ ] Model appears in OpenWebUI chat model dropdown
  - Look for: "Bloom Tutor (Tutor-GPT)"

- [ ] Send test message: "Hello, help me learn about Python"
  - [ ] Response is streaming
  - [ ] Response is personalized/educational
  - [ ] No error messages appear
  - [ ] Response completes successfully

- [ ] Send follow-up message: "What did we just discuss?"
  - [ ] Response references previous message (memory working)

- [ ] Check memory proxy logs
  - [ ] No errors in terminal running `pnpm memory-proxy`
  - [ ] See request logs for each message

## Advanced Testing (Optional)

- [ ] Enable `DEBUG_MODE` in Valves
- [ ] Send another message
- [ ] Review OpenWebUI logs for detailed debugging info
- [ ] Disable `DEBUG_MODE` after testing

- [ ] Test file upload (if configured)
  - [ ] Upload a PDF in OpenWebUI
  - [ ] Ask a question about the PDF
  - [ ] Receive relevant answer

- [ ] Test multiple users
  - [ ] Log in as different OpenWebUI user
  - [ ] Verify separate conversation history
  - [ ] Check Honcho for separate user entries

## Troubleshooting Steps

If tests fail, check these in order:

### 1. Memory Proxy Connection
```bash
curl http://localhost:8081/health
```
- ✓ Returns `{"status":"ok"}` → Proxy is running
- ✗ Connection refused → Start memory proxy: `pnpm memory-proxy`
- ✗ 404 Not Found → Wrong URL, check `PROXY_URL` in Valves

### 2. Authentication
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"test"}],"stream":false}' \
     http://localhost:8081/v1/chat/completions
```
- ✓ Returns JSON response → Auth working
- ✗ 401 Unauthorized → API key mismatch, check both .env files

### 3. Honcho Connection
Check memory-proxy logs for:
- ✓ No Honcho errors → Working
- ✗ "Honcho connection failed" → Check HONCHO_URL and HONCHO_API_KEY

### 4. OpenRouter Connection
Check memory-proxy logs for:
- ✓ Streaming LLM response → Working
- ✗ "OpenRouter error" → Check OPENROUTER_API_KEY and credits

### 5. Pipe Configuration
In OpenWebUI Admin Panel → Functions → Tutor-GPT Pipe:
- ✓ Shows as "Enabled" → Good
- ✗ Shows as "Disabled" → Toggle to enable
- ✗ Not visible → Re-upload pipe file

## Common Issues and Solutions

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| Model not in dropdown | Pipe disabled | Enable in Admin Panel |
| "Cannot connect" error | Proxy not running | Run `pnpm memory-proxy` |
| "Auth failed" error | API key mismatch | Match keys in .env and Valves |
| Timeout error | Long response | Increase `TIMEOUT_SECONDS` |
| Empty response | OpenRouter issue | Check API key and credits |
| No memory recall | Honcho issue | Check HONCHO_URL and key |

## Production Deployment Checklist

- [ ] Use HTTPS for remote memory proxy
- [ ] Set strong `PROXY_API_KEY` (32+ characters)
- [ ] Restrict CORS origins in memory proxy
- [ ] Set up monitoring for memory proxy
- [ ] Configure log rotation
- [ ] Set up backup for Honcho data
- [ ] Load test the pipeline
- [ ] Set up error alerting
- [ ] Document runbook for common issues
- [ ] Plan for scaling (multiple proxy instances)

## Success Criteria

✅ **Installation is successful when:**
1. Memory proxy health check returns 200 OK
2. Pipe appears and is enabled in OpenWebUI
3. Test message receives a streaming response
4. Follow-up message shows memory recall
5. No errors in memory proxy logs
6. No errors in OpenWebUI logs

## Next Steps After Installation

1. **Customize**: Edit prompt templates in `utils/prompts/`
2. **Monitor**: Set up logging and monitoring
3. **Scale**: Consider running multiple proxy instances
4. **Integrate**: Add more frontends (CLI, mobile, etc.)
5. **Optimize**: Fine-tune timeout and cache settings

## Support

If you've completed this checklist and still have issues:

1. Enable `DEBUG_MODE` in Valves
2. Collect logs from:
   - Memory proxy terminal output
   - OpenWebUI logs
   - Browser console (F12)
3. Note error messages and when they occur
4. Review the [README.md](README.md) troubleshooting section

---

**Last Updated**: 2025-11-18
**Version**: 1.0.0
