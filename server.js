import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
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
export const GEMINI_MODEL = 'gemini-2.5-flash';

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

// User data helpers
function loadUsers() {
  try {
    if (fs.existsSync('users.json')) {
      return JSON.parse(fs.readFileSync('users.json', 'utf8'));
    }
  } catch (e) {
    console.error('[users] Load error:', e);
  }
  return {};
}

function saveUsers(users) {
  try {
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('[users] Save error:', e);
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/stats', (_req, res) => {
  res.json({ ...stats });
});

app.get('/api/feedbacks', (_req, res) => {
  try {
    if (fs.existsSync('feedbacks.json')) {
      const feedbacks = JSON.parse(fs.readFileSync('feedbacks.json', 'utf8'));
      res.json({ feedbacks, count: feedbacks.length });
    } else {
      res.json({ feedbacks: [], count: 0 });
    }
  } catch (e) {
    res.status(500).json({ error: 'Could not read feedbacks' });
  }
});

app.post('/api/feedback', (req, res) => {
  stats.feedbacks += 1;
  console.log('[feedback]', JSON.stringify(req.body));
  
  // Save to file
  const feedback = {
    ...req.body,
    timestamp: new Date().toISOString(),
    id: Date.now()
  };
  
  try {
    let feedbacks = [];
    if (fs.existsSync('feedbacks.json')) {
      feedbacks = JSON.parse(fs.readFileSync('feedbacks.json', 'utf8'));
    }
    feedbacks.push(feedback);
    fs.writeFileSync('feedbacks.json', JSON.stringify(feedbacks, null, 2));
  } catch (e) {
    console.error('[feedback] File write error:', e);
  }
  
  res.json({ ok: true });
});

// User endpoints
app.post('/api/user/register', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  
  const users = loadUsers();
  if (!users[userId]) {
    users[userId] = {
      userId,
      turnsUsed: 0,
      isPremium: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };
    saveUsers(users);
  }
  
  res.json({ user: users[userId] });
});

app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  const users = loadUsers();
  
  if (!users[userId]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({ user: users[userId] });
});

app.post('/api/user/use-turns', (req, res) => {
  const { userId, turns, isPremium } = req.body;
  if (!userId || !turns) {
    return res.status(400).json({ error: 'Missing userId or turns' });
  }
  
  const users = loadUsers();
  if (!users[userId]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // iOS'tan gelen güncel premium durumunu güncelle
  if (typeof isPremium === 'boolean') {
    const wasPremium = users[userId].isPremium;
    users[userId].isPremium = isPremium;
    
    // Premium durumu değiştiyse logla
    if (wasPremium !== isPremium) {
      console.log(`🔄 Premium durumu güncellendi: ${userId} → ${isPremium}`);
      users[userId].premiumSince = isPremium ? new Date().toISOString() : null;
    }
  }
  
  // Premium kullanıcılar için sınırsız
  if (!users[userId].isPremium) {
    users[userId].turnsUsed += turns;
  }
  users[userId].lastUsed = new Date().toISOString();
  saveUsers(users);
  
  res.json({ user: users[userId] });
});

app.post('/api/user/set-premium', (req, res) => {
  const { userId, isPremium } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  
  const users = loadUsers();
  if (!users[userId]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  users[userId].isPremium = isPremium;
  users[userId].premiumSince = isPremium ? new Date().toISOString() : null;
  saveUsers(users);
  
  res.json({ user: users[userId] });
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

// Serious topic detection
function detectSeriousTopic(prompt) {
  const seriousKeywords = [
    // Health
    'hasta', 'hastalık', 'ağrı', 'kanser', 'kalp', 'depresyon', 'ilaç', 'doktor', 'acil',
    'sick', 'disease', 'pain', 'cancer', 'heart', 'depression', 'medicine', 'doctor', 'emergency',
    // Legal/Financial
    'boşanma', 'dava', 'mahkeme', 'iflas', 'borç', 'avukat', 'hukuki',
    'divorce', 'lawsuit', 'court', 'bankruptcy', 'debt', 'lawyer', 'legal',
    // Crisis
    'intihar', 'şiddet', 'yardım edin', 'kriz', 'ölüm', 'vefat',
    'suicide', 'violence', 'help me', 'crisis', 'death', 'died'
  ];
  
  const lowerPrompt = prompt.toLowerCase();
  return seriousKeywords.some(keyword => lowerPrompt.includes(keyword));
}

// Provider streaming helpers
async function streamOpenAI({ prompt, language, round = 1 }) {
  if (!openai) return;
  const roundInstruction = round === 1 
    ? "Provide a short and concise answer." 
    : round === 2 
    ? "Provide a clear and fluent explanation without writing too long." 
    : "Provide comprehensive analysis. Up to 400 words allowed.";
  
  const stream = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    messages: [
      { role: 'system', content: `${roundInstruction} STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If question is in Turkish, answer in Turkish. If in English, answer in English.` },
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

async function streamAnthropic({ prompt, language, round = 1 }) {
  if (!anthropic) return;
  const roundInstruction = round === 1 
    ? "Provide a short and concise answer." 
    : round === 2 
    ? "Provide a clear and fluent explanation without writing too long." 
    : "Provide comprehensive analysis. Up to 400 words allowed.";
    
  const stream = await anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: `${roundInstruction} STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If question is in Turkish, answer in Turkish. If in English, answer in English.`,
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

async function streamGemini({ prompt, language, round = 1 }) {
  if (!genAI) return;
  const roundInstruction = round === 1 
    ? "Provide a short and concise answer." 
    : round === 2 
    ? "Provide a clear and fluent explanation without writing too long." 
    : "Provide comprehensive analysis. Up to 400 words allowed.";
    
  const systemInstruction = `${roundInstruction} STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If question is in Turkish, answer in Turkish. If in English, answer in English.`;
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction });
  const result = await model.generateContentStream(prompt);
  return result;
}

async function* chunksFromGemini(stream) {
  let soFar = '';
  for await (const item of stream.stream) {
    const t = item?.text();
    if (!t) continue;
    let delta = t;
    if (t.startsWith(soFar)) {
      delta = t.slice(soFar.length);
    }
    soFar = t;
    if (delta) yield delta;
  }
}

function buildRoundPrompt(basePrompt, round, allRoundResponses, currentModel = null, isSerious = false) {
  let prompt = basePrompt;
  
  // Round-based instructions
  if (round === 1) {
    prompt += isSerious 
      ? "\n\n[ROUND 1 INSTRUCTION]: This appears to be a serious topic. Provide direct, helpful, and empathetic responses without playful elements."
      : "\n\n[ROUND 1 INSTRUCTION]: Provide a short and concise answer.";
  } else if (round === 2) {
    prompt += isSerious
      ? "\n\n[ROUND 2 INSTRUCTION]: Reference other AIs' responses professionally. Be thorough, supportive, and provide helpful information. Provide a clear and fluent explanation without writing too long."
      : "\n\n[ROUND 2 INSTRUCTION]: This is the second round. Reference other AIs' responses (not your own!) with brief, playful references. IGNORE YOUR OWN PREVIOUS RESPONSE - act as if you never wrote it. Only mention other AIs. Be witty and make the reader smile! Provide a clear and fluent explanation without writing too long.";
  } else if (round === 3) {
    prompt += isSerious
      ? "\n\n[ROUND 3 - COMPREHENSIVE ANALYSIS]: Provide a thorough, professional analysis of other AIs' responses. Focus on practical solutions and actionable advice."
      : "\n\n[ROUND 3 - SERIOUS ANALYSIS]: Alright, let's get serious. If you requested three rounds, you must be serious about this topic! 😏 Analyze other AIs' previous responses, start with a clever quip but then dive deep. Provide practical solutions, real data, concrete suggestions. Be both entertaining and informative - but this time deliver genuinely useful results!";
  }
  
  if (round === 1) return prompt;
  const prev = allRoundResponses
    .filter((r) => r.round < round && r.model !== currentModel)
    .map((r) => `- [${r.model}] ${r.text}`)
    .join('\n');
  return `${prompt}\n\nOther models said previously:\n${prev}\n\nBriefly comment on agreements/disagreements and, if needed, refine your answer.`;
}

function moderatorPrompt(style, language, collected, rounds = 1) {
  // For 3 rounds, use serious analysis mode regardless of style
  const actualStyle = rounds >= 3 ? 'analytical' : style;
  
  const styleGuidance = {
    neutral: 'Balanced and concise final answer.',
    analytical: 'Compare and contrast key points analytically.',
    educational: 'Explain clearly with simple examples if useful.',
    creative: 'Provide an engaging, creative synthesis.',
    'quick-summary': 'Provide a terse executive summary.',
  }[actualStyle] || 'Balanced and concise final answer.';

  const lines = collected
    .map((c) => `- [${c.model} R${c.round}] ${c.text}`)
    .join('\n');

  // Personalized intro for 3-round conversations
  const personalizedIntro = rounds >= 3 
    ? (language === 'Turkish' || language === 'Türkçe' 
        ? "Üç tur seçtiğine göre bu konuya epey ciddi yaklaşıyorsun, peki o zaman..." 
        : "Since you chose three rounds, you're quite serious about this topic, well then...")
    : "";

  const basePrompt = `Act as a moderator. ${styleGuidance} Synthesize the following model responses into a single, helpful answer. CRITICAL: Respond in the SAME LANGUAGE as the user's original question.`;
  
  return personalizedIntro 
    ? `${basePrompt}\n\n${personalizedIntro}\n\n${lines}`
    : `${basePrompt}\n\n${lines}`;
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

  console.log(`🌍 Gelen language parametresi: "${language}" - Soru: "${prompt.substring(0, 50)}..."`);

  sseHeaders(res);
  sseSend(res, 'meta', { startedAt, rounds, moderatorEngine, moderatorStyle });

  // Detect if topic is serious
  const isSerious = detectSeriousTopic(prompt);

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

    const tasks = [];

    if (active.includes('GPT')) {
      tasks.push({
        name: 'GPT',
        run: async function* () {
          const gptPrompt = buildRoundPrompt(prompt, r, collected, 'GPT', isSerious);
          const stream = await streamOpenAI({ prompt: gptPrompt, language, round: r });
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
          const claudePrompt = buildRoundPrompt(prompt, r, collected, 'Claude', isSerious);
          const stream = await streamAnthropic({ prompt: claudePrompt, language, round: r });
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
          const geminiPrompt = buildRoundPrompt(prompt, r, collected, 'Gemini', isSerious);
          const stream = await streamGemini({ prompt: geminiPrompt, language, round: r });
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

      // Push finalize signal without re-sending full text (avoid duplication)
      for (const [model, text] of buffers.entries()) {
        if (text) {
          collected.push({ model, round: r, text });
          sseSend(res, 'message', { model, round: r, text: '' });
        }
      }

      resolveRound();
    });
  }

  // Moderator step
  const modPrompt = moderatorPrompt(moderatorStyle, language, collected, rounds);

  async function* moderatorRun() {
    if (moderatorEngine === 'GPT' && openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language, round: rounds });
      for await (const c of chunksFromOpenAI(s)) yield c;
      return;
    }
    if (moderatorEngine === 'Claude' && anthropic) {
      const s = await streamAnthropic({ prompt: modPrompt, language, round: rounds });
      for await (const c of chunksFromAnthropic(s)) yield c;
      return;
    }
    if (moderatorEngine === 'Gemini' && genAI) {
      const s = await streamGemini({ prompt: modPrompt, language, round: rounds });
      for await (const c of chunksFromGemini(s)) yield c;
      return;
    }
    if (openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language, round: rounds });
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
  if (modBuf) sseSend(res, 'moderator_message', { text: '' });

  stats.chats += 1;
  sseDone(res);
});

app.listen(PORT, () => {
  console.log(`AI Agora backend listening on :${PORT}`);
});
