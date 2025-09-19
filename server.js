// server.js — AI Agora Backend (modernized, auto-latest models)

// Memory monitoring ve crash prevention
setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log(`[MEMORY] Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  
  // 400MB'dan fazla kullanılırsa warning
  if (memUsage.heapUsed > 400 * 1024 * 1024) {
    console.warn('[WARNING] High memory usage detected');
  }
}, 10000); // Her 10 saniyede kontrol

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ====== ENV CHECKS ======
if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] OPENAI_API_KEY is missing in environment variables.');
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[WARN] ANTHROPIC_API_KEY is missing in environment variables.');
}
if (!process.env.GOOGLE_AI_API_KEY) {
  console.warn('[WARN] GOOGLE_AI_API_KEY is missing in environment variables.');
}

// ====== CLIENTS ======
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Google AI client with improved error handling
let genAI;
try {
  const googleApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (googleApiKey) {
    genAI = new GoogleGenerativeAI(googleApiKey);
    console.log('[INIT] Google AI client initialized successfully');
  } else {
    console.warn('[INIT] Google AI API key not found - Gemini will be unavailable');
  }
} catch (error) {
  console.error('[INIT] Failed to initialize Google AI client:', error.message);
}

// ====== MODEL CHOICES (auto "latest") ======
// OpenAI: latest stable GPT-4 model
const OPENAI_CHAT_MODEL = 'gpt-4o';
// Anthropic: latest Claude Sonnet 4 model (from API response)
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
// Google: latest stable Gemini 2.5 Pro model
const GEMINI_MODEL = "gemini-2.5-pro";

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json());

// ====== UTILS ======
function detectLanguage(text) {
  const tr = ['ve', 'bir', 'bu', 'da', 'de', 'ile', 'için', 'var', 'olan', 'çok', 'daha', 'en', 'şey', 'gibi', 'sonra'];
  const en = ['the', 'and', 'is', 'a', 'to', 'in', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as', 'with'];
  const es = ['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da'];
  const fr = ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son'];
  const de = ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im'];
  const ar = ['في', 'من', 'إلى', 'على', 'أن', 'هذا', 'هذه', 'كان', 'التي', 'الذي', 'ما', 'لا', 'أو', 'كل'];

  const t = (text || '').toLowerCase();
  const scores = {
    tr: tr.filter(w => t.includes(w)).length,
    en: en.filter(w => t.includes(w)).length,
    es: es.filter(w => t.includes(w)).length,
    fr: fr.filter(w => t.includes(w)).length,
    de: de.filter(w => t.includes(w)).length,
    ar: ar.filter(w => text.includes(w)).length, // keep rtl raw
  };
  return Object.keys(scores).reduce((a, b) => (scores[a] > scores[b] ? a : b));
}

function langLabel(code) {
  return ({ tr: 'Türkçe', en: 'English', es: 'Spanish', fr: 'French', de: 'German', ar: 'Arabic' }[code] || 'English');
}

// OpenAI chat via REST (avoids SDK surface differences)
async function openaiChat(messages, { model = OPENAI_CHAT_MODEL, max_tokens = 400, temperature = 0.7, stream = false } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens, temperature, stream }),
  });
  
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `OpenAI HTTP ${resp.status}`);
  }

  if (stream) {
    return resp.body;
  }
  
  return resp.json();
}

// ====== STREAMING UTILS ======
function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ====== ENDPOINTS ======
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'AI Agora Backend is running',
    timestamp: new Date().toISOString(),
    apis: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      google: !!process.env.GOOGLE_AI_API_KEY,
    },
    models: {
      openai: OPENAI_CHAT_MODEL,
      anthropic: CLAUDE_MODEL,
      gemini: GEMINI_MODEL,
    },
    features: {
      structuredOutput: true,
      languageDetection: true,
      parallelProcessing: true,
      moderatorStyles: ['neutral', 'analytical', 'educational', 'creative', 'quick-summary'],
    },
  });
});

app.post('/api/chat', async (req, res) => {
  const {
    question,
    language,
    conversation = [],
    moderatorStyle = 'neutral',
    roundCount = 1,
    enabledAIs: clientEnabledAIs = {},
    // iOS app compatibility
    includeGPT = true,
    includeClaude = true,
    includeGemini = true,
    includeModerator = true,
    moderatorSource = 'gpt',
  } = req.body;

  // Combine enabledAIs from new clients and fallback to include-params for older clients
  const enabledAIs = {
    gpt: clientEnabledAIs.gpt ?? includeGPT,
    claude: clientEnabledAIs.claude ?? includeClaude,
    gemini: clientEnabledAIs.gemini ?? includeGemini,
    moderator: clientEnabledAIs.moderator ?? includeModerator,
  };

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Question is required', success: false });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const cleanup = () => {
    if (!res.writableEnded) {
      res.end();
    }
    console.log('[STREAM] Connection closed.');
  };
  req.on('close', cleanup);

  try {
    const detectedLang = language || detectLanguage(question);
    const languageInstruction = langLabel(detectedLang);
    const userOnlyHistory = (Array.isArray(conversation) ? conversation : [])
      .map(msg => ({ role: msg?.sender === 'user' ? 'user' : 'assistant', content: msg?.text || '' }))
      .filter(m => !!m.content && m.role === 'user');

    const maxRounds = Math.max(1, Math.min(roundCount || 1, 3));
    let allRoundsResponses = [];

    sendSse(res, 'info', { message: 'Processing request...', settings: { maxRounds, enabledAIs } });

    for (let round = 1; round <= maxRounds; round++) {
      sendSse(res, 'round_start', { round, maxRounds });
      console.log(`[ROUND ${round}] Starting...`);

      let previousRoundsContext = allRoundsResponses.map((prevRound, index) => 
        `--- Round ${index + 1} Results ---\n` +
        Object.entries(prevRound).map(([ai, text]) => `${ai.toUpperCase()}: ${text}`).join('\n')
      ).join('\n\n');

      const streamingPromises = [];
      const roundResponses = {};

      // GPT Stream
      if (enabledAIs.gpt) {
        streamingPromises.push((async () => {
          let fullResponse = '';
          try {
            const messages = [
              { role: 'system', content: `You are ChatGPT. Respond in ${languageInstruction}. Keep answers concise.` },
              ...userOnlyHistory.slice(-3),
              { role: 'user', content: `Question: "${question}"\n\n${previousRoundsContext ? 'Previous rounds:\n' + previousRoundsContext + '\n\nYour turn:' : ''}` },
            ];
            const stream = await openaiChat(messages, { max_tokens: 400, stream: true });
            for await (const chunk of stream) {
              const content = chunk.choices?.[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                sendSse(res, 'chunk', { ai: 'gpt', content });
              }
            }
          } catch (err) {
            console.error('[STREAM] GPT Error:', err.message);
            fullResponse = `GPT Error: ${err.message}`;
            sendSse(res, 'error', { ai: 'gpt', message: err.message });
          }
          roundResponses.gpt = fullResponse;
          sendSse(res, 'stream_end', { ai: 'gpt' });
        })());
      }

      // Claude Stream
      if (enabledAIs.claude) {
        streamingPromises.push((async () => {
          let fullResponse = '';
          try {
            const stream = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: 400,
              system: `You are Claude. Respond in ${languageInstruction}. Keep answers concise.`,
              messages: [
                ...userOnlyHistory.slice(-3),
                { role: 'user', content: `Question: "${question}"\n\n${previousRoundsContext ? 'Previous rounds:\n' + previousRoundsContext + '\n\nYour turn:' : ''}` },
              ],
              stream: true,
            });
            for await (const event of stream) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                const content = event.delta.text;
                fullResponse += content;
                sendSse(res, 'chunk', { ai: 'claude', content });
              }
            }
          } catch (err) {
            console.error('[STREAM] Claude Error:', err.message);
            fullResponse = `Claude Error: ${err.message}`;
            sendSse(res, 'error', { ai: 'claude', message: err.message });
          }
          roundResponses.claude = fullResponse;
          sendSse(res, 'stream_end', { ai: 'claude' });
        })());
      }

      // Gemini Stream
      if (enabledAIs.gemini && genAI) {
        streamingPromises.push((async () => {
          let fullResponse = '';
          try {
            const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
            const chat = model.startChat({
              history: userOnlyHistory.slice(-3).map(m => ({ role: 'user', parts: [{ text: m.content }] })),
            });
            const result = await chat.sendMessageStream(`Question: "${question}"\n\n${previousRoundsContext ? 'Previous rounds:\n' + previousRoundsContext + '\n\nYour turn:' : ''} Respond in ${languageInstruction}.`);
            for await (const chunk of result.stream) {
              const content = chunk.text();
              fullResponse += content;
              sendSse(res, 'chunk', { ai: 'gemini', content });
            }
          } catch (err) {
            console.error('[STREAM] Gemini Error:', err.message);
            fullResponse = `Gemini Error: ${err.message}`;
            sendSse(res, 'error', { ai: 'gemini', message: err.message });
          }
          roundResponses.gemini = fullResponse;
          sendSse(res, 'stream_end', { ai: 'gemini' });
        })());
      }

      await Promise.all(streamingPromises);
      allRoundsResponses.push(roundResponses);
      sendSse(res, 'round_end', { round });
      console.log(`[ROUND ${round}] Finished.`);
    }

    // Moderator Logic (after all rounds and streams are complete)
    if (enabledAIs.moderator) {
      console.log('[MODERATOR] Generating response...');
      sendSse(res, 'moderator_start', {});
      let moderatorText = '';
      try {
        const finalResponses = allRoundsResponses[allRoundsResponses.length - 1];
        let moderatorContext = `User asked: "${question}"\n\n--- Final AI Responses ---\n`;
        if (finalResponses.gpt) moderatorContext += `GPT: ${finalResponses.gpt}\n`;
        if (finalResponses.claude) moderatorContext += `Claude: ${finalResponses.claude}\n`;
        if (finalResponses.gemini) moderatorContext += `Gemini: ${finalResponses.gemini}\n`;
        
        const moderatorPrompts = {
            neutral: `Summarize key points briefly in ${languageInstruction}.`,
            analytical: `Compare AI perspectives briefly in ${languageInstruction}.`,
            educational: `Explain briefly in ${languageInstruction}.`,
            creative: `Present information creatively but briefly in ${languageInstruction}.`,
            'quick-summary': `Very brief summary in ${languageInstruction}. 1-2 sentences max.`,
        };
        const moderatorPrompt = moderatorPrompts[moderatorStyle] || moderatorPrompts.neutral;

        // Using non-streaming for moderator as it's a final summary
        const modMessages = [{ role: 'system', content: moderatorPrompt }, { role: 'user', content: moderatorContext }];
        const modJson = await openaiChat(modMessages, { max_tokens: 200 });
        moderatorText = modJson.choices?.[0]?.message?.content || 'Moderator response error';

      } catch (err) {
        console.error('[MODERATOR] Error:', err.message);
        moderatorText = `Moderator Error: ${err.message}`;
      }
      sendSse(res, 'moderator_chunk', { content: moderatorText });
      sendSse(res, 'moderator_end', {});
      console.log('[MODERATOR] Response sent.');
    }

  } catch (error) {
    console.error('[STREAM] Top-level error:', error);
    sendSse(res, 'error', { error: 'A critical error occurred.', details: error.message });
  } finally {
    sendSse(res, 'done', { message: 'Stream complete.' });
    cleanup();
  }
});

app.post('/api/chat_non_streaming', async (req, res) => {
  try {
    const {
      question,
      language,
      conversation = [],
      moderatorStyle = 'neutral',
      structuredOutput = false,
      roundCount = 1,
      // iOS app compatibility parameters
      includeGPT = true,
      includeClaude = true, 
      includeGemini = true,
      includeModerator = true,
      moderatorSource = 'gpt',
      // New AI selection parameters (fallback to iOS params)
      enabledAIs = { 
        gpt: includeGPT === true, 
        claude: includeClaude === true, 
        gemini: includeGemini === true, 
        moderator: includeModerator === true 
      },
      // (iOS artık model göndermiyor; backend auto-select yapıyor)
    } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required', success: false });
    }

    const detectedLang = language || detectLanguage(question);
    const languageInstruction = langLabel(detectedLang);

    // iOS ModeratorStyle compatibility mapping
    const moderatorStyleMapping = {
      'Quick Summary': 'quick-summary',
      'Best Answer': 'neutral', 
      'Action Steps': 'educational',
      'Detailed Analysis': 'analytical'
    };
    
    const finalModeratorStyle = moderatorStyleMapping[moderatorStyle] || moderatorStyle || 'neutral';
    console.log('[MODERATOR STYLE] iOS sent:', moderatorStyle, '→ Backend using:', finalModeratorStyle);

    // iOS moderatorSource compatibility (convert ChatMessage.Role to string)
    const moderatorSourceMapping = {
      'GPT': 'gpt',
      'Claude': 'claude', 
      'Gemini': 'gemini'
    };
    
    const finalModeratorSource = moderatorSourceMapping[moderatorSource] || moderatorSource || 'gpt';
    console.log('[MODERATOR SOURCE] iOS sent:', moderatorSource, '→ Backend using:', finalModeratorSource);

    // Normalize conversation history for different providers
    const conversationHistory = (Array.isArray(conversation) ? conversation : [])
      .map(msg => ({
        role: msg?.sender === 'user' ? 'user' : 'assistant',
        content: msg?.text || '',
      }))
      .filter(m => !!m.content);

    console.log('[DEBUG] Original conversation history:', conversationHistory.length, 'messages');
    
    // IMPORTANT: Each AI should see only USER messages in history, not other AI responses
    // This prevents AIs from responding to each other instead of the user
    const userOnlyHistory = conversationHistory.filter(msg => msg.role === 'user');
    console.log('[DEBUG] User-only history for AIs:', userOnlyHistory.length, 'messages');

    // Validate round count
    const maxRounds = Math.max(1, Math.min(roundCount || 1, 3)); // Limit to 1-3 rounds
    console.log('[ROUNDS] Processing', maxRounds, 'rounds of AI conversation');
    
    console.log('[DEBUG] Incoming iOS params:', { includeGPT, includeClaude, includeGemini, includeModerator });
    console.log('[DEBUG] Resolved enabledAIs:', enabledAIs);
    
    // Validate enabled AIs
    const activeAIs = {
      gpt: enabledAIs?.gpt === true,
      claude: enabledAIs?.claude === true,
      gemini: enabledAIs?.gemini === true,
      moderator: enabledAIs?.moderator === true
    };
    
    console.log('[AI SELECTION] Active AIs:', activeAIs);
    console.log('[MODERATOR] Source:', finalModeratorSource, 'Style:', finalModeratorStyle);

    // Determine AI execution order based on enabled AIs
    const aiOrder = [];
    if (activeAIs.gpt) aiOrder.push('gpt');
    if (activeAIs.claude) aiOrder.push('claude');
    if (activeAIs.gemini) aiOrder.push('gemini');
    
    if (aiOrder.length === 0) {
      return res.status(400).json({ 
        error: 'At least one AI assistant must be enabled', 
        success: false 
      });
    }
    
    console.log('[AI ORDER] Execution sequence:', aiOrder);

    // === Parallel AI calls with selective enabled AIs ===
    const allRoundsResponses = [];

    for (let round = 1; round <= maxRounds; round++) {
      console.log(`[ROUND ${round}] Starting round ${round} of ${maxRounds}...`);

      const roundResponses = {};

      // Build context from previous rounds
      let previousRoundsContext = '';
      if (round > 1) {
        previousRoundsContext = allRoundsResponses.map((prevRound, index) => {
          let roundSummary = `\n--- Round ${index + 1} Results ---\n`;
          if (prevRound.gpt) roundSummary += `GPT: ${prevRound.gpt}\n`;
          if (prevRound.claude) roundSummary += `Claude: ${prevRound.claude}\n`;
          if (prevRound.gemini) roundSummary += `Gemini: ${prevRound.gemini}\n`;
          return roundSummary;
        }).join('\n');
      }

      const promises = [];

      if (activeAIs.gpt) {
        promises.push(
          (async () => {
            try {
              console.log(`[ROUND ${round}] GPT responding...`);
              let gptPrompt = `Question: "${question}"`;
              if (previousRoundsContext) {
                gptPrompt += `\n\nPrevious: ${previousRoundsContext}`;
              }
              gptPrompt += `\n\nBrief response please.`;

              const messages = [
                {
                  role: 'system',
                  content: `You are ChatGPT. Respond briefly in ${languageInstruction}. Keep answers short and helpful.`,
                },
                ...userOnlyHistory.slice(-3),
                { role: 'user', content: gptPrompt },
              ];

              const gptResponse = await openaiChat(messages, {
                model: OPENAI_CHAT_MODEL,
                max_tokens: 150,
                temperature: 0.7,
              });
              return {
                ai: 'gpt',
                response: gptResponse.choices?.[0]?.message?.content || 'GPT response error',
              };
            } catch (err) {
              console.error(`[ROUND ${round}] GPT error:`, err.message);
              return { ai: 'gpt', response: `GPT Error: ${err.message}` };
            }
          })()
        );
      }

      if (activeAIs.claude) {
        promises.push(
          (async () => {
            try {
              console.log(`[ROUND ${round}] Claude responding...`);
              let claudePrompt = `Question: "${question}"`;
              if (previousRoundsContext) {
                claudePrompt += `\n\nPrevious: ${previousRoundsContext}`;
                claudePrompt += `\n\nBrief response please.`;
              } else {
                claudePrompt += `\n\nBrief answer please.`;
              }

              const msgs = [
                ...userOnlyHistory.slice(-3).map(m => ({
                  role: 'user',
                  content: m.content,
                })),
                { role: 'user', content: claudePrompt },
              ];

              const claudeResponse = await anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: 150,
                system: `You are Claude, an AI assistant. Respond concisely in ${languageInstruction}. Keep answers brief but helpful.`,
                messages: msgs,
              });
              return {
                ai: 'claude',
                response: claudeResponse?.content?.[0]?.text || 'Claude response error',
              };
            } catch (err) {
              console.error(`[ROUND ${round}] Claude error:`, err.message);
              return { ai: 'claude', response: `Claude Error: ${err.message}` };
            }
          })()
        );
      }

      if (activeAIs.gemini) {
        promises.push(
          (async () => {
            try {
              console.log(`[ROUND ${round}] Gemini responding...`);
              const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
              if (!apiKey) {
                throw new Error('Google AI API key not found in environment variables');
              }

              const model = genAI.getGenerativeModel({
                model: GEMINI_MODEL,
                generationConfig: {
                  maxOutputTokens: 150,
                  temperature: 0.7,
                  topP: 0.8,
                  topK: 40,
                },
              });

              const history = userOnlyHistory.slice(-3).map(msg => ({
                role: 'user',
                parts: [{ text: msg.content }],
              }));

              const chat = model.startChat({ history });
              let geminiPrompt = `You are Gemini. Respond concisely in ${languageInstruction}.\n\nUser question: "${question}"`;
              if (previousRoundsContext) {
                geminiPrompt += `\n\nPrevious discussion: ${previousRoundsContext}`;
                geminiPrompt += `\n\nProvide a brief response considering the previous discussion.`;
              } else {
                geminiPrompt += `\n\nProvide a brief, helpful response.`;
              }
              geminiPrompt += `\n\nKeep response brief and informative.`;

              const result = await chat.sendMessage(geminiPrompt);
              const response = await result.response;
              const text = response.text();
              return { ai: 'gemini', response: text || 'Gemini response error' };
            } catch (error) {
              console.error(`[ROUND ${round}] Gemini error:`, error.message);
              let errorMessage = `Gemini Error: ${error.message}`;
              if (error.message.includes('API key')) {
                errorMessage = 'Gemini Error: API key issue';
              } else if (error.message.includes('quota')) {
                errorMessage = 'Gemini Error: API quota exceeded';
              } else if (error.message.includes('network') || error.message.includes('timeout')) {
                errorMessage = 'Gemini Error: Network connectivity issue';
              }
              return { ai: 'gemini', response: errorMessage };
            }
          })()
        );
      }

      const results = await Promise.allSettled(promises);

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          const { ai, response } = result.value;
          roundResponses[ai] = response;
          console.log(`[ROUND ${round}] ${ai.toUpperCase()} response received:`, response.substring(0, 100) + '...');
        } else if (result.status === 'rejected') {
          console.error(`[ROUND ${round}] A promise was rejected:`, result.reason);
        }
      });

      // Add this round's responses to the collection
      allRoundsResponses.push(roundResponses);
      console.log(`[ROUND ${round}] Round ${round} completed successfully`);
    }

    const finalResponses = allRoundsResponses.length > 0 ? allRoundsResponses[allRoundsResponses.length - 1] : {};

    // === Moderator (Dynamic source based on user selection) ===
    let moderatorText = 'Moderator response unavailable.';
    
    if (activeAIs.moderator) {
      const moderatorPrompts = {
        neutral: `Summarize key points briefly in ${languageInstruction}.`,
        analytical: `Compare AI perspectives briefly in ${languageInstruction}.`,
        educational: `Explain briefly in ${languageInstruction}.`,
        creative: `Present information creatively but briefly in ${languageInstruction}.`,
        'quick-summary': `Very brief summary in ${languageInstruction}. 1-2 sentences max.`,
      };
      const moderatorPrompt = moderatorPrompts[finalModeratorStyle] || moderatorPrompts.neutral;

      try {
        // Build comprehensive context for moderator
        let moderatorContext = `User asked: "${question}"\n\n`;
        
        if (maxRounds > 1) {
          moderatorContext += `This discussion involved ${maxRounds} rounds of AI conversation:\n\n`;
          allRoundsResponses.forEach((round, index) => {
            moderatorContext += `--- Round ${index + 1} ---\n`;
            if (round.gpt) moderatorContext += `GPT: ${round.gpt}\n`;
            if (round.claude) moderatorContext += `Claude: ${round.claude}\n`;
            if (round.gemini) moderatorContext += `Gemini: ${round.gemini}\n`;
            moderatorContext += '\n';
          });
          moderatorContext += `Please provide a moderator response that synthesizes the evolution of this ${maxRounds}-round discussion.`;
        } else {
          moderatorContext += `AI Responses:\n`;
          if (finalResponses.gpt) moderatorContext += `GPT: ${finalResponses.gpt}\n`;
          if (finalResponses.claude) moderatorContext += `Claude: ${finalResponses.claude}\n`;
          if (finalResponses.gemini) moderatorContext += `Gemini: ${finalResponses.gemini}\n`;
          moderatorContext += '\nPlease provide a moderator response that synthesizes these perspectives.';
        }
        
        // Choose moderator source based on user setting
        const moderatorTokens = finalModeratorStyle === 'quick-summary' ? 100 : 200; // Much shorter for quick summary
        
        if (finalModeratorSource === 'claude' && activeAIs.claude) {
          // Use Claude as moderator
          const msgs = [{ role: 'user', content: moderatorContext }];
          const claudeResponse = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: moderatorTokens,
            system: moderatorPrompt,
            messages: msgs,
          });
          moderatorText = claudeResponse?.content?.[0]?.text || 'Claude moderator response error';
        } else if (finalModeratorSource === 'gemini' && activeAIs.gemini) {
          // Use Gemini as moderator
          const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
          if (apiKey) {
            const model = genAI.getGenerativeModel({ 
              model: GEMINI_MODEL,
              generationConfig: {
                maxOutputTokens: moderatorTokens,
                temperature: 0.8,
                topP: 0.8,
                topK: 40,
              },
            });
            
            const chat = model.startChat({});
            const prompt = `${moderatorPrompt}\n\n${moderatorContext}`;
            const result = await chat.sendMessage(prompt);
            const response = await result.response;
            moderatorText = response.text() || 'Gemini moderator response error';
          } else {
            moderatorText = 'Gemini moderator unavailable: API key not found';
          }
        } else {
          // Use GPT as moderator (default)
          const modMessages = [
            { role: 'system', content: moderatorPrompt },
            { role: 'user', content: moderatorContext },
          ];
          
          const modJson = await openaiChat(modMessages, {
            model: OPENAI_CHAT_MODEL,
            max_tokens: moderatorTokens,
            temperature: 0.8,
          });
          moderatorText = modJson.choices?.[0]?.message?.content || 'GPT moderator response error';
        }
        
        console.log('[MODERATOR] Response generated using:', finalModeratorSource, 'with style:', finalModeratorStyle);
        
      } catch (err) {
        console.error('[MODERATOR] Error:', err.message);
        moderatorText = `Moderator response unavailable: ${err.message}`;
      }
    } else {
      console.log('[MODERATOR] Moderator disabled by user');
      moderatorText = null; // Don't include moderator if disabled
    }

    // Build final response object with only enabled AIs
    const responseData = {
      success: true,
      detectedLanguage: detectedLang,
      roundCount: maxRounds,
      activeAIs: Object.keys(activeAIs).filter(ai => activeAIs[ai]),
      moderatorSource: finalModeratorSource,
      moderatorStyle: finalModeratorStyle,
      responses: {},
      allRounds: maxRounds > 1 ? allRoundsResponses : undefined, // Include all rounds if multiple
    };

    // Add AI responses only if they were enabled
    if (activeAIs.gpt) responseData.responses.gpt = finalResponses.gpt;
    if (activeAIs.claude) responseData.responses.claude = finalResponses.claude;
    if (activeAIs.gemini) responseData.responses.gemini = finalResponses.gemini;
    
    // Add moderator response only if enabled and generated
    if (moderatorText) responseData.responses.moderator = moderatorText;

    console.log(`[RESPONSE] Final response includes: ${Object.keys(responseData.responses).join(', ')}`);
    
    return res.json(responseData);
  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message, success: false });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedback, deviceId, appVersion, rating, timestamp } = req.body;
    const feedbackData = {
      feedback,
      deviceId,
      appVersion,
      rating,
      timestamp: timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
    console.log('Feedback received:', feedbackData);
    res.json({
      success: true,
      message: 'Thank you for your feedback! We appreciate your input.',
      id: Date.now().toString(),
    });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to save feedback', success: false });
  }
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    status: 'active',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available_endpoints: ['/health', '/api/chat', '/api/feedback', '/api/stats'],
  });
});

app.listen(PORT, () => {
  console.log(` AI Agora Backend running on port ${PORT}`);
  console.log(` Health: http://localhost:${PORT}/health`);
  console.log(` Chat:   http://localhost:${PORT}/api/chat`);
  console.log(' API Keys loaded:', {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google: !!process.env.GOOGLE_AI_API_KEY,
  });
});
