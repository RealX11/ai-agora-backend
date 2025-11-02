import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// İsteğe bağlı sağlayıcılar
const requiredEnv = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[warn] Missing env vars: ${missing.join(', ')}. Some providers will be disabled.`);
}

// Modeller (güncel resmi isimler)
export const OPENAI_CHAT_MODEL = 'gpt-5-mini-2025-08-07';
export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
export const GEMINI_MODEL = 'gemini-2.5-flash';

const PORT = process.env.PORT || 3000;

// İstemciler
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const genAI = process.env.GoogleGenerativeAI ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY) : null;

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

// Ciddiyet tespiti
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

// Sağlayıcı yardımcıları (language’i net şekilde uygulatıyoruz)
async function streamOpenAI({ prompt, language, round = 1 }) {
  if (!openai) return;
  const roundInstruction = round === 1
    ? "Provide a short and concise answer."
    : round === 2
    ? "Provide a clear and fluent explanation without writing too long."
    : "Provide comprehensive analysis. Up to 400 words allowed.";
  const systemMsg = `${roundInstruction} Respond strictly in ${language}. Do not switch languages.`;
  const stream = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    messages: [
      { role: 'system', content: systemMsg },
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
  const systemMsg = `${roundInstruction} Respond strictly in ${language}. Do not switch languages.`;
  const stream = await anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemMsg,
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
  const systemInstruction = `${roundInstruction} Respond strictly in ${language}. Do not switch languages.`;
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

// Moderatör prompt (rounds'a göre kapsamlı ama kısa değerlendirme + kıyas + nihai karar)
function moderatorPrompt(language, collected, rounds = 1) {
  const considerRounds =
    rounds <= 1 ? [1] :
    rounds === 2 ? [1, 2] :
    [1, 2, 3];

  const filtered = collected.filter(c => considerRounds.includes(c.round));
  const lines = filtered.map((c) => `- [${c.model} R${c.round}] ${c.text}`).join('\n');

  const scopeText =
    considerRounds.length === 1 ? "Round 1 only" :
    considerRounds.length === 2 ? "Rounds 1 and 2" :
    "Rounds 1, 2 and 3";

  const appraisalBrevity =
    considerRounds.length === 1
      ? "Keep each model's appraisal extremely brief (1–2 sentences)."
      : "Keep each model's appraisal brief (2–3 sentences).";

  const analysisDepth =
    considerRounds.length === 1
      ? "Provide a concise synthesis."
      : "Provide a concise but comprehensive synthesis across the considered rounds.";

  const basePrompt = [
    `Act as a neutral but rigorous moderator.`,
    `Scope: ${scopeText}.`,
    `Tasks:`,
    `1) For each model, give a brief appraisal (strengths, weaknesses, any factual gaps or logic issues). ${appraisalBrevity}`,
    `2) Compare models: agreements, disagreements, what's missing.`,
    `3) Choose the most reasonable approach and clearly explain why (in 1–2 sentences).`,
    `4) Provide one final, practical, and helpful answer for the user (clear and actionable).`,
    `${analysisDepth}`,
    `Respond strictly in ${language}. Do not switch languages.`,
    ``,
    `Model responses to consider (${scopeText}):`,
    lines || "(no responses captured)"
  ].join('\n');

  return basePrompt;
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

      // Finalize sinyali
      for (const [model, text] of buffers.entries()) {
        if (text) {
          collected.push({ model, round: r, text });
          sseSend('message', { model, round: r, text: '' });
        }
      }

      resolveRound();
    });
  }

  // Moderatör
  const modPrompt = moderatorPrompt(language, collected, rounds);

  async function* moderatorRun() {
    const moderatorRoundTone = rounds <= 1 ? 1 : (rounds === 2 ? 2 : 3);
    if (moderatorEngine === 'GPT' && openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language, round: moderatorRoundTone });
      for await (const c of chunksFromOpenAI(s)) yield c;
      return;
    }
    if (moderatorEngine === 'Claude' && anthropic) {
      const s = await streamAnthropic({ prompt: modPrompt, language, round: moderatorRoundTone });
      for await (const c of chunksFromAnthropic(s)) yield c;
      return;
    }
    if (moderatorEngine === 'Gemini' && genAI) {
      const s = await streamGemini({ prompt: modPrompt, language, round: moderatorRoundTone });
      for await (const c of chunksFromGemini(s)) yield c;
      return;
    }
    if (openai) {
      const s = await streamOpenAI({ prompt: modPrompt, language, round: moderatorRoundTone });
      for await (const c of chunksFromOpenAI(s)) yield c;
      return;
    }
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
