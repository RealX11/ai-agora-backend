import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// İsteğe bağlı sağlayıcılar: hangi anahtar varsa o sağlayıcı aktif olur
const requiredEnv = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[warn] Missing env vars: ${missing.join(', ')}. Some providers will be disabled.`);
}

// Modeller
export const OPENAI_CHAT_MODEL = 'gpt-4o';
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
export const GEMINI_MODEL = 'gemini-2.5-flash';

const PORT = process.env.PORT || 3000;

// İstemciler
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const genAI = process.env.GOOGLE_AI_API_KEY ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Basit istatistikler
const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  chats: 0
};

// Sağlık ve istatistik
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/stats', (_req, res) => {
  res.json({ ...stats });
});

// Ciddiyet tespiti (akış kalitesi için; üyelikle ilgisi yok)
function detectSeriousTopic(prompt) {
  const seriousKeywords = [
    'hasta','hastalık','ağrı','kanser','kalp','depresyon','ilaç','doktor','acil',
    'sick','disease','pain','cancer','heart','depression','medicine','doctor','emergency',
    'boşanma','dava','mahkeme','iflas','borç','avukat','hukuki',
    'divorce','lawsuit','court','bankruptcy','debt','lawyer','legal',
    'intihar','şiddet','yardım edin','kriz','ölüm','vefat',
    'suicide','violence','help me','crisis','death','died'
  ];
  const lower = prompt.toLowerCase();
  return seriousKeywords.some(k => lower.includes(k));
}

// Sağlayıcı yardımcıları
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
      { role: 'system', content: `${roundInstruction} STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question.` },
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
    system: `${roundInstruction} STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question.`,
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
  const systemInstruction = `${roundInstruction} STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question.`;
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

// Prompt inşası
function buildRoundPrompt(basePrompt, round, allRoundResponses, currentModel = null, isSerious = false) {
  let prompt = basePrompt;
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

// Moderator prompt (stil kaldırıldı; sabit, mantıklı sentez)
function moderatorPrompt(language, collected, rounds = 1) {
  const lines = collected.map((c) => `- [${c.model} R${c.round}] ${c.text}`).join('\n');

  const personalizedIntro = rounds >= 3 
    ? (language === 'Turkish' || language === 'Türkçe' 
        ? "Üç tur seçtiğine göre bu konuya epey ciddi yaklaşıyorsun, peki o zaman..." 
        : "Since you chose three rounds, you're quite serious about this topic, well then...")
    : "";

  const basePrompt = "Act as a neutral moderator. Compare and synthesize the following model responses into one clear, practical, and helpful final answer. Focus on correctness, reasoning quality, and usefulness. If there are disagreements, explain briefly and choose the most reasonable points. CRITICAL: Respond in the SAME LANGUAGE as the user's original question.";
  
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
    moderatorEngine = 'Claude'
    // moderatorStyle kaldırıldı
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const sseSend = (event, dataObj) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
  };
  const sseDone = () => {
    res.write('event: done\n');
    res.write('data: {}\n\n');
    res.end();
  };

  sseSend('meta', { startedAt, rounds, moderatorEngine });

  const isSerious = detectSeriousTopic(prompt);

  const active = [
    useGPT && openai ? 'GPT' : null,
    useClaude && anthropic ? 'Claude' : null,
    useGemini && genAI ? 'Gemini' : null,
  ].filter(Boolean);

  if (active.length === 0) {
    sseSend('error', { message: 'No providers available or enabled.' });
    return sseDone();
  }

  const collected = [];

  // Turlar
  for (let r = 1; r <= Math.max(1, Math.min(3, rounds)); r++) {
    sseSend('round', { round: r, message: `Round ${r} starting…` });

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

    // Sağlayıcıları paralel çalıştır, parçaları akıt
    await new Promise(async (resolveRound) => {
      const buffers = new Map();

      await Promise.all(
        tasks.map(async (t) => {
          buffers.set(t.name, '');
          try {
            for await (const item of t.run()) {
              const prev = buffers.get(t.name) || '';
              buffers.set(t.name, prev + item.chunk);
              sseSend('chunk', { model: item.model, round: r, text: item.chunk });
            }
          } catch (e) {
            sseSend('provider_error', { model: t.name, round: r, message: String(e?.message || e) });
          }
        })
      );

      // Finalize sinyali (tam metni tekrar göndermeden)
      for (const [model, text] of buffers.entries()) {
        if (text) {
          collected.push({ model, round: r, text });
          sseSend('message', { model, round: r, text: '' });
        }
      }

      resolveRound();
    });
  }

  // Moderatör: stilsiz, mantıklı sentez
  const modPrompt = moderatorPrompt(language, collected, rounds);

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
    // Yedek: OpenAI varsa onu kullan
    if (openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language, round: rounds });
      for await (const c of chunksFromOpenAI(s)) yield c;
      return;
    }
    // Hiçbiri yoksa sessiz çık
    return;
  }

  for await (const chunk of moderatorRun()) {
    sseSend('moderator_chunk', { text: chunk });
  }
  sseSend('moderator_message', { text: '' });

  stats.chats += 1;
  sseDone();
});

app.listen(PORT, () => {
  console.log(`AI Agora backend listening on :${PORT}`);
});
