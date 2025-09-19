import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL bağlantısı (opsiyonel logging için)
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// AI client’lar
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//
// GPT endpoint
//
app.post("/api/chat/gpt", async (req, res) => {
  try {
    const { question } = req.body;

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    const text = result.choices[0]?.message?.content || "No response";

    res.json({ success: true, role: "gpt", text });
  } catch (error) {
    res.json({ success: false, role: "gpt", text: "Error: " + error.message });
  }
});

//
// Claude endpoint
//
app.post("/api/chat/claude", async (req, res) => {
  try {
    const { question } = req.body;

    const result = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 500,
      messages: [{ role: "user", content: question }],
    });

    const text = result.content[0]?.text || "No response";

    res.json({ success: true, role: "claude", text });
  } catch (error) {
    res.json({ success: false, role: "claude", text: "Error: " + error.message });
  }
});

//
// Gemini endpoint
//
app.post("/api/chat/gemini", async (req, res) => {
  try {
    const { question } = req.body;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const chat = model.startChat();
    const result = await chat.sendMessage(question);
    const text = result.response.text() || "No response";

    res.json({ success: true, role: "gemini", text });
  } catch (error) {
    res.json({ success: false, role: "gemini", text: "Error: " + error.message });
  }
});

//
// Moderator endpoint (GPT kullanıyor)
//
app.post("/api/chat/moderator", async (req, res) => {
  try {
    const { question, moderatorSource, moderatorStyle } = req.body;

    const systemPrompt = `You are a moderator. Summarize or compare AI responses with style: ${moderatorStyle}. Source: ${moderatorSource}.`;

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    });

    const text = result.choices[0]?.message?.content || "No response";

    res.json({ success: true, role: "moderator", text });
  } catch (error) {
    res.json({ success: false, role: "moderator", text: "Error: " + error.message });
  }
});

//
// Combined endpoint (opsiyonel - hepsini birden döndürür)
//
app.post("/api/chat", async (req, res) => {
  try {
    const { question, includeGPT, includeClaude, includeGemini, includeModerator, moderatorSource, moderatorStyle } = req.body;

    const tasks = [];

    if (includeGPT) {
      tasks.push(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: question }],
        }).then(r => ({ role: "gpt", text: r.choices[0]?.message?.content || "No response", success: true }))
          .catch(e => ({ role: "gpt", text: "Error: " + e.message, success: false }))
      );
    }

    if (includeClaude) {
      tasks.push(
        anthropic.messages.create({
          model: "claude-3-5-sonnet-20240620",
          max_tokens: 500,
          messages: [{ role: "user", content: question }],
        }).then(r => ({ role: "claude", text: r.content[0]?.text || "No response", success: true }))
          .catch(e => ({ role: "claude", text: "Error: " + e.message, success: false }))
      );
    }

    if (includeGemini) {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = model.startChat();
      tasks.push(
        chat.sendMessage(question)
          .then(r => ({ role: "gemini", text: r.response.text() || "No response", success: true }))
          .catch(e => ({ role: "gemini", text: "Error: " + e.message, success: false }))
      );
    }

    if (includeModerator) {
      tasks.push(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: `You are a moderator. Summarize or compare AI responses with style: ${moderatorStyle}. Source: ${moderatorSource}.` },
            { role: "user", content: question },
          ],
        }).then(r => ({ role: "moderator", text: r.choices[0]?.message?.content || "No response", success: true }))
          .catch(e => ({ role: "moderator", text: "Error: " + e.message, success: false }))
      );
    }

    const results = await Promise.all(tasks);

    res.json({
      success: true,
      responses: results.reduce((acc, r) => {
        acc[r.role] = r.text;
        return acc;
      }, {})
    });

  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

//
// Health check
//
app.get("/", (req, res) => {
  res.send("✅ AI Agora Backend is running!");
});

//
// Server başlat
//
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
