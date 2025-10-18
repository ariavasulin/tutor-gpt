import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import dotenv from 'dotenv';
import { Honcho } from 'honcho-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const PORT = Number.parseInt(process.env.PORT || '8081', 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY;
const HONCHO_URL = process.env.HONCHO_URL;
const HONCHO_APP_NAME = process.env.HONCHO_APP_NAME;
const HONCHO_API_KEY = process.env.HONCHO_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!PROXY_API_KEY) {
  throw new Error('PROXY_API_KEY must be defined in the environment');
}
if (!HONCHO_URL) {
  throw new Error('HONCHO_URL must be defined in the environment');
}
if (!HONCHO_APP_NAME) {
  throw new Error('HONCHO_APP_NAME must be defined in the environment');
}
if (!HONCHO_API_KEY) {
  throw new Error('HONCHO_API_KEY must be defined in the environment');
}
if (!OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY must be defined in the environment');
}

const honcho = new Honcho({
  baseURL: HONCHO_URL,
  apiKey: HONCHO_API_KEY,
});

let cachedAppPromise;
const userCache = new Map();
const sessionCache = new Map();
const turnCounter = new Map();

function setCorsHeaders(res, origin) {
  if (!ALLOW_ORIGINS.length) {
    return;
  }
  if (ALLOW_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-User-Id, X-Session-Id, X-Title'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function jsonResponse(res, status, body, origin) {
  if (!res.headersSent) {
    setCorsHeaders(res, origin);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
  }
  res.end(JSON.stringify(body));
}

async function ensureApp() {
  if (!cachedAppPromise) {
    cachedAppPromise = honcho.apps.getOrCreate(HONCHO_APP_NAME, {
      timeout: 5000,
      maxRetries: 5,
    });
  }
  return cachedAppPromise;
}

async function ensureUser(appId, userId) {
  const cacheKey = `${appId}:${userId}`;
  if (!userCache.has(cacheKey)) {
    userCache.set(
      cacheKey,
      honcho.apps.users.getOrCreate(appId, userId, {
        timeout: 5000,
        maxRetries: 5,
      })
    );
  }
  return userCache.get(cacheKey);
}

async function ensureSession(appId, userId, externalId) {
  const cacheKey = `${appId}:${userId}:${externalId}`;
  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey);
  }

  try {
    const existing = honcho.apps.users.sessions.list(appId, userId, {
      size: 1,
      filter: { external_id: externalId },
    });

    for await (const session of existing) {
      sessionCache.set(cacheKey, session);
      return session;
    }
  } catch (error) {
    console.error('Failed to list Honcho sessions:', error);
  }

  try {
    const created = await honcho.apps.users.sessions.create(appId, userId, {
      metadata: { external_id: externalId },
    });
    sessionCache.set(cacheKey, created);
    return created;
  } catch (error) {
    console.error('Failed to create Honcho session:', error);
    throw error;
  }
}

async function fetchHonchoMemory(appId, userId, sessionId, query) {
  if (!query) {
    return '';
  }
  try {
    const response = await honcho.apps.users.sessions.chat(appId, userId, sessionId, {
      queries: query,
    });
    return (response?.content || '').trim();
  } catch (error) {
    console.error('Failed to fetch Honcho memory:', error);
    return '';
  }
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && part.type === 'text') {
          return part.text || '';
        }
        return '';
      })
      .join('');
  }
  if (typeof content === 'object' && 'text' in content) {
    return content.text || '';
  }
  return '';
}

function buildHonchoQuery(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  const reversed = [...messages].reverse();
  const lastUser = reversed.find((msg) => msg.role === 'user');
  const lastAssistant = reversed.find((msg) => msg.role === 'assistant');
  const parts = [];
  if (lastUser) {
    parts.push(`User: ${truncate(extractText(lastUser.content), 220)}`);
  }
  if (lastAssistant) {
    parts.push(`Assistant summary: ${truncate(extractText(lastAssistant.content), 160)}`);
  }
  return truncate(parts.join('\n\n'), 400);
}

function truncate(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function extractKbSnippet(messages) {
  if (!Array.isArray(messages)) return '';
  for (const message of messages) {
    const text = extractText(message?.content);
    if (!text) continue;
    const match = text.match(/<kb>([\s\S]*?)<\/kb>/i);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

function sessionKey(appId, userId, sessionId) {
  return `${appId}:${userId}:${sessionId}`;
}

function incrementTurnCount(key) {
  const current = turnCounter.get(key) || 0;
  const next = current + 1;
  turnCounter.set(key, next);
  return next;
}

function buildSummary(userMessage, assistantMessage, turnNumber) {
  if (!userMessage && !assistantMessage) {
    return '';
  }
  const summary = [`Turn ${turnNumber} summary:`];
  if (userMessage) {
    summary.push(`User: ${truncate(userMessage, 160)}`);
  }
  if (assistantMessage) {
    summary.push(`Assistant: ${truncate(assistantMessage, 200)}`);
  }
  return summary.join('\n');
}

function parseAssistantFromJSON(payloadText) {
  const result = { text: '', hasToolCalls: false };
  try {
    const data = JSON.parse(payloadText);
    const choice = data?.choices?.[0];
    if (!choice) return result;
    const message = choice.message || choice.delta || {};
    result.text = extractText(message.content);
    const toolCalls = message.tool_calls || choice.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      result.hasToolCalls = true;
    }
    if (choice.finish_reason === 'tool_calls') {
      result.hasToolCalls = true;
    }
  } catch (error) {
    console.error('Failed to parse assistant response JSON:', error);
  }
  return result;
}

function parseAssistantFromSSE(sseText) {
  const result = { text: '', hasToolCalls: false };
  if (!sseText) return result;
  for (const rawLine of sseText.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const choice = parsed?.choices?.[0];
      const delta = choice?.delta || {};
      if (delta.content) {
        result.text += delta.content;
      }
      const toolCalls =
        delta.tool_calls || choice?.message?.tool_calls || choice?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        result.hasToolCalls = true;
      }
      if (choice?.finish_reason === 'tool_calls') {
        result.hasToolCalls = true;
      }
    } catch (error) {
      // Ignore partial JSON chunks
    }
  }
  return result;
}

async function persistTurn({
  appId,
  userId,
  sessionId,
  userMessage,
  assistantMessage,
  honchoContent,
  kbSnippet,
  summary,
}) {
  try {
    const userRecord = await honcho.apps.users.sessions.messages.create(appId, userId, sessionId, {
      is_user: true,
      content: userMessage || '',
    });

    if (honchoContent) {
      await honcho.apps.users.metamessages.create(appId, userId, {
        session_id: sessionId,
        message_id: userRecord.id,
        metamessage_type: 'honcho',
        content: honchoContent,
        metadata: { type: 'assistant' },
      });
    }

    if (kbSnippet) {
      await honcho.apps.users.metamessages.create(appId, userId, {
        session_id: sessionId,
        message_id: userRecord.id,
        metamessage_type: 'kb',
        content: kbSnippet,
        metadata: { type: 'assistant' },
      });
    }

    const assistantRecord = await honcho.apps.users.sessions.messages.create(
      appId,
      userId,
      sessionId,
      {
        is_user: false,
        content: assistantMessage || '',
      }
    );

    if (summary) {
      await honcho.apps.users.metamessages.create(appId, userId, {
        session_id: sessionId,
        message_id: assistantRecord.id,
        metamessage_type: 'summary',
        content: summary,
        metadata: { type: 'assistant' },
      });
    }
  } catch (error) {
    console.error('Failed to persist turn to Honcho:', error);
  }
}

function deriveSessionId(headerValue, payloadValue) {
  if (headerValue) {
    return headerValue;
  }
  if (typeof payloadValue === 'string' && payloadValue) {
    return payloadValue;
  }
  return 'local-session';
}

function deriveUserId(headerUserId) {
  return headerUserId || 'local-user';
}

const server = http.createServer(async (req, res) => {
  const origin = getHeader(req, 'origin');
  setCorsHeaders(res, origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    jsonResponse(res, 200, { status: 'ok' }, origin);
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    jsonResponse(res, 404, { error: 'Not found' }, origin);
    return;
  }

  const authHeader = getHeader(req, 'authorization');
  if (!authHeader || authHeader !== `Bearer ${PROXY_API_KEY}`) {
    jsonResponse(res, 401, { error: 'Unauthorized' }, origin);
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    console.error('Failed to parse request payload:', error);
    jsonResponse(res, 400, { error: 'Invalid JSON body' }, origin);
    return;
  }

  if (!payload || !Array.isArray(payload.messages)) {
    jsonResponse(res, 400, { error: 'messages array is required' }, origin);
    return;
  }

  const userId = deriveUserId(getHeader(req, 'x-user-id'));
  const sessionId = deriveSessionId(getHeader(req, 'x-session-id'), payload.session_id);

  let app;
  let user;
  let session;
  try {
    app = await ensureApp();
    user = await ensureUser(app.id, userId);
    session = await ensureSession(app.id, user.id, sessionId);
  } catch (error) {
    console.error('Failed to prepare Honcho identity:', error);
  }

  const honchoQuery = buildHonchoQuery(payload.messages);
  const honchoContent = app && user && session ? await fetchHonchoMemory(app.id, user.id, session.id, honchoQuery) : '';

  const augmentedMessages = honchoContent
    ? [
        { role: 'system', content: `Context from memory: ${honchoContent}` },
        ...payload.messages,
      ]
    : payload.messages;

  const forwardPayload = {
    ...payload,
    messages: augmentedMessages,
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
  };

  const incomingTitle = getHeader(req, 'x-title');
  if (incomingTitle) {
    headers['X-Title'] = incomingTitle;
  }
  const referer = getHeader(req, 'referer') || 'https://github.com/plastic-labs/tutor-gpt';
  headers['HTTP-Referer'] = referer;

  let openrouterResponse;
  try {
    openrouterResponse = await fetch(`${OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(forwardPayload),
    });
  } catch (error) {
    console.error('Failed to reach OpenRouter:', error);
    jsonResponse(res, 502, { error: 'Failed to reach upstream model provider' }, origin);
    return;
  }

  const responseHeaders = {};
  openrouterResponse.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  setCorsHeaders(res, origin);
  Object.entries(responseHeaders).forEach(([key, value]) => {
    if (key.toLowerCase() === 'content-length') {
      res.removeHeader('Content-Length');
      return;
    }
    res.setHeader(key, value);
  });

  let assistantMessage = '';
  let assistantUsedTools = false;

  if (payload.stream) {
    res.writeHead(openrouterResponse.status);
    const decoder = new TextDecoder();
    let sseBuffer = '';
    const reader = openrouterResponse.body?.getReader();
    if (!reader) {
      res.end();
    } else {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          res.write(Buffer.from(value));
          sseBuffer += decoder.decode(value, { stream: true });
        }
      }
      sseBuffer += decoder.decode();
      res.end();
      const parsed = parseAssistantFromSSE(sseBuffer);
      assistantMessage = parsed.text;
      assistantUsedTools = parsed.hasToolCalls;
    }
  } else {
    const responseText = await openrouterResponse.text();
    res.statusCode = openrouterResponse.status;
    res.end(responseText);
    const parsed = parseAssistantFromJSON(responseText);
    assistantMessage = parsed.text;
    assistantUsedTools = parsed.hasToolCalls;
  }

  if (!openrouterResponse.ok) {
    console.error('OpenRouter responded with error status:', openrouterResponse.status);
    return;
  }

  const latestUserMessage = buildLatestUserMessage(payload.messages);
  const kbSnippet = extractKbSnippet(payload.messages);

  const shouldPersist = !assistantUsedTools;

  if (app && user && session && shouldPersist) {
    const key = sessionKey(app.id, user.id, session.id);
    const turnNumber = incrementTurnCount(key);
    const summary =
      turnNumber % 5 === 0 || (latestUserMessage.length + assistantMessage.length > 800)
        ? buildSummary(latestUserMessage, assistantMessage, turnNumber)
        : '';
    await persistTurn({
      appId: app.id,
      userId: user.id,
      sessionId: session.id,
      userMessage: latestUserMessage,
      assistantMessage,
      honchoContent,
      kbSnippet,
      summary,
    });
  } else if (assistantUsedTools) {
    console.log('Skipping Honcho persistence for tool-call turn');
  }
});

function buildLatestUserMessage(messages) {
  const reversed = [...messages].reverse();
  const lastUser = reversed.find((msg) => msg.role === 'user');
  return lastUser ? extractText(lastUser.content) : '';
}

server.listen(PORT, () => {
  console.log(`Memory proxy listening on port ${PORT}`);
});
