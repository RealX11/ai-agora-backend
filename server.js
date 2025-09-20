const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// AI SDK imports
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

  return langPrompts[language]?.[style] || langPrompts.en[style] || langPrompts.en.neutral;
}

// OpenAI function
async function callOpenAI(messages, stream = false) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: messages,
      stream: stream,
      temperature: 0.7,
      max_tokens: 2000
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `OpenAI HTTP ${response.status}`);
  }

  if (stream) {
    return response.body;
  }
  
  return response.json();
}

// SSE streaming function for models
async function streamModelResponse(res, modelName, modelFunction, messages) {
  try {
    let fullResponse = '';
    
    if (modelName === 'gpt') {
      const stream = await modelFunction(messages, true);
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          res.write(`event: model_chunk\ndata: ${JSON.stringify({ model: modelName, textChunk: content })}\n\n`);
          res.flush && res.flush();
        }
      }
    } else if (modelName === 'claude') {
      // Claude handled directly in main endpoint
      fullResponse = 'Claude handled directly in main endpoint';
    } else if (modelName === 'gemini') {
      const stream = await modelFunction(messages, true);
      
      for await (const chunk of stream.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          res.write(`event: model_chunk\ndata: ${JSON.stringify({ model: modelName, textChunk: text })}\n\n`);
          res.flush && res.flush();
        }
      }
    }
    
    res.write(`event: model_done\ndata: ${JSON.stringify({ model: modelName })}\n\n`);
    res.flush && res.flush();
    
    return fullResponse;
    
  } catch (error) {
    console.error(`${modelName} streaming error:`, error);
    res.write(`event: error\ndata: ${JSON.stringify({ model: modelName, message: `${modelName.toUpperCase()} model is currently unavailable` })}\n\n`);
    res.flush && res.flush();
    return '';
  }
}

// Main chat endpoint for iOS app
app.post('/api/chat_non_streaming', async (req, res) => {
  try {
    const {
      question,
      language,
      conversation = [],
      moderatorStyle = 'neutral',
      structuredOutput = false,
      roundCount = 1,
      // iOS app compatibility parameters
      includeGPT = true,
      includeClaude = true, 
      includeGemini = true,
      includeModerator = true,
      moderatorSource = 'gpt',
    } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required', success: false });
    }

    const detectedLang = language || detectLanguage(question);
    const languageInstruction = detectedLang === 'tr' ? 'Turkish' : 'English';

    // iOS ModeratorStyle compatibility mapping
    const moderatorStyleMapping = {
      'Quick Summary': 'quick-summary',
      'Best Answer': 'neutral', 
      'Action Steps': 'educational',
      'Detailed Analysis': 'analytical'
    };
    
    const finalModeratorStyle = moderatorStyleMapping[moderatorStyle] || moderatorStyle || 'neutral';

    // iOS moderatorSource compatibility
    const moderatorSourceMapping = {
      'GPT': 'gpt',
      'Claude': 'claude', 
      'Gemini': 'gemini'
    };
    
    const finalModeratorSource = moderatorSourceMapping[moderatorSource] || moderatorSource || 'gpt';

    // Normalize conversation history
    const conversationHistory = (Array.isArray(conversation) ? conversation : [])
      .map(msg => ({
        role: msg?.sender === 'user' ? 'user' : 'assistant',
        content: msg?.text || '',
      }))
      .filter(m => !!m.content);

    const userOnlyHistory = conversationHistory.filter(msg => msg.role === 'user');

    // Validate round count
    const maxRounds = Math.max(1, Math.min(roundCount || 1, 3));
    
    // Validate enabled AIs
    const activeAIs = {
      gpt: includeGPT === true,
      claude: includeClaude === true,
      gemini: includeGemini === true,
      moderator: includeModerator === true
    };
    
    // Determine AI execution order based on enabled AIs
    const aiOrder = [];
    if (activeAIs.gpt) aiOrder.push('gpt');
    if (activeAIs.claude) aiOrder.push('claude');
    if (activeAIs.gemini) aiOrder.push('gemini');
    
    if (aiOrder.length === 0) {
      return res.status(400).json({ 
        error: 'At least one AI assistant must be enabled', 
        success: false 
      });
    }

    // Execute AI calls with multiple rounds
    const allRoundsResponses = [];

    for (let round = 1; round <= maxRounds; round++) {
      console.log(`[ROUND ${round}] Starting round ${round} of ${maxRounds}...`);

      const roundResponses = {};

      // Build context from previous rounds
      let previousRoundsContext = '';
      if (round > 1) {
        previousRoundsContext = allRoundsResponses.map((prevRound, index) => {
          let roundSummary = `\n--- Round ${index + 1} Results ---\n`;
          if (prevRound.gpt) roundSummary += `GPT: ${prevRound.gpt}\n`;
          if (prevRound.claude) roundSummary += `Claude: ${prevRound.claude}\n`;
          if (prevRound.gemini) roundSummary += `Gemini: ${prevRound.gemini}\n`;
          return roundSummary;
        }).join('\n');
      }

      const promises = [];

      if (activeAIs.gpt) {
        promises.push(
          (async () => {
            try {
              console.log(`[ROUND ${round}] GPT responding...`);
              let gptPrompt = `Question: "${question}"`;
              if (previousRoundsContext) {
                gptPrompt += `\n\nPrevious: ${previousRoundsContext}`;
              }
              gptPrompt += `\n\nBrief response please.`;

              const messages = [
                {
                  role: 'system',
                  content: `You are ChatGPT. Respond briefly in ${languageInstruction}. Keep answers short and helpful.`,
                },
                ...userOnlyHistory.slice(-3),
                { role: 'user', content: gptPrompt },
              ];

              const gptResponse = await callOpenAI(messages, false);
              return {
                ai: 'gpt',
                response: gptResponse.choices?.[0]?.message?.content || 'GPT response error',
              };
            } catch (err) {
              console.error(`[ROUND ${round}] GPT error:`, err.message);
              return { ai: 'gpt', response: `GPT Error: ${err.message}` };
            }
          })()
        );
      }

      if (activeAIs.claude) {
        promises.push(
          (async () => {
            try {
              console.log(`[ROUND ${round}] Claude responding...`);
              let claudePrompt = `Question: "${question}"`;
              if (previousRoundsContext) {
                claudePrompt += `\n\nPrevious: ${previousRoundsContext}`;
                claudePrompt += `\n\nBrief response please.`;
              } else {
                claudePrompt += `\n\nBrief answer please.`;
              }

              const msgs = [
                ...userOnlyHistory.slice(-3).map(m => ({
                  role: 'user',
                  content: m.content,
                })),
                { role: 'user', content: claudePrompt },
              ];

              const claudeResponse = await anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: 150,
                system: `You are Claude, an AI assistant. Respond concisely in ${languageInstruction}. Keep answers brief but helpful.`,
                messages: msgs,
              });
              return {
                ai: 'claude',
                response: claudeResponse?.content?.[0]?.text || 'Claude response error',
              };
            } catch (err) {
              console.error(`[ROUND ${round}] Claude error:`, err.message);
              return { ai: 'claude', response: `Claude Error: ${err.message}` };
            }
          })()
        );
      }

      if (activeAIs.gemini) {
        promises.push(
          (async () => {
            try {
              console.log(`[ROUND ${round}] Gemini responding...`);
              const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
              if (!apiKey) {
                throw new Error('Google AI API key not found in environment variables');
              }

              const model = genai.getGenerativeModel({
                model: GEMINI_MODEL,
                generationConfig: {
                  maxOutputTokens: 150,
                  temperature: 0.7,
                  topP: 0.8,
                  topK: 40,
                },
              });

              const history = userOnlyHistory.slice(-3).map(msg => ({
                role: 'user',
                parts: [{ text: msg.content }],
              }));

              const chat = model.startChat({ history });
              let geminiPrompt = `You are Gemini. Respond concisely in ${languageInstruction}.\n\nUser question: "${question}"`;
              if (previousRoundsContext) {
                geminiPrompt += `\n\nPrevious discussion: ${previousRoundsContext}`;
                geminiPrompt += `\n\nProvide a brief response considering the previous discussion.`;
              } else {
                geminiPrompt += `\n\nProvide a brief, helpful response.`;
              }
              geminiPrompt += `\n\nKeep response brief and informative.`;

              const result = await chat.sendMessage(geminiPrompt);
              const response = await result.response;
              const text = response.text();
              return { ai: 'gemini', response: text || 'Gemini response error' };
            } catch (error) {
              console.error(`[ROUND ${round}] Gemini error:`, error.message);
              let errorMessage = `Gemini Error: ${error.message}`;
              if (error.message.includes('API key')) {
                errorMessage = 'Gemini Error: API key issue';
              } else if (error.message.includes('quota')) {
                errorMessage = 'Gemini Error: API quota exceeded';
              } else if (error.message.includes('network') || error.message.includes('timeout')) {
                errorMessage = 'Gemini Error: Network connectivity issue';
              }
              return { ai: 'gemini', response: errorMessage };
            }
          })()
        );
      }

      const results = await Promise.allSettled(promises);

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          const { ai, response } = result.value;
          roundResponses[ai] = response;
          console.log(`[ROUND ${round}] ${ai.toUpperCase()} response received:`, response.substring(0, 100) + '...');
        } else if (result.status === 'rejected') {
          console.error(`[ROUND ${round}] A promise was rejected:`, result.reason);
        }
      });

      // Add this round's responses to the collection
      allRoundsResponses.push(roundResponses);
      console.log(`[ROUND ${round}] Round ${round} completed successfully`);
    }

    const finalResponses = allRoundsResponses.length > 0 ? allRoundsResponses[allRoundsResponses.length - 1] : {};

    // === Moderator (Dynamic source based on user selection) ===
    let moderatorText = 'Moderator response unavailable.';
    
    if (activeAIs.moderator) {
      try {
        // Build comprehensive context for moderator
        let moderatorContext = `User asked: "${question}"\n\n`;
        
        if (maxRounds > 1) {
          moderatorContext += `This discussion involved ${maxRounds} rounds of AI conversation:\n\n`;
          allRoundsResponses.forEach((round, index) => {
            moderatorContext += `--- Round ${index + 1} ---\n`;
            if (round.gpt) moderatorContext += `GPT: ${round.gpt}\n`;
            if (round.claude) moderatorContext += `Claude: ${round.claude}\n`;
            if (round.gemini) moderatorContext += `Gemini: ${round.gemini}\n`;
            moderatorContext += '\n';
          });
          moderatorContext += `Please provide a moderator response that synthesizes the evolution of this ${maxRounds}-round discussion.`;
        } else {
          moderatorContext += `AI Responses:\n`;
          if (finalResponses.gpt) moderatorContext += `GPT: ${finalResponses.gpt}\n`;
          if (finalResponses.claude) moderatorContext += `Claude: ${finalResponses.claude}\n`;
          if (finalResponses.gemini) moderatorContext += `Gemini: ${finalResponses.gemini}\n`;
          moderatorContext += '\nPlease provide a moderator response that synthesizes these perspectives.';
        }
        
        // Choose moderator source based on user setting
        const moderatorTokens = finalModeratorStyle === 'quick-summary' ? 100 : 200;
        
        const moderatorPrompt = getModeratorPrompt(finalModeratorStyle, detectedLang, moderatorContext, question);
        
        if (finalModeratorSource === 'claude' && activeAIs.claude) {
          // Use Claude as moderator
          const msgs = [{ role: 'user', content: moderatorContext }];
          const claudeResponse = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: moderatorTokens,
            system: moderatorPrompt,
            messages: msgs,
          });
          moderatorText = claudeResponse?.content?.[0]?.text || 'Claude moderator response error';
        } else if (finalModeratorSource === 'gemini' && activeAIs.gemini) {
          // Use Gemini as moderator
          const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
          if (apiKey) {
            const model = genai.getGenerativeModel({ 
              model: GEMINI_MODEL,
              generationConfig: {
                maxOutputTokens: moderatorTokens,
                temperature: 0.8,
                topP: 0.8,
                topK: 40,
              },
            });
            
            const chat = model.startChat({});
            const prompt = `${moderatorPrompt}\n\n${moderatorContext}`;
            const result = await chat.sendMessage(prompt);
            const response = await result.response;
            moderatorText = response.text() || 'Gemini moderator response error';
          } else {
            moderatorText = 'Gemini moderator unavailable: API key not found';
          }
        } else {
          // Use GPT as moderator (default)
          const modMessages = [
            { role: 'system', content: moderatorPrompt },
            { role: 'user', content: moderatorContext },
          ];
          
          const modJson = await callOpenAI(modMessages, false);
          moderatorText = modJson.choices?.[0]?.message?.content || 'GPT moderator response error';
        }
        
        console.log('[MODERATOR] Response generated using:', finalModeratorSource, 'with style:', finalModeratorStyle);
        
      } catch (err) {
        console.error('[MODERATOR] Error:', err.message);
        moderatorText = `Moderator response unavailable: ${err.message}`;
      }
    } else {
      console.log('[MODERATOR] Moderator disabled by user');
      moderatorText = null; // Don't include moderator if disabled
    }

    // Build final response object with only enabled AIs
    const responseData = {
      success: true,
      detectedLanguage: detectedLang,
      roundCount: maxRounds,
      activeAIs: Object.keys(activeAIs).filter(ai => activeAIs[ai]),
      moderatorSource: finalModeratorSource,
      moderatorStyle: finalModeratorStyle,
      responses: {},
      allRounds: maxRounds > 1 ? allRoundsResponses : undefined, // Include all rounds if multiple
    };

    // Add AI responses only if they were enabled
    if (activeAIs.gpt) responseData.responses.gpt = finalResponses.gpt;
    if (activeAIs.claude) responseData.responses.claude = finalResponses.claude;
    if (activeAIs.gemini) responseData.responses.gemini = finalResponses.gemini;
    
    // Add moderator response only if enabled and generated
    if (moderatorText) responseData.responses.moderator = moderatorText;

    console.log(`[RESPONSE] Final response includes: ${Object.keys(responseData.responses).join(', ')}`);
    
    return res.json(responseData);
  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message, success: false });
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    models: {
      openai: OPENAI_CHAT_MODEL,
      claude: CLAUDE_MODEL,
      gemini: GEMINI_MODEL,
    },
    env_check: {
      openai_key: !!process.env.OPENAI_API_KEY,
      anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      google_key: !!process.env.GOOGLE_AI_API_KEY
    }
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
