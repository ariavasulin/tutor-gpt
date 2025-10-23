import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import dotenv from 'dotenv';

import { honcho, getHonchoApp, getHonchoUser } from './honchoClient';
import {
  fetchConversationHistory,
  saveConversation,
} from './conversation';
import { buildThoughtPrompt, buildResponsePrompt } from '@/utils/ai/prompts';
import { streamText } from '@/utils/ai';
import { formatStreamChunk } from '@/utils/ai/stream';
import { checkAndGenerateSummary } from '@/utils/ai/summary';
import { collectionChat } from '@/utils/pdfChat';
import { parsePDF } from '@/utils/parsePdf';

interface StreamChunkPayload {
  type:
    | 'thought'
    | 'honcho'
    | 'response'
    | 'pdf'
    | 'honchoQuery'
    | 'pdfQuery';
  text: string;
}

interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

interface UploadedFile {
  name: string;
  data: string;
}

interface ChatCompletionPayload {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  user?: string;
  files?: UploadedFile[];
}

interface HonchoSession {
  id: string;
}

const MAX_COLLECTION_SIZE_IN_MB = 5;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const PORT = Number.parseInt(process.env.PORT || '8081', 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY;
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!PROXY_API_KEY) {
  throw new Error('PROXY_API_KEY must be defined in the environment');
}
if (!process.env.HONCHO_URL) {
  throw new Error('HONCHO_URL must be defined in the environment');
}
if (!process.env.HONCHO_APP_NAME) {
  throw new Error('HONCHO_APP_NAME must be defined in the environment');
}
if (!process.env.HONCHO_API_KEY) {
  throw new Error('HONCHO_API_KEY must be defined in the environment');
}
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY must be defined in the environment');
}

if (!process.env.AI_API_KEY) {
  process.env.AI_API_KEY = process.env.OPENROUTER_API_KEY;
}
if (!process.env.AI_BASE_URL && process.env.OPENROUTER_BASE_URL) {
  process.env.AI_BASE_URL = process.env.OPENROUTER_BASE_URL;
}
if (!process.env.AI_PROVIDER) {
  process.env.AI_PROVIDER = 'openrouter';
}

function createHonchoAppLoader() {
  let promise: Promise<{ id: string }> | undefined;
  return () => {
    if (!promise) {
      promise = (async () => {
        try {
          return await getHonchoApp();
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('incrementalCache missing')
          ) {
            return await honcho.apps.getOrCreate(
              process.env.HONCHO_APP_NAME!,
              {
                timeout: 5 * 1000,
                maxRetries: 5,
              }
            );
          }
          throw error;
        }
      })();
    }
    return promise;
  };
}

const loadHonchoApp = createHonchoAppLoader();
const sessionCache = new Map<string, Promise<HonchoSession>>();
const decoder = new TextDecoder();

function setCorsHeaders(res: http.ServerResponse, origin?: string) {
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

function getHeader(req: http.IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  origin?: string
) {
  if (!res.headersSent) {
    setCorsHeaders(res, origin);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
  }
  res.end(JSON.stringify(body));
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function normalizeMessageContent(
  content: ChatMessage['content']
): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => (part.type === 'text' ? part.text || '' : ''))
    .join('');
}

export function extractLatestUserMessage(messages: ChatMessage[]) {
  const reversed = [...messages].reverse();
  for (const message of reversed) {
    if (message.role === 'user') {
      return normalizeMessageContent(message.content);
    }
  }
  return '';
}

export function deterministicId(seed: string) {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

async function ensureSession(
  appId: string,
  userId: string,
  externalId: string
): Promise<HonchoSession> {
  const cacheKey = `${appId}:${userId}:${externalId}`;
  if (!sessionCache.has(cacheKey)) {
    const promise = (async () => {
      const iterator = honcho.apps.users.sessions.list(appId, userId, {
        size: 1,
        filter: { external_id: externalId },
      });

      for await (const session of iterator) {
        return session as HonchoSession;
      }

      const created = await honcho.apps.users.sessions.create(appId, userId, {
        external_id: externalId,
      });
      return created as HonchoSession;
    })();

    sessionCache.set(cacheKey, promise);
  }

  return sessionCache.get(cacheKey)!;
}

async function parseFiles(files?: UploadedFile[]) {
  if (!files || files.length === 0) {
    return undefined;
  }

  const filePromises = files.map(async (file) => {
    const buffer = Buffer.from(file.data, 'base64');
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    return await parsePDF(arrayBuffer, file.name);
  });

  const pages = await Promise.all(filePromises);
  return pages.flat();
}

function sendSseData(res: http.ServerResponse, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSseDone(res: http.ServerResponse) {
  res.write('data: [DONE]\n\n');
}

async function handleChatCompletion(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  payload: ChatCompletionPayload,
  origin?: string
) {
  const authHeader = getHeader(req, 'authorization');
  if (!authHeader || authHeader !== `Bearer ${PROXY_API_KEY}`) {
    sendJson(res, 401, { error: 'Unauthorized' }, origin);
    return;
  }

  if (!payload.messages || payload.messages.length === 0) {
    sendJson(res, 400, { error: 'messages array is required' }, origin);
    return;
  }

  const userIdentifier =
    getHeader(req, 'x-user-id') || payload.user || 'openwebui-user';

  const latestUserMessage = extractLatestUserMessage(payload.messages);
  if (!latestUserMessage) {
    sendJson(res, 400, { error: 'user message is required' }, origin);
    return;
  }

  const sessionHeader = getHeader(req, 'x-session-id');
  const sessionIdentifier =
    sessionHeader ||
    deterministicId(`${userIdentifier}:${payload.model || 'default'}`);

  const app = await loadHonchoApp();
  const user = await getHonchoUser(userIdentifier);
  const session = await ensureSession(app.id, user.id, sessionIdentifier);
  const conversationId = session.id;

  const history = await fetchConversationHistory(
    app.id,
    user.id,
    conversationId
  );

  const fileContentPromise = parseFiles(payload.files);

  const thoughtPrompt = buildThoughtPrompt(
    history.messages,
    history.thoughts,
    history.honchoMessages,
    history.pdfMessages,
    latestUserMessage,
    Boolean(payload.files || history.collectionId)
  );

  const { textStream: thoughtStream } = streamText({
    messages: thoughtPrompt,
    metadata: {
      sessionId: conversationId,
      userId: user.id,
      type: 'thought',
    },
  });

  let rawThought = '';
  let honchoQuery = '';
  let pdfQuery = '';
  let currentSection: 'thought' | 'honchoQuery' | 'pdfQuery' = 'thought';

  function processThoughtChunk(section: typeof currentSection, text: string) {
    if (!text) return;
    const buffer = formatStreamChunk({ type: section, text });
    const chunkPayload = JSON.parse(decoder.decode(buffer)) as StreamChunkPayload;
    if (chunkPayload.type === 'honchoQuery') {
      honchoQuery += chunkPayload.text;
    } else if (chunkPayload.type === 'pdfQuery') {
      pdfQuery += chunkPayload.text;
    }
  }

  for await (const chunk of thoughtStream) {
    rawThought += chunk;
    if (chunk.includes('␁')) {
      const segments = chunk.split('␁');
      const firstSegment = segments[0].trimEnd();
      if (firstSegment) {
        processThoughtChunk(currentSection, firstSegment);
      }

      for (let i = 1; i < segments.length; i++) {
        if (currentSection === 'thought') {
          currentSection = 'honchoQuery';
        } else if (currentSection === 'honchoQuery') {
          currentSection = 'pdfQuery';
        }
        const segment = i === 1 ? segments[i].trimStart() : segments[i];
        if (segment) {
          processThoughtChunk(currentSection, segment);
        }
      }
    } else {
      processThoughtChunk(currentSection, chunk);
    }
  }

  const [honchoContent, pdfResult] = await Promise.all([
    (async () => {
      if (!honchoQuery.trim()) {
        return '';
      }
      const { content } = await honcho.apps.users.sessions.chat(
        app.id,
        user.id,
        conversationId,
        { queries: honchoQuery }
      );
      return content as string;
    })(),
    (async () => {
      let pdfContent = '';
      let collectionId = history.collectionId;
      const fileContent = await fileContentPromise;

      if (fileContent && fileContent.length > 0) {
        let collection;
        const sizeInMB = fileContent.reduce((acc, page) => {
          return acc + page.length / 1024 / 1024;
        }, 0);

        if (collectionId) {
          collection = await honcho.apps.users.collections.get(
            app.id,
            user.id,
            { collection_id: collectionId }
          );
          const currentSize = (collection.metadata?.size as number | undefined) || 0;
          if (currentSize + sizeInMB < MAX_COLLECTION_SIZE_IN_MB) {
            await honcho.apps.users.collections.update(
              app.id,
              user.id,
              collectionId,
              {
                metadata: {
                  size: currentSize + sizeInMB,
                },
              }
            );
          } else {
            return {
              pdfContent:
                'The user has reached the maximum file amount for this chat. Bloom, please inform them that they need to start a new conversation if they want to upload the new file that they just tried to upload. Thank you!',
              collectionId: undefined,
            };
          }
        } else {
          collection = await honcho.apps.users.collections.create(
            app.id,
            user.id,
            {
              name: `PDF Collection - ${conversationId}`,
              metadata: {
                size: sizeInMB,
              },
            }
          );
          collectionId = collection.id;
        }

        await Promise.all(
          fileContent.map((content, index) =>
            honcho.apps.users.collections.documents.create(
              app.id,
              user.id,
              collectionId!,
              {
                content,
                metadata: {
                  type: 'pdf',
                  page: index + 1,
                  conversationId,
                },
              }
            )
          )
        );
      }

      if (
        !collectionId ||
        pdfQuery.trim() === '' ||
        pdfQuery.trim().toLowerCase() === 'none'
      ) {
        return { pdfContent: '', collectionId };
      }

      try {
        pdfContent = await collectionChat({
          collectionId,
          question: pdfQuery,
          metadata: {
            sessionId: conversationId,
            userId: user.id,
            appId: app.id,
          },
        });
      } catch (error) {
        console.error('Error in collectionChat:', error);
        return {
          pdfContent: 'There was an error processing your PDF.',
          collectionId,
        };
      }

      return { pdfContent, collectionId };
    })(),
  ]);

  const lastSummary = history.summaries[0]?.content;

  const responsePrompt = buildResponsePrompt(
    history.messages,
    history.honchoMessages,
    history.pdfMessages,
    latestUserMessage,
    honchoContent,
    pdfResult.pdfContent,
    lastSummary
  );

  const { textStream: responseStream } = streamText({
    messages: responsePrompt,
    metadata: {
      sessionId: conversationId,
      userId: user.id,
      type: 'response',
    },
  });

  let responseText = '';
  let sentInitialRole = false;
  const created = Math.floor(Date.now() / 1000);
  const completionId = `chatcmpl-${conversationId}-${created}`;
  const modelName = payload.model || process.env.MODEL || 'unknown';

  if (payload.stream) {
    setCorsHeaders(res, origin);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
  }

  for await (const chunk of responseStream) {
    const buffer = formatStreamChunk({ type: 'response', text: chunk });
    const chunkPayload = JSON.parse(decoder.decode(buffer)) as StreamChunkPayload;

    if (!chunkPayload.text) {
      continue;
    }

    responseText += chunkPayload.text;

    if (!payload.stream) {
      continue;
    }

    if (!sentInitialRole) {
      sendSseData(res, {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant' },
            finish_reason: null,
          },
        ],
      });
      sentInitialRole = true;
    }

    sendSseData(res, {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: { content: chunkPayload.text },
          finish_reason: null,
        },
      ],
    });
  }

  if (payload.stream) {
    sendSseData(res, {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    });
    sendSseDone(res);
    res.end();
  } else {
    sendJson(
      res,
      200,
      {
        id: completionId,
        object: 'chat.completion',
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: responseText,
            },
            finish_reason: 'stop',
          },
        ],
      },
      origin
    );
  }

  const shouldPersist = true;

  if (shouldPersist) {
    await saveConversation(
      app.id,
      user.id,
      conversationId,
      latestUserMessage,
      rawThought,
      honchoContent,
      pdfResult.pdfContent,
      responseText,
      pdfResult.collectionId
    );

    await checkAndGenerateSummary(
      app.id,
      user.id,
      conversationId,
      history.messages,
      history.summaries,
      lastSummary
    );
  }
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const origin = getHeader(req, 'origin');

    if (req.method === 'OPTIONS') {
      setCorsHeaders(res, origin);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const bodyText = await readRequestBody(req);
      let payload: ChatCompletionPayload;
      try {
        payload = JSON.parse(bodyText);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body' }, origin);
        return;
      }

      await handleChatCompletion(req, res, payload, origin);
      return;
    }

    sendJson(res, 404, { error: 'Not Found' }, origin);
  } catch (error) {
    console.error('Unexpected error handling request:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal Server Error' });
    } else {
      res.end();
    }
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Memory proxy listening on port ${PORT}`);
  });
}
