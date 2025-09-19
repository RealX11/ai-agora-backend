// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Configuration, OpenAIApi } = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== OPENAI ==========
const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

// ========== CLAUDE ==========
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ========== GEMINI ==========
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ---- Test root endpoint ----
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "AI Agora Backend running 🚀" });
});

// ---- GPT ----
app.post("/api/chat/gpt", async (req, res) => {
  try {
    const { question, language } = req.body;
    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    res.json({
      success: true,
      role: "gpt",
      text: completion.data.choices[0].message.content,
    });
  } catch (err) {
    res.json({ success: false, role: "gpt", text: `Error: ${err.message}` });
  }
});

// ---- CLAUDE ----
app.post("/api/chat/claude", async (req, res) => {
  try {
    const { question, language } = req.body;
    const completion = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 512,
      messages: [{ role: "user", content: question }],
    });

    res.json({
      success: true,
      role: "claude",
      text: completion.content[0].text,
    });
  } catch (err) {
    res.json({
      success: false,
      role: "claude",
      text: `Error: ${err.message}`,
    });
  }
});

// ---- GEMINI ----
app.post("/api/chat/gemini", async (req, res) => {
  try {
    const { question, language } = req.body;
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(question);
    const text = result.response.text();

    res.json({
      success: true,
      role: "gemini",
      text,
    });
  } catch (err) {
    res.json({
      success: false,
      role: "gemini",
      text: `Error: ${err.message}`,
    });
  }
});

// ---- Combined endpoint (hepsi aynı anda) ----
app.post("/api/chat", async (req, res) => {
  const { question, language, includeGPT, includeClaude, includeGemini } =
    req.body;

  const responses = {};

  try {
    if (includeGPT) {
      const completion = await openai.createChatCompletion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: question }],
      });
      responses.gpt = completion.data.choices[0].message.content;
    }
  } catch (err) {
    responses.gpt = `Error: ${err.message}`;
  }

  try {
    if (includeClaude) {
      const completion = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 512,
        messages: [{ role: "user", content: question }],
      });
      responses.claude = completion.content[0].text;
    }
  } catch (err) {
    responses.claude = `Error: ${err.message}`;
  }

  try {
    if (includeGemini) {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent(question);
      responses.gemini = result.response.text();
    }
  } catch (err) {
    responses.gemini = `Error: ${err.message}`;
  }

  res.json({
    success: true,
    detectedLanguage: language || "en",
    responses,
  });
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
