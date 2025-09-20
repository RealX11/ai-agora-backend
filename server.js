import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load env
dotenv.config();

// Env validation
const requiredEnv = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[warn] Missing env vars: ${missing.join(', ')}. Some providers will be disabled.`);
}

// Constants per spec
export const OPENAI_CHAT_MODEL = 'gpt-4o';
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
export const GEMINI_MODEL = 'gemini-2.5-pro';

const PORT = process.env.PORT || 3000;

// Clients
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const genAI = process.env.GOOGLE_AI_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
  : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Simple in-memory stats
const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  chats: 0,
  feedbacks: 0,
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/stats', (_req, res) => {
  res.json({ ...stats });
});

app.post('/api/feedback', (req, res) => {
  stats.feedbacks += 1;
  console.log('[feedback]', JSON.stringify(req.body));
  res.json({ ok: true });
});

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
}

function sseSend(res, event, dataObj) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}

function sseDone(res) {
  res.write('event: done\n');
  res.write('data: {}\n\n');
  res.end();
}

// Provider streaming helpers
async function streamOpenAI({ prompt, language }) {
  if (!openai) return;
  const stream = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    messages: [
      { role: 'system', content: `You answer in ${language}. Keep responses concise (about 80-150 words). Avoid headings and heavy formatting unless explicitly requested. Prefer bullet points only when necessary.` },
      { role: 'user', content: prompt },
    ],
    stream: true,
  });
  return stream;
}

async function* chunksFromOpenAI(stream) {
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content || '';
    if (delta) yield delta;
  }
}

async function streamAnthropic({ prompt, language }) {
  if (!anthropic) return;
  const stream = await anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: `You answer in ${language}. Keep responses concise (about 80-150 words). Avoid headings and heavy formatting unless explicitly requested. Prefer bullet points only when necessary.`,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  return stream;
}

async function* chunksFromAnthropic(stream) {
  for await (const event of stream) {
    if (event.type === 'message_start' || event.type === 'message_delta') continue;
    if (event.type === 'content_block_delta') {
      const t = event.delta?.text;
      if (t) yield t;
    }
  }
}

async function streamGemini({ prompt, language }) {
  if (!genAI) return;
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: `You answer in ${language}. Keep responses concise (about 80-150 words). Avoid headings and heavy formatting unless explicitly requested. Prefer bullet points only when necessary.` });
  const result = await model.generateContentStream(prompt);
  return result;
}

async function* chunksFromGemini(stream) {
  for await (const item of stream.stream) {
    const t = item?.text();
    if (t) yield t;
  }
}

function buildRoundPrompt(basePrompt, round, allRoundResponses) {
  if (round === 1) return basePrompt;
  const prev = allRoundResponses
    .filter((r) => r.round < round)
    .map((r) => `- [${r.model}] ${r.text}`)
    .join('\n');
  return `${basePrompt}\n\nOther models said previously:\n${prev}\n\nBriefly comment on agreements/disagreements and, if needed, refine your answer.`;
}

function moderatorPrompt(style, language, collected) {
  const styleGuidance = {
    neutral: 'Balanced and concise final answer.',
    analytical: 'Compare and contrast key points analytically.',
    educational: 'Explain clearly with simple examples if useful.',
    creative: 'Provide an engaging, creative synthesis.',
    'quick-summary': 'Provide a terse executive summary.',
  }[style] || 'Balanced and concise final answer.';

  const lines = collected
    .map((c) => `- [${c.model} R${c.round}] ${c.text}`)
    .join('\n');

  return `Act as a moderator. Language: ${language}.\n${styleGuidance} Keep it concise (about 80-150 words). Avoid headings and heavy formatting unless explicitly requested.\nSynthesize the following model responses into a single, helpful answer.\n\n${lines}`;
}

// SSE Chat endpoint
app.post('/api/chat', async (req, res) => {
  stats.requests += 1;
  const startedAt = Date.now();

  const {
    prompt,
    language = 'English',
    rounds = 1,
    useGPT = true,
    useClaude = true,
    useGemini = true,
    moderatorEngine = 'Moderator', // 'GPT' | 'Claude' | 'Gemini' | 'Moderator'
    moderatorStyle = 'neutral',
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  sseHeaders(res);
  sseSend(res, 'meta', { startedAt, rounds, moderatorEngine, moderatorStyle });

  const active = [
    useGPT && openai ? 'GPT' : null,
    useClaude && anthropic ? 'Claude' : null,
    useGemini && genAI ? 'Gemini' : null,
  ].filter(Boolean);

  if (active.length === 0) {
    sseSend(res, 'error', { message: 'No providers available or enabled.' });
    return sseDone(res);
  }

  // First-come-first-serve streaming over rounds
  const collected = [];

  for (let r = 1; r <= Math.max(1, Math.min(3, rounds)); r++) {
    sseSend(res, 'round', { round: r, message: r === 1 ? 'Round 1 starting…' : `Round ${r} starting…` });

    const roundPrompt = buildRoundPrompt(prompt, r, collected);

    const tasks = [];

    if (active.includes('GPT')) {
      tasks.push({
        name: 'GPT',
        run: async function* () {
          const stream = await streamOpenAI({ prompt: roundPrompt, language });
          if (!stream) return;
          for await (const chunk of chunksFromOpenAI(stream)) {
            yield { model: 'GPT', round: r, chunk };
          }
        },
      });
    }

    if (active.includes('Claude')) {
      tasks.push({
        name: 'Claude',
        run: async function* () {
          const stream = await streamAnthropic({ prompt: roundPrompt, language });
          if (!stream) return;
          for await (const chunk of chunksFromAnthropic(stream)) {
            yield { model: 'Claude', round: r, chunk };
          }
        },
      });
    }

    if (active.includes('Gemini')) {
      tasks.push({
        name: 'Gemini',
        run: async function* () {
          const stream = await streamGemini({ prompt: roundPrompt, language });
          if (!stream) return;
          for await (const chunk of chunksFromGemini(stream)) {
            yield { model: 'Gemini', round: r, chunk };
          }
        },
      });
    }

    // Run all providers concurrently and pipe chunks as they arrive
    await new Promise(async (resolveRound) => {
      const buffers = new Map();
      let completedCount = 0;

      await Promise.all(
        tasks.map(async (t) => {
          buffers.set(t.name, '');
          try {
            for await (const item of t.run()) {
              const prev = buffers.get(t.name) || '';
              buffers.set(t.name, prev + item.chunk);
              sseSend(res, 'chunk', { model: item.model, round: r, text: item.chunk });
            }
            completedCount += 1;
          } catch (e) {
            completedCount += 1;
            sseSend(res, 'provider_error', { model: t.name, round: r, message: String(e?.message || e) });
          }
        })
      );

      // Push full messages for this round
      for (const [model, text] of buffers.entries()) {
        if (text) {
          collected.push({ model, round: r, text });
          sseSend(res, 'message', { model, round: r, text });
        }
      }

      resolveRound();
    });
  }

  // Moderator step
  const modPrompt = moderatorPrompt(moderatorStyle, language, collected);

  async function* moderatorRun() {
    if (moderatorEngine === 'GPT' && openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language });
      for await (const c of chunksFromOpenAI(s)) yield c;
      return;
    }
    if (moderatorEngine === 'Claude' && anthropic) {
      const s = await streamAnthropic({ prompt: modPrompt, language });
      for await (const c of chunksFromAnthropic(s)) yield c;
      return;
    }
    if (moderatorEngine === 'Gemini' && genAI) {
      const s = await streamGemini({ prompt: modPrompt, language });
      for await (const c of chunksFromGemini(s)) yield c;
      return;
    }
    if (openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language });
      for await (const c of chunksFromOpenAI(s)) yield c;
      return;
    }
    // If no providers for moderator
    return;
  }

  let modBuf = '';
  for await (const chunk of moderatorRun()) {
    modBuf += chunk;
    sseSend(res, 'moderator_chunk', { text: chunk });
  }
  if (modBuf) sseSend(res, 'moderator_message', { text: modBuf });

  stats.chats += 1;
  sseDone(res);
});

app.listen(PORT, () => {
  console.log(`AI Agora backend listening on :${PORT}`);
});
