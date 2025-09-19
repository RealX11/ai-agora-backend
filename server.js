// server.js — AI Agora Backend (modernized, auto-latest models)

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
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

// ====== MODEL CHOICES (auto “latest”) ======
// OpenAI: use modern “gpt-4.1” series via REST (no SDK surface mismatch)
const OPENAI_CHAT_MODEL = 'gpt-4.1';
// Anthropic: newest stable Claude 3.5 Sonnet (Oct 2024)
const CLAUDE_MODEL = 'claude-3.5-sonnet-20241022';
// Google: official latest alias
const GEMINI_MODEL = 'gemini-1.5-pro-latest';

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
async function openaiChat(messages, { model = OPENAI_CHAT_MODEL, max_tokens = 400, temperature = 0.7 } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens, temperature }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error?.message || `OpenAI HTTP ${resp.status}`);
  }
  return json;
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
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const {
      question,
      language,
      conversation = [],
      moderatorStyle = 'neutral',
      // (iOS artık model göndermiyor; backend auto-select yapıyor)
    } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required', success: false });
    }

    const detectedLang = language || detectLanguage(question);
    const languageInstruction = langLabel(detectedLang);

    // Normalize conversation history for different providers
    const conversationHistory = (Array.isArray(conversation) ? conversation : [])
      .map(msg => ({
        role: msg?.sender === 'user' ? 'user' : 'assistant',
        content: msg?.text || '',
      }))
      .filter(m => !!m.content);

    // === Parallel calls ===
    const aiPromises = [];

    // GPT (OpenAI)
    aiPromises.push(
      (async () => {
        try {
          const messages = [
            {
              role: 'system',
              content: `You are ChatGPT, a helpful AI assistant. Respond naturally and informatively in ${languageInstruction}. Keep responses concise but informative.`,
            },
            ...conversationHistory.slice(-6),
            { role: 'user', content: question },
          ];
          const j = await openaiChat(messages, {
            model: OPENAI_CHAT_MODEL,
            max_tokens: 400,
            temperature: 0.7,
          });
          return j.choices?.[0]?.message?.content || 'GPT response error';
        } catch (err) {
          return `GPT Error: ${err.message}`;
        }
      })()
    );

    // Claude (Anthropic)
    aiPromises.push(
      (async () => {
        try {
          const msgs = [
            ...conversationHistory.slice(-6).filter(m => m.role !== 'system').map(m => ({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.content,
            })),
            { role: 'user', content: question },
          ];
          const resp = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 400,
            system: `You are Claude, an AI assistant created by Anthropic. Be helpful, harmless, and honest. Respond in ${languageInstruction}. Keep responses concise but thorough.`,
            messages: msgs,
          });
          return resp?.content?.[0]?.text || 'Claude response error';
        } catch (err) {
          return `Claude Error: ${err.message}`;
        }
      })()
    );

    // Gemini (Google)
    aiPromises.push(
      (async () => {
        try {
          const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
          const history = conversationHistory.slice(-6).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
          }));
          const chat = model.startChat({
            history,
            generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
          });
          const result = await chat.sendMessage(`Please respond in ${languageInstruction}: ${question}`);
          return result?.response?.text() || 'Gemini response error';
        } catch (err) {
          return `Gemini Error: ${err.message}`;
        }
      })()
    );

    const settled = await Promise.allSettled(aiPromises);
    const aiResponses = {
      gpt: settled[0].status === 'fulfilled' ? settled[0].value : 'GPT response unavailable',
      claude: settled[1].status === 'fulfilled' ? settled[1].value : 'Claude response unavailable',
      gemini: settled[2].status === 'fulfilled' ? settled[2].value : 'Gemini response unavailable',
    };

    // === Moderator (OpenAI) ===
    const moderatorPrompts = {
      neutral: `You are a neutral moderator. Summarize the key points from the AI responses objectively in ${languageInstruction}.`,
      analytical: `You are an analytical moderator. Compare and analyze the different AI perspectives, highlighting strengths and differences in ${languageInstruction}.`,
      educational: `You are an educational moderator. Explain the topic in a teaching manner, drawing from all AI responses in ${languageInstruction}.`,
      creative: `You are a creative moderator. Present the information in an engaging, storytelling manner in ${languageInstruction}.`,
    };
    const moderatorPrompt = moderatorPrompts[moderatorStyle] || moderatorPrompts.neutral;

    let moderatorText = 'Moderator response unavailable.';
    try {
      const modMessages = [
        { role: 'system', content: moderatorPrompt },
        {
          role: 'user',
          content:
            `User asked: "${question}"\n\n` +
            `AI Responses:\n` +
            `GPT: ${aiResponses.gpt}\n` +
            `Claude: ${aiResponses.claude}\n` +
            `Gemini: ${aiResponses.gemini}\n\n` +
            `Please provide a moderator response that synthesizes these perspectives.`,
        },
      ];
      const modJson = await openaiChat(modMessages, {
        model: OPENAI_CHAT_MODEL,
        max_tokens: 300,
        temperature: 0.8,
      });
      moderatorText = modJson.choices?.[0]?.message?.content || 'Moderator response error';
    } catch (err) {
      moderatorText = `Moderator response unavailable: ${err.message}`;
    }

    return res.json({
      success: true,
      detectedLanguage: detectedLang,
      responses: {
        gpt: aiResponses.gpt,
        claude: aiResponses.claude,
        gemini: aiResponses.gemini,
        moderator: moderatorText,
      },
    });
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
app.use('*', (req, res) => {
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
