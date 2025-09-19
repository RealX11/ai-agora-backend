// server.js — AI Agora Backend (modernized, with parallel + streaming support)

setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log(`[MEMORY] Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  if (memUsage.heapUsed > 400 * 1024 * 1024) {
    console.warn('[WARNING] High memory usage detected');
  }
}, 10000);

process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CLIENTS ======
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let genAI;
try {
  const googleApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (googleApiKey) {
    genAI = new GoogleGenerativeAI(googleApiKey);
    console.log('[INIT] Google AI client initialized successfully');
  }
} catch (error) {
  console.error('[INIT] Failed to initialize Google AI client:', error.message);
}

// ====== MODEL CHOICES ======
const OPENAI_CHAT_MODEL = 'gpt-4o';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GEMINI_MODEL = "gemini-2.5-pro";

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json());

// ====== UTILS ======
function detectLanguage(text) {
  const tr = ['ve', 'bir', 'bu', 'da', 'de', 'ile'];
  const en = ['the', 'and', 'is', 'a', 'to', 'in'];
  const t = (text || '').toLowerCase();
  const scores = {
    tr: tr.filter(w => t.includes(w)).length,
    en: en.filter(w => t.includes(w)).length,
  };
  return Object.keys(scores).reduce((a, b) => (scores[a] > scores[b] ? a : b));
}
function langLabel(code) {
  return ({ tr: 'Türkçe', en: 'English' }[code] || 'English');
}

// ====== STREAMING IMPLEMENTATIONS ======
async function streamOpenAI(res, messages, languageInstruction) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages,
      max_tokens: 150,
      temperature: 0.7,
      stream: true
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI HTTP ${resp.status}`);
  }

  res.write(`event: gpt\n`);
  for await (const chunk of resp.body) {
    const lines = chunk.toString().split("\n").filter(line => line.trim() !== "");
    for (const line of lines) {
      if (line === "data: [DONE]") {
        res.write(`data: [DONE]\n\n`);
        return;
      }
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.substring(6));
        const token = data.choices?.[0]?.delta?.content;
        if (token) {
          res.write(`data: ${token}\n\n`);
        }
      }
    }
  }
}

async function streamClaude(res, msgs, languageInstruction) {
  const stream = await anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 150,
    system: `You are Claude. Respond concisely in ${languageInstruction}.`,
    messages: msgs,
  });

  res.write(`event: claude\n`);
  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      res.write(`data: ${event.delta.text}\n\n`);
    }
  }
  res.write(`data: [DONE]\n\n`);
}

// ====== ENDPOINTS ======
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'AI Agora Backend is running' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { question, includeGPT = true, includeClaude = true, includeGemini = true } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required' });

    const detectedLang = detectLanguage(question);
    const languageInstruction = langLabel(detectedLang);

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const tasks = [];

    if (includeGPT) {
      const messages = [
        { role: "system", content: `You are ChatGPT. Respond in ${languageInstruction}.` },
        { role: "user", content: question }
      ];
      tasks.push(streamOpenAI(res, messages, languageInstruction));
    }

    if (includeClaude) {
      const msgs = [{ role: "user", content: question }];
      tasks.push(streamClaude(res, msgs, languageInstruction));
    }

    if (includeGemini && genAI) {
      tasks.push((async () => {
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const chat = model.startChat({});
        const result = await chat.sendMessage(`Respond in ${languageInstruction}: ${question}`);
        const response = await result.response;
        res.write(`event: gemini\ndata: ${response.text()}\n\n`);
      })());
    }

    await Promise.all(tasks);
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Feedback endpoint
app.post('/api/feedback', (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🚀 AI Agora Backend running on port ${PORT}`);
});
