# Honcho Working Representations Formatting Report
## Comprehensive Analysis of tutor-gpt Codebase

### Executive Summary
The tutor-gpt codebase implements a sophisticated three-stage processing pipeline where Honcho (a memory and personalization engine) provides "working representations" of user psychology that are formatted and injected into LLM prompts. This report documents the complete flow from API calls through transformation to LLM injection.

---

## 1. HONCHO CLIENT INITIALIZATION

### File: `/home/user/tutor-gpt/utils/honcho.ts`
**Lines: 1-34**

```typescript
import { Honcho } from 'honcho-ai';
import { unstable_cache } from 'next/cache';

export const honcho = new Honcho({
  baseURL: process.env.HONCHO_URL!,
});

export const getHonchoApp = unstable_cache(
  async () => {
    return await honcho.apps.getOrCreate(process.env.HONCHO_APP_NAME!, {
      timeout: 5 * 1000,
      maxRetries: 5,
    });
  },
  [],
  {
    revalidate: 300, // 5 minutes
  }
);

export const getHonchoUser = unstable_cache(
  async (userId: string) => {
    const app = await getHonchoApp();
    return await honcho.apps.users.getOrCreate(app.id, userId, {
      timeout: 5 * 1000,
      maxRetries: 5,
    });
  },
  [],
  {
    revalidate: 300,
  }
);
```

**Key Points:**
- Uses `honcho-ai` SDK with caching via Next.js `unstable_cache`
- 5-minute revalidation for app and user lookups
- 5-second timeout with 5 retries for all API calls

---

## 2. WORKING REPRESENTATIONS RETRIEVAL PIPELINE

### File: `/home/user/tutor-gpt/utils/ai/conversation.ts`
**Lines: 8-85 (fetchConversationHistory)**

This is the primary function that retrieves working representations from Honcho:

```typescript
export const MAX_CONTEXT_SIZE = 11;
export const SUMMARY_SIZE = 5;

export async function fetchConversationHistory(
  appId: string,
  userId: string,
  conversationId: string
): Promise<ConversationHistory> {
  const [
    messageIter,
    thoughtIter,
    honchoIter,
    pdfIter,
    summaryIter,
    collectionIter,
  ] = await Promise.all([
    honcho.apps.users.sessions.messages.list(appId, userId, conversationId, {
      reverse: true,
      size: MAX_CONTEXT_SIZE,
    }),
    honcho.apps.users.metamessages.list(
      appId,
      userId,
      {
        session_id: conversationId,
        metamessage_type: 'thought',
        reverse: true,
        size: MAX_CONTEXT_SIZE,
      }
    ),
    honcho.apps.users.metamessages.list(
      appId,
      userId,
      {
        session_id: conversationId,
        metamessage_type: 'honcho',
        reverse: true,
        size: MAX_CONTEXT_SIZE,
      }
    ),
    honcho.apps.users.metamessages.list(
      appId,
      userId,
      {
        session_id: conversationId,
        metamessage_type: 'pdf',
        reverse: true,
        size: MAX_CONTEXT_SIZE,
      }
    ),
    honcho.apps.users.metamessages.list(
      appId,
      userId,
      {
        session_id: conversationId,
        metamessage_type: 'summary',
        reverse: true,
        size: 1,
      }
    ),
    honcho.apps.users.metamessages.list(
      appId,
      userId,
      {
        session_id: conversationId,
        metamessage_type: 'collection',
        reverse: true,
        size: 1,
      }
    ),
  ]);

  return {
    messages: Array.from(messageIter.items || []).reverse(),
    thoughts: Array.from(thoughtIter.items || []).reverse(),
    honchoMessages: Array.from(honchoIter.items || []).reverse(),
    pdfMessages: Array.from(pdfIter.items || []).reverse(),
    summaries: Array.from(summaryIter.items || []),
    collectionId: collectionIter.items?.[0]?.content,
  };
}
```

**Data Structure Retrieved:**
```typescript
interface ConversationHistory {
  messages: Message[];           // Regular conversation messages
  thoughts: MetaMessage[];       // Internal thinking process
  honchoMessages: MetaMessage[]; // **WORKING REPRESENTATIONS**
  pdfMessages: MetaMessage[];    // PDF-related metadata
  summaries: MetaMessage[];      // Summary information
  collectionId?: string;         // PDF collection ID
}

interface Message {
  id: string;
  is_user: boolean;
  content: string;
}

interface MetaMessage {
  message_id: string | null;
  content: string;  // **Raw working representation content**
}
```

---

## 3. WORKING REPRESENTATIONS TRANSFORMATION

### Stage 1: Building the Thought Prompt
**File: `/home/user/tutor-gpt/utils/ai/prompts.ts`**
**Lines: 33-114 (buildThoughtPrompt function)**

This function transforms raw Honcho messages into XML-tagged prompts for the "Empath" agent:

```typescript
export function buildThoughtPrompt(
  messageHistory: Message[],
  thoughtHistory: MetaMessage[],
  honchoHistory: MetaMessage[],      // **WORKING REPS INPUT**
  pdfHistory: MetaMessage[],
  currentMessage: string,
  hasPDF: boolean
) {
  const thoughtProcessedHistory = messageHistory.map((message, i) => {
    if (message.is_user) {
      if (i === 0 || i === messageHistory.length - 1) {
        return user`${message.content}`;
      }

      // Find previous AI and user messages
      let prevAiIndex = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (!messageHistory[j].is_user) {
          prevAiIndex = j;
          break;
        }
      }

      let prevUserIndex = -1;
      for (let j = prevAiIndex - 1; j >= 0; j--) {
        if (messageHistory[j].is_user) {
          prevUserIndex = j;
          break;
        }
      }

      // **WORKING REPRESENTATION LOOKUP**
      const honchoResponse =
        prevUserIndex >= 0
          ? honchoHistory.find(
              (h) => h.message_id === messageHistory[prevUserIndex].id
            )
          : null;

      const pdfResponse =
        prevUserIndex >= 0
          ? pdfHistory.find(
              (p) => p.message_id === messageHistory[prevUserIndex].id
            )
          : null;

      const tutorResponse =
        prevAiIndex >= 0 ? messageHistory[prevAiIndex] : null;

      // **XML FORMATTING OF WORKING REPRESENTATIONS**
      return user`
      <honcho-response>${honchoResponse?.content || 'None'}</honcho-response>
      <pdf-response>${pdfResponse?.content || 'None'}</pdf-response>
      <tutor>${tutorResponse?.content || 'None'}</tutor>
      ${message.content}`;
    } else {
      // AI response - include thought history
      let prevUserIndex = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (messageHistory[j].is_user) {
          prevUserIndex = j;
          break;
        }
      }

      const thoughtResponse =
        prevUserIndex >= 0
          ? thoughtHistory.find(
              (t) => t.message_id === messageHistory[prevUserIndex].id
            )
          : null;

      return assistant`${thoughtResponse?.content || 'None'}`;
    }
  });

  // **FINAL MESSAGE WITH LATEST HONCHO WORKING REPRESENTATION**
  const finalMessage = user`
  <honcho-response>${honchoHistory.length > 0 ? honchoHistory[honchoHistory.length - 1]?.content || 'None' : 'None'}</honcho-response>
  <pdf-response>${pdfHistory.length > 0 ? pdfHistory[pdfHistory.length - 1]?.content || 'None' : 'None'}</pdf-response>
  <tutor>${messageHistory.length > 0 && !messageHistory[messageHistory.length - 1].is_user ? messageHistory[messageHistory.length - 1]?.content || 'None' : 'None'}</tutor>
  <pdf-available>${hasPDF}</pdf-available>
  <current_message>${currentMessage}</current_message>`;

  return [...thoughtWithPDFPrompt, ...thoughtProcessedHistory, finalMessage];
}
```

**Transformation Output Format:**
```
User message with injected Honcho working representation:

<honcho-response>[WORKING_REP_CONTENT]</honcho-response>
<pdf-response>[PDF_CONTENT]</pdf-response>
<tutor>[PREVIOUS_TUTOR_RESPONSE]</tutor>
[USER_MESSAGE_TEXT]
```

### Stage 2: Querying Honcho for Memory Augmentation
**File: `/home/user/tutor-gpt/utils/ai/index.ts`**
**Lines: 132-142**

```typescript
const [honchoContent, { pdfContent, collectionId }] = await Promise.all([
  // HONCHO STUFF
  (async () => {
    // **CRITICAL STEP: Query Honcho with the Empath-generated query**
    const { content: honchoContent } = await honcho.apps.users.sessions.chat(
      appId,
      userId,
      conversationId,
      { queries: honchoQuery }  // Query string from Empath
    );
    return honchoContent;
  })(),
  // PDF STUFF...
]);
```

**Input Format:**
- `honchoQuery`: String generated by Empath agent from thought stream
- `queries` parameter: Query string sent to Honcho's semantic search

**Output Format:**
```typescript
{
  content: string  // Memory augmentation/personalization context
}
```

### Stage 3: Building the Response Prompt
**File: `/home/user/tutor-gpt/utils/ai/prompts.ts`**
**Lines: 116-162 (buildResponsePrompt function)**

```typescript
export function buildResponsePrompt(
  messageHistory: Message[],
  honchoHistory: MetaMessage[],      // **PREVIOUS WORKING REPS**
  pdfHistory: MetaMessage[],
  currentMessage: string,
  honchoContent: string,              // **FRESH HONCHO QUERY RESULT**
  pdfContent: string,
  lastSummary?: string
) {
  const responseHistory = [];

  for (let i = 0; i < messageHistory.length; i++) {
    const message = messageHistory[i];

    if (message.is_user) {
      // **LOOKUP PREVIOUS WORKING REPRESENTATIONS BY MESSAGE ID**
      const honchoMessage =
        honchoHistory.find((m) => m.message_id === message.id)?.content ||
        'No Honcho Message';

      const pdfMessage =
        pdfHistory.find((m) => m.message_id === message.id)?.content ||
        'No PDF Message';

      // **INJECT INTO CONTEXT TAGS**
      responseHistory.push(
        user`<context>${honchoMessage}</context>
        <pdf_context>${pdfMessage}</pdf_context>
        ${message.content}`
      );

      if (i + 1 < messageHistory.length && !messageHistory[i + 1].is_user) {
        responseHistory.push(assistant`${messageHistory[i + 1].content}`);
      }
    }
  }

  // **INJECT LATEST HONCHO CONTENT INTO RESPONSE PROMPT**
  const summaryMessage = user`<past_summary>${lastSummary || ''}</past_summary>`;
  const mostRecentMessage = user`<context>${honchoContent}</context>
  <pdf_context>${pdfContent}</pdf_context>
  <current_message>${currentMessage}</current_message>`;

  return [
    ...responsePrompt,
    summaryMessage,
    ...responseHistory,
    mostRecentMessage,
  ];
}
```

**Final LLM Prompt Format (Bloom Tutor Response):**
```xml
<context>[HONCHO_WORKING_REPRESENTATION]</context>
<pdf_context>[PDF_CONTENT]</pdf_context>
<current_message>[USER_MESSAGE]</current_message>
```

---

## 4. HONCHO API CALLS & WORKING REPRESENTATIONS

### 4.1 Primary Working Representation Query
**File: `/home/user/tutor-gpt/utils/ai/index.ts`**
**Line: 135**

```typescript
const { content: honchoContent } = await honcho.apps.users.sessions.chat(
  appId,
  userId,
  conversationId,
  { queries: honchoQuery }
);
```

**Parameters:**
- `appId`: Honcho application ID
- `userId`: Honcho user ID  
- `conversationId`: Honcho session ID
- `queries`: String query for semantic search over user's memory

**Response:** `{ content: string }` - The semantic search results from Honcho

### 4.2 Working Representations Persistence
**File: `/home/user/tutor-gpt/utils/ai/conversation.ts`**
**Lines: 87-173 (saveConversation function)**

```typescript
export async function saveConversation(
  appId: string,
  userId: string,
  conversationId: string,
  userMessage: string,
  thought: string,
  honchoContent: string,    // **RETURNED HONCHO CONTENT**
  pdfContent: string,
  response: string,
  collectionId?: string
) {
  // Save the user message
  const newUserMessage = await honcho.apps.users.sessions.messages.create(
    appId,
    userId,
    conversationId,
    {
      is_user: true,
      content: userMessage,
    }
  );

  // Save the thought metamessage
  await honcho.apps.users.metamessages.create(
    appId,
    userId,
    {
      session_id: conversationId,
      message_id: newUserMessage.id,
      metamessage_type: 'thought',
      content: thought || '',
      metadata: { type: 'assistant' },
    }
  );

  // **SAVE HONCHO WORKING REPRESENTATION METAMESSAGE**
  await honcho.apps.users.metamessages.create(
    appId,
    userId,
    {
      session_id: conversationId,
      message_id: newUserMessage.id,
      metamessage_type: 'honcho',        // **TYPE**
      content: honchoContent || '',      // **WORKING REP CONTENT**
      metadata: { type: 'assistant' },
    }
  );

  // Save PDF metamessage
  await honcho.apps.users.metamessages.create(
    appId,
    userId,
    {
      session_id: conversationId,
      message_id: newUserMessage.id,
      metamessage_type: 'pdf',
      content: pdfContent || '',
      metadata: { type: 'assistant' },
    }
  );

  // Save the assistant response
  await honcho.apps.users.sessions.messages.create(
    appId,
    userId,
    conversationId,
    {
      is_user: false,
      content: response,
    }
  );
}
```

**Storage Structure:**
- **Type:** `metamessage_type: 'honcho'`
- **Content:** Raw string from `honcho.apps.users.sessions.chat()`
- **Metadata:** `{ type: 'assistant' }`
- **Association:** Linked to `message_id` of the user message it was queried for

---

## 5. COMPLETE REQUEST FLOW WITH WORKING REPRESENTATIONS

### File: `/home/user/tutor-gpt/memory-proxy/src/server.ts`
**Lines: 257-618 (handleChatCompletion)**

Full working representation lifecycle:

```typescript
async function handleChatCompletion(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  payload: ChatCompletionPayload,
  origin?: string
) {
  // 1. LOAD CONVERSATION HISTORY (including working representations)
  const history = await fetchConversationHistory(
    app.id,
    user.id,
    conversationId
  );

  // 2. BUILD THOUGHT PROMPT WITH INJECTED HONCHO WORKING REPRESENTATIONS
  const thoughtPrompt = buildThoughtPrompt(
    history.messages,
    history.thoughts,
    history.honchoMessages,        // **INJECTED HERE**
    history.pdfMessages,
    latestUserMessage,
    Boolean(payload.files || history.collectionId)
  );

  // 3. STREAM THOUGHT GENERATION (Empath agent)
  const { textStream: thoughtStream } = streamText({
    messages: thoughtPrompt,
    metadata: {
      sessionId: conversationId,
      userId: user.id,
      type: 'thought',
    },
  });

  // Parse delimiters to extract honchoQuery
  let honchoQuery = '';
  for await (const chunk of thoughtStream) {
    rawThought += chunk;
    // Parse ␁ delimiters for honcho/pdf queries
  }

  // 4. **QUERY HONCHO WITH EMPATH-GENERATED QUERY**
  const { content } = await honcho.apps.users.sessions.chat(
    app.id,
    user.id,
    conversationId,
    { queries: honchoQuery }
  );
  const honchoContent = content as string;

  // 5. BUILD RESPONSE PROMPT WITH NEW HONCHO CONTENT
  const responsePrompt = buildResponsePrompt(
    history.messages,
    history.honchoMessages,
    history.pdfMessages,
    latestUserMessage,
    honchoContent,                 // **INJECTED HERE**
    pdfResult.pdfContent,
    lastSummary
  );

  // 6. STREAM RESPONSE GENERATION (Bloom tutor)
  const { textStream: responseStream } = streamText({
    messages: responsePrompt,
    metadata: {
      sessionId: conversationId,
      userId: user.id,
      type: 'response',
    },
  });

  // 7. SAVE EVERYTHING (including working representations)
  await saveConversation(
    app.id,
    user.id,
    conversationId,
    latestUserMessage,
    rawThought,
    honchoContent,                 // **PERSISTED HERE**
    pdfResult.pdfContent,
    responseText,
    pdfResult.collectionId
  );
}
```

---

## 6. COLLECTION-BASED WORKING REPRESENTATIONS

### File: `/home/user/tutor-gpt/utils/pdfChat.ts`
**Lines: 50-77 (collectionChat function)**

```typescript
export async function collectionChat({
  collectionId,
  question,
  metadata,
}: CollectionChatParams): Promise<string> {
  // **QUERY HONCHO COLLECTIONS (vector search)**
  const documents = (await honcho.apps.users.collections.documents.query(
    metadata.appId,
    metadata.userId,
    collectionId,
    { query: question }
  )) as HonchoDocument[];

  // **TRANSFORM: Combine document contents into context**
  const collectionContent = documents
    .map((doc: HonchoDocument) => doc.content)
    .join('\n\n');

  // **INJECT INTO PDF CONTEXT**
  return pdfChat({
    pdfContext: collectionContent,    // **THIS IS A WORKING REPRESENTATION**
    question,
    metadata: {
      sessionId: metadata.sessionId,
      userId: metadata.userId,
    },
  });
}
```

**Honcho Collection API Call:**
```typescript
interface HonchoDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}
```

---

## 7. PROMPT ENGINEERING FOR HONCHO INTEGRATION

### System Prompt Context
**File: `/home/user/tutor-gpt/utils/prompts/thought.ts`**
**Lines: 9-79 (Empath Agent Role Definition)**

The Empath agent is instructed to query Honcho as an "oracle":

```
"You can think of Honcho as an "oracle" to the user. It contains a rich, 
high-fidelity rendering of the user's psychology and part of your job is 
to query it surgically to get information on the user that Tutor can use 
to demonstrate exceptional social cognition, i.e. allow it to understand 
the user's personality, state, and preferences on a deep, psychological level."

Output Format:
- Start with internal thinking process
- Use '␁' as delimiter
- Followed by Honcho query
- Second '␁' (if PDF available) followed by PDF query
```

### Bloom Tutor Role Definition
**File: `/home/user/tutor-gpt/utils/prompts/response.ts`**
**Lines: 14-21**

```
"Honcho is key to maintaining a detailed mental model of the student. 
The other instance of you has been asking Honcho questions about the user, 
and we're providing you Honcho's response in the user message within the 
<context></context> XML tags. This should be taken into account when 
you're responding to the user, but honcho doesn't need to be mentioned 
to them unless you're explicitly asked about how you work."
```

---

## 8. WORKING REPRESENTATIONS IN RETRIEVALS

### File: `/home/user/tutor-gpt/app/actions/messages.ts`
**Lines: 7-126 (buildThinkingDataMap)**

Shows how working representations are retrieved for frontend display:

```typescript
async function buildThinkingDataMap(
  appId: string,
  userId: string,
  conversationId: string,
  messages: any[]
): Promise<Map<string, ThinkingData>> {
  // **FETCH ALL METAMESSAGE TYPES**
  const [allThoughts, allHoncho, allPdf] = await Promise.all([
    honcho.apps.users.metamessages.list(appId, userId, {
      session_id: conversationId,
      metamessage_type: 'thought',
      filter: { type: 'assistant' },
    }),
    honcho.apps.users.metamessages.list(appId, userId, {
      session_id: conversationId,
      metamessage_type: 'honcho',      // **WORKING REPS**
      filter: { type: 'assistant' },
    }),
    honcho.apps.users.metamessages.list(appId, userId, {
      session_id: conversationId,
      metamessage_type: 'pdf',
      filter: { type: 'assistant' },
    }),
  ]);

  // Build maps for quick lookup
  const honchoMap = new Map<string, string>();
  allHoncho.items.forEach((item) => {
    if (item.message_id && userMessageIds.includes(item.message_id)) {
      honchoMap.set(item.message_id, item.content);  // **STORE WORKING REP**
    }
  });

  // Create thinking data keyed by AI message IDs
  const thinkingDataMap = new Map<string, ThinkingData>();
  userToAiMessageMap.forEach((aiMessageId, userMessageId) => {
    const honchoResponse = honchoMap.get(userMessageId) || '';  // **RETRIEVE**

    thinkingDataMap.set(aiMessageId, {
      thoughtContent,
      thoughtFinished: true,
      honchoQuery,
      honchoResponse,                  // **INJECTED INTO THINKING DATA**
      pdfQuery,
      pdfResponse,
    });
  });

  return thinkingDataMap;
}
```

**Output Format (TypeScript interface):**
```typescript
interface ThinkingData {
  thoughtContent: string;
  thoughtFinished: boolean;
  honchoQuery?: string;
  honchoResponse?: string;     // **WORKING REPRESENTATION**
  pdfQuery?: string;
  pdfResponse?: string;
}
```

---

## 9. SUMMARY GENERATION WITH WORKING REPRESENTATIONS

### File: `/home/user/tutor-gpt/utils/ai/summary.ts`
**Lines: 9-83 (checkAndGenerateSummary)**

Working representations contribute to summary creation:

```typescript
export async function checkAndGenerateSummary(
  appId: string,
  userId: string,
  conversationId: string,
  messageHistory: Message[],
  summaryHistory: MetaMessage[],
  lastSummary?: string
) {
  // Determine if summary is needed based on message count
  const needsSummary = messagesSinceLastSummary >= MAX_CONTEXT_SIZE;

  if (!needsSummary) {
    return;
  }

  // Build context from conversation
  const recentMessages = messageHistory.slice(-MAX_CONTEXT_SIZE);
  const messagesToSummarize = recentMessages.slice(0, SUMMARY_SIZE);

  const formattedMessages = messagesToSummarize.map((msg) => {
    if (msg.is_user) {
      return `User: ${msg.content}`;
    }
    return `Assistant: ${msg.content}`;
  });

  // Generate new summary incorporating previous summary
  const summary = await generateText({
    messages: summaryMessages,
    metadata: {
      sessionId: conversationId,
      userId,
      type: 'summary',
    },
  });

  // **SAVE SUMMARY AS METAMESSAGE**
  if (newSummary) {
    await honcho.apps.users.metamessages.create(
      appId,
      userId,
      {
        session_id: conversationId,
        message_id: lastMessageOfSummary.id,
        metamessage_type: 'summary',
        content: newSummary,
        metadata: { type: 'assistant' },
      }
    );
  }
}
```

---

## 10. FORMATTING PIPELINE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HONCHO WORKING REPRESENTATION FLOW                │
└─────────────────────────────────────────────────────────────────────┘

1. RETRIEVAL PHASE
   ├─ fetchConversationHistory()
   │  ├─ Fetch messages (is_user=true/false)
   │  ├─ Fetch metamessages with type='honcho'
   │  ├─ Fetch metamessages with type='thought'
   │  └─ Fetch metamessages with type='pdf'
   └─ Returns: { messages, honchoMessages, ... }

2. INJECTION PHASE (EMPATH)
   ├─ buildThoughtPrompt()
   │  ├─ Lookup honchoMessages by message_id
   │  ├─ Wrap in <honcho-response> XML tags
   │  └─ Inject into prompt for Empath agent
   └─ Output: Prompt with historical working representations

3. QUERY GENERATION PHASE
   ├─ Stream Empath response parsing
   │  ├─ Extract thought process
   │  ├─ Parse ␁ delimiter
   │  └─ Extract honchoQuery string
   └─ Output: String query for Honcho

4. SEMANTIC SEARCH PHASE
   ├─ honcho.apps.users.sessions.chat()
   │  ├─ Input: { queries: honchoQuery }
   │  └─ Output: { content: string }
   └─ Result: Fresh working representation

5. INJECTION PHASE (BLOOM)
   ├─ buildResponsePrompt()
   │  ├─ Lookup honchoMessages by message_id (history)
   │  ├─ Inject in <context> tags
   │  ├─ Wrap fresh result in <context> tags
   │  └─ Inject into prompt for Bloom agent
   └─ Output: Prompt with working representations

6. RESPONSE GENERATION PHASE
   ├─ Stream Bloom response
   ├─ Buffer full response
   └─ Output: Tutor's personalized response

7. PERSISTENCE PHASE
   ├─ saveConversation()
   │  ├─ Create metamessage with type='honcho'
   │  ├─ Content: honchoContent from step 4
   │  ├─ message_id: Link to user message
   │  └─ metadata: { type: 'assistant' }
   └─ Next iteration: Working representation available for retrieval
```

---

## 11. DATA FLOW SUMMARY TABLE

| Stage | Input | Processing | Output | Format |
|-------|-------|-----------|--------|--------|
| Retrieval | Honcho API | metamessages.list(type='honcho') | MetaMessage[] | `{ message_id, content }` |
| Empath Injection | MetaMessage[] | buildThoughtPrompt() | Prompt | `<honcho-response>${content}</honcho-response>` |
| Query Generation | Empath stream | Parse ␁ delimiter | String query | `"query string"` |
| Semantic Search | Query string | honcho.apps.users.sessions.chat() | { content } | Plain text |
| Bloom Injection | Fresh content | buildResponsePrompt() | Prompt | `<context>${content}</context>` |
| Response Gen | Prompt | streamText() | String response | Conversational |
| Persistence | honchoContent | honcho.apps.users.metamessages.create() | MetaMessage | `{ type: 'honcho', content }` |

---

## 12. KEY CODE SNIPPETS REFERENCE

### Complete Query-to-Response Cycle
**File: `/home/user/tutor-gpt/utils/ai/index.ts` (Lines 132-285)**

Shows end-to-end transformation:
```typescript
// STEP 1: Query Honcho
const { content: honchoContent } = await honcho.apps.users.sessions.chat(
  appId,
  userId,
  conversationId,
  { queries: honchoQuery }  // From Empath
);

// STEP 2: Build response prompt with working representation
const responsePrompt = buildResponsePrompt(
  messageHistory,
  honchoHistory,           // Previous working reps
  pdfHistory,
  message,
  honchoContent,           // Fresh working rep
  pdfContent,
  lastSummary
);

// STEP 3: Generate response with context
const { textStream: responseStream } = streamText({
  messages: responsePrompt,
  metadata: { sessionId: conversationId, userId, type: 'response' },
});

// STEP 4: Persist working representation
await saveConversation(
  appId,
  userId,
  conversationId,
  message,
  thought,
  honchoContent,           // Save for future retrieval
  pdfContent,
  response,
  collectionId
);
```

---

## 13. CONFIGURATION & DEPENDENCIES

**Environment Variables:**
- `HONCHO_URL`: Base URL for Honcho API
- `HONCHO_APP_NAME`: Application identifier in Honcho
- `HONCHO_API_KEY`: Authentication for Honcho API

**Dependencies:**
- `honcho-ai`: Official SDK for Honcho API

**Caching:**
- Next.js `unstable_cache` for app/user lookups (5-minute revalidation)

---

## Conclusion

Honcho working representations are formatted through a carefully orchestrated pipeline:

1. **Retrieved** as `metamessage_type='honcho'` from Honcho's API
2. **Formatted** into XML tags (`<honcho-response>`, `<context>`)
3. **Injected** into prompts at strategic points (Empath → Bloom)
4. **Queried** via semantic search based on agent-generated queries
5. **Transformed** from raw API responses into LLM-consumable context
6. **Persisted** back as metamessages for subsequent retrievals

This enables Bloom (the tutor) to maintain contextual awareness of user psychology and preferences across stateless LLM invocations.
