# Quick Start Guide: Tutor-GPT OpenWebUI Pipe

Get up and running in 5 minutes!

## Prerequisites

- [ ] OpenWebUI installed and running
- [ ] Python 3.10+ installed
- [ ] Node.js 18+ installed
- [ ] Honcho API access
- [ ] OpenRouter API key

## Step 1: Set Up Memory Proxy (2 minutes)

```bash
# Navigate to the project root
cd tutor-gpt

# Install Node.js dependencies
pnpm install

# Configure the memory proxy
cp memory-proxy/.env.example memory-proxy/.env

# Edit memory-proxy/.env and set:
# PROXY_API_KEY=your-secret-key
# HONCHO_URL=https://your-honcho-instance.com
# HONCHO_APP_NAME=tutor-gpt
# HONCHO_API_KEY=your-honcho-api-key
# OPENROUTER_API_KEY=your-openrouter-key

# Start the memory proxy
pnpm memory-proxy
```

**Verify it's running:**
```bash
curl http://localhost:8081/health
# Expected: {"status":"ok"}
```

## Step 2: Install the Python Pipe (1 minute)

### Option A: Via OpenWebUI UI (Easiest)

1. Open OpenWebUI in your browser
2. Go to **Admin Panel** → **Functions**
3. Click **"+ Add Function"**
4. Select **"Upload from File"**
5. Choose `openwebui-pipe/tutor_gpt_pipe.py`
6. Click **"Import"**

### Option B: Via Command Line

```bash
# Install Python dependencies
pip install httpx pydantic

# Copy to OpenWebUI functions directory
cp openwebui-pipe/tutor_gpt_pipe.py ~/.openwebui/functions/
```

## Step 3: Configure the Pipe (1 minute)

In OpenWebUI's Admin Panel → Functions:

1. Find **"Tutor-GPT Pipe"**
2. Click to configure
3. Set these Valves:
   - `PROXY_URL`: `http://localhost:8081`
   - `PROXY_API_KEY`: `your-secret-key` (same as in memory-proxy/.env)
4. Toggle to **"Enabled"**
5. Click **"Save"**

## Step 4: Test It! (1 minute)

1. Open a new chat in OpenWebUI
2. Select **"Bloom Tutor (Tutor-GPT)"** from the model dropdown
3. Send a message: "Help me learn about machine learning"
4. Watch the magic happen! ✨

You should see:
- Streaming response
- Personalized tutoring based on the Tutor-GPT system
- Memory of your conversation persisting across sessions

## Troubleshooting

### "Cannot connect to memory proxy"
→ Make sure `pnpm memory-proxy` is running in a terminal

### "Authentication failed"
→ Check that `PROXY_API_KEY` matches in both:
   - memory-proxy/.env
   - OpenWebUI Valves configuration

### "No model showing"
→ Make sure the function is **enabled** in Admin Panel

## Next Steps

- **Customize prompts**: Edit `utils/prompts/` in the main repo
- **Upload PDFs**: Try uploading a document and asking questions
- **View memory**: Conversations are stored in Honcho
- **Advanced config**: See [README.md](README.md) for full documentation

## Architecture Diagram

```
You (OpenWebUI)
    ↓
tutor_gpt_pipe.py (this component)
    ↓
memory-proxy (Node.js server on :8081)
    ↓
    ├─→ Honcho (remembers you)
    ├─→ OpenRouter (LLM)
    └─→ Thought Pipeline (reasons about your learning)
```

## Getting Help

- See [README.md](README.md) for full documentation
- Enable `DEBUG_MODE` in Valves for detailed logs
- Check memory-proxy terminal for error messages

Happy learning! 🎓
