
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// AI SDK imports
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Model constants - DO NOT CHANGE
const OPENAI_CHAT_MODEL = 'gpt-4o';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GEMINI_MODEL = 'gemini-2.5-pro';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Environment checks
const requiredEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`⚠️  Missing environment variable: ${envVar}`);
  }
}

// Initialize AI clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

// Utility functions
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function detectLanguage(text) {
  // Simple language detection based on common patterns
  if (/[çğıöşüÇĞIİÖŞÜ]/.test(text)) return 'tr';
  if (/[áéíóúüñ¿¡]/i.test(text)) return 'es';
  if (/[àâäéèêëîïôöùûüÿç]/i.test(text)) return 'fr';
  if (/[äöüßÄÖÜ]/.test(text)) return 'de';
  return 'en'; // default to English
}

function getModeratorPrompt(style, language, modelResponses, originalQuestion) {
  const langPrompts = {
    en: {
      neutral: `Analyze the following AI responses to the question: "${originalQuestion}"\n\nResponses:\n${modelResponses}\n\nProvide a balanced, concise summary that highlights key points and resolves any contradictions.`,
      analytical: `Compare and analyze the following AI responses to: "${originalQuestion}"\n\nResponses:\n${modelResponses}\n\nProvide a detailed analysis explaining what each model said, why they differ, and identify the most accurate insights.`,
      educational: `Review these AI responses to: "${originalQuestion}"\n\nResponses:\n${modelResponses}\n\nCreate an educational explanation with step-by-step reasoning and clear learning points.`,
      creative: `Transform these AI responses to: "${originalQuestion}"\n\nResponses:\n${modelResponses}\n\nCreate an engaging, narrative synthesis that creatively presents the key insights.`,
      'quick-summary': `Summarize these AI responses to: "${originalQuestion}"\n\nResponses:\n${modelResponses}\n\nProvide a 1-2 sentence summary of the most important takeaway.`
    },
    tr: {
      neutral: `Şu soruya verilen AI yanıtlarını analiz et: "${originalQuestion}"\n\nYanıtlar:\n${modelResponses}\n\nAna noktaları öne çıkaran ve çelişkileri çözen dengeli, öz bir özet sun.`,
      analytical: `Şu soruya verilen AI yanıtlarını karşılaştır: "${originalQuestion}"\n\nYanıtlar:\n${modelResponses}\n\nHer modelin ne dediğini, neden farklılaştıklarını açıklayan ve en doğru görüşleri belirten detaylı analiz yap.`,
      educational: `Şu soruya verilen AI yanıtlarını incele: "${originalQuestion}"\n\nYanıtlar:\n${modelResponses}\n\nAdım adım mantık yürütme ve açık öğrenim noktalarıyla eğitici açıklama oluştur.`,
      creative: `Şu soruya verilen AI yanıtlarını dönüştür: "${originalQuestion}"\n\nYanıtlar:\n${modelResponses}\n\nAna görüşleri yaratıcı şekilde sunan ilgi çekici, anlatımsal bir sentez oluştur.`,
      'quick-summary': `Şu soruya verilen AI yanıtlarını özetle: "${originalQuestion}"\n\nYanıtlar:\n${modelResponses}\n\nEn önemli çıkarımın 1-2 cümlelik özetini ver.`
    }
  };

  return langPrompts[language] || langPrompts.en;
}

// AI Model functions
async function callOpenAI(messages, stream = false) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      messages: messages,
      stream: stream,
      temperature: 0.7,
      max_tokens: 2000
    });
    return response;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw new Error(`OpenAI Error: ${error.message}`);
  }
}

// Remove the custom callClaude function completely since we'll use direct SDK calls

async function callGemini(messages, stream = false) {
  try {
    const model = genai.getGenerativeModel({ model: GEMINI_MODEL });
    
    // Convert messages to Gemini format
    const conversation = messages
      .filter(m => m.role !== 'system')
      .map(m => m.content)
      .join('\n\n');
    
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const fullPrompt = systemMessage ? `${systemMessage}\n\n${conversation}` : conversation;
    
    if (stream) {
      return await model.generateContentStream(fullPrompt);
    } else {
      return await model.generateContent(fullPrompt);
    }
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw new Error(`Gemini Error: ${error.message}`);
  }
}

// SSE streaming function for models
async function streamModelResponse(res, modelName, modelFunction, messages) {
  try {
    const stream = await modelFunction(messages, true);
    let fullResponse = '';
    
    if (modelName === 'gpt') {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          res.write(`event: model_chunk\ndata: ${JSON.stringify({ model: modelName, textChunk: content })}\n\n`);
          res.flush && res.flush(); // Force immediate send
        }
      }
    } else if (modelName === 'claude') {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.text) {
          fullResponse += chunk.delta.text;
          res.write(`event: model_chunk\ndata: ${JSON.stringify({ model: modelName, textChunk: chunk.delta.text })}\n\n`);
          res.flush && res.flush(); // Force immediate send
        }
      }
    } else if (modelName === 'gemini') {
      for await (const chunk of stream.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          res.write(`event: model_chunk\ndata: ${JSON.stringify({ model: modelName, textChunk: text })}\n\n`);
          res.flush && res.flush(); // Force immediate send
        }
      }
    }
    
    res.write(`event: model_done\ndata: ${JSON.stringify({ model: modelName })}\n\n`);
    res.flush && res.flush();
    
    return fullResponse; // Return full response for moderator
    
  } catch (error) {
    console.error(`${modelName} streaming error:`, error);
    res.write(`event: error\ndata: ${JSON.stringify({ model: modelName, message: `${modelName.toUpperCase()} model is currently unavailable` })}\n\n`);
    res.flush && res.flush();
    return '';
  }
}

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  console.log(`[${requestId}] New chat request started`);
  
  try {
    // Validate request body
    const { 
      question, 
      activeModels = ['gpt', 'claude', 'gemini'], 
      rounds = 1, 
      moderatorEngine = 'moderator',
      moderatorStyle = 'neutral',
      language 
    } = req.body;
    
    if (!question || !Array.isArray(activeModels) || activeModels.length === 0) {
      return res.status(400).json({ error: 'Invalid request: question and activeModels are required' });
    }
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Detect language
    const detectedLang = language || detectLanguage(question);
    
    // Send session start
    res.write(`event: session_start\ndata: ${JSON.stringify({ 
      sessionId: requestId, 
      language: detectedLang,
      activeModels,
      rounds 
    })}\n\n`);
    
    // Model mapping
    const modelFunctions = {
      gpt: callOpenAI,
      claude: callClaude,
      gemini: callGemini
    };
    
    let conversationHistory = [];
    let allModelResponses = {};
    
    // Execute rounds
    for (let round = 1; round <= rounds; round++) {
      console.log(`[${requestId}] Starting round ${round}`);
      
      if (round > 1) {
        res.write(`event: round_start\ndata: ${JSON.stringify({ round, message: `${round}. Tur başlıyor...` })}\n\n`);
      }
      
      const roundResponses = {};
      const streamPromises = [];
      
      // Prepare messages for this round
      let messages = [
        { role: 'system', content: `Please respond in ${detectedLang === 'tr' ? 'Turkish' : 'English'}. Be concise and helpful.` },
        { role: 'user', content: question }
      ];
      
      // Add previous round context for multi-round mode
      if (round > 1 && Object.keys(allModelResponses).length > 0) {
        const previousResponses = Object.entries(allModelResponses)
          .map(([model, response]) => `${model.toUpperCase()}: ${response}`)
          .join('\n\n');
        
        messages.push({
          role: 'user', 
          content: `Previous responses from other models:\n${previousResponses}\n\nPlease provide your updated response, highlighting agreements or disagreements briefly.`
        });
      }
      
      // Collect responses for each round (parallel streaming)
      const modelPromises = activeModels.map(async (modelName) => {
        if (modelFunctions[modelName]) {
          try {
            const fullResponse = await streamModelResponse(res, modelName, modelFunctions[modelName], messages);
            roundResponses[modelName] = fullResponse;
          } catch (error) {
            console.error(`[${requestId}] ${modelName} failed:`, error);
            roundResponses[modelName] = '';
          }
        }
      });
      
      // Wait for all models to complete
      await Promise.allSettled(modelPromises);
      
      // Update allModelResponses with this round's responses
      Object.assign(allModelResponses, roundResponses);
      
      res.write(`event: round_complete\ndata: ${JSON.stringify({ round })}\n\n`);
    }
    
    // Moderator synthesis (always runs last)
    console.log(`[${requestId}] Starting moderator synthesis`);
    
    try {
      const modelResponsesText = Object.entries(allModelResponses)
        .map(([model, response]) => `**${model.toUpperCase()}**: ${response}`)
        .join('\n\n');
      
      const moderatorPromptObj = getModeratorPrompt(moderatorStyle, detectedLang, modelResponsesText, question);
      const moderatorMessages = [
        { role: 'user', content: moderatorPromptObj }
      ];
      
      // Use selected moderator engine
      let moderatorFunction = modelFunctions[moderatorEngine] || modelFunctions.gpt;
      await streamModelResponse(res, 'moderator', moderatorFunction, moderatorMessages);
      
    } catch (error) {
      console.error(`[${requestId}] Moderator error:`, error);
      res.write(`event: error\ndata: ${JSON.stringify({ model: 'moderator', message: 'Moderator synthesis failed' })}\n\n`);
    }
    
    // End session
    const duration = Date.now() - startTime;
    console.log(`[${requestId}] Chat completed in ${duration}ms`);
    
    res.write(`event: done\ndata: ${JSON.stringify({ 
      sessionId: requestId, 
      duration,
      roundsCompleted: rounds 
    })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error(`[${requestId}] Chat error:`, error);
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    res.end();
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    models: {
      openai: OPENAI_CHAT_MODEL,
      claude: CLAUDE_MODEL,
      gemini: GEMINI_MODEL
    },
    env_check: {
      openai_key: !!process.env.OPENAI_API_KEY,
      anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      google_key: !!process.env.GOOGLE_AI_API_KEY
    }
  };
  
  res.json(health);
});

// Stats endpoint (optional)
app.get('/api/stats', (req, res) => {
  // Simple in-memory stats (in production, you'd use a proper store)
  res.json({
    total_requests: 0,
    avg_response_time: 0,
    success_rate: '100%',
    active_models: [OPENAI_CHAT_MODEL, CLAUDE_MODEL, GEMINI_MODEL]
  });
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { message, timestamp, clientInfo } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const feedback = {
      id: generateRequestId(),
      message,
      timestamp: timestamp || new Date().toISOString(),
      clientInfo: clientInfo || {},
      received_at: new Date().toISOString()
    };
    
    // Save to JSON file
    const feedbackFile = path.join(__dirname, 'feedback.json');
    let existingFeedback = [];
    
    try {
      const data = await fs.readFile(feedbackFile, 'utf8');
      existingFeedback = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start with empty array
    }
    
    existingFeedback.push(feedback);
    
    await fs.writeFile(feedbackFile, JSON.stringify(existingFeedback, null, 2));
    
    console.log(`Feedback received: ${feedback.id}`);
    res.json({ success: true, id: feedback.id });
    
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// Memory monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const memInMB = memUsage.heapUsed / 1024 / 1024;
  
  if (memInMB > 400) {
    console.warn(`⚠️  High memory usage: ${memInMB.toFixed(2)} MB`);
  }
}, 30000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Agora Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Models: ${OPENAI_CHAT_MODEL}, ${CLAUDE_MODEL}, ${GEMINI_MODEL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});
