// server.js (CommonJS version, require kullanıyor)

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const { Configuration, OpenAIApi } = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Anthropic = require("@anthropic-ai/sdk");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// === API Keys ===
const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// === MODELS (latest stable) ===
const GPT_MODEL = "gpt-4o-mini";
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";
const GEMINI_MODEL = "gemini-2.5-flash";

// === Helper functions ===

// GPT
async function callGPT(question, language) {
  try {
    const response = await openai.createChatCompletion({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: `Answer in ${language}` },
        { role: "user", content: question },
      ],
    });
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("GPT error:", err.message);
    return `GPT Error: ${err.message}`;
  }
}

// Claude
async function callClaude(question, language) {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Answer in ${language}: ${question}`,
        },
      ],
    });
    return response.content[0].text;
  } catch (err) {
    console.error("Claude error:", err.message);
    return `Claude Error: ${err.message}`;
  }
}

// Gemini
async function callGemini(question, language) {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const response = await model.generateContent(
      `Answer in ${language}: ${question}`
    );
    return response.response.text();
  } catch (err) {
    console.error("Gemini error:", err.message);
    return `Gemini Error: ${err.message}`;
  }
}

// === API endpoints ===

// Unified chat endpoint
app.post("/api/chat", async (req, res) => {
  const {
    question,
    language,
    includeGPT,
    includeClaude,
    includeGemini,
    includeModerator,
    moderatorSource,
    moderatorStyle,
  } = req.body;

  const responses = {};

  if (includeGPT) responses.gpt = await callGPT(question, language);
  if (includeClaude) responses.claude = await callClaude(question, language);
  if (includeGemini) responses.gemini = await callGemini(question, language);

  if (includeModerator) {
    const collected = Object.entries(responses)
      .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
      .join("\n\n");

    const modPrompt = `You are the Moderator AI. Summarize these answers in style: ${moderatorStyle}.
    
${collected}`;

    responses.moderator = await callGPT(modPrompt, language);
  }

  res.json({ success: true, detectedLanguage: language, responses });
});

// === Health check ===
app.get("/", (req, res) => {
  res.send("AI Agora Backend is running ✅");
});

// Start server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
