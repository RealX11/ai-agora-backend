// server.js — AI Agora Backend (modernized, auto-latest models)

// Memory monitoring ve crash prevention
setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log(`[MEMORY] Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  
  // 400MB'dan fazla kullanılırsa warning
  if (memUsage.heapUsed > 400 * 1024 * 1024) {
    console.warn('[WARNING] High memory usage detected');
  }
}, 10000); // Her 10 saniyede kontrol

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ====== ENV CHECKS ======
if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] OPENAI_API_KEY is missing in environment variables.');
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[WARN] ANTHROPIC_API_KEY is missing in environment variables.');
}
if (!process.env.GOOGLE_AI_API_KEY) {
  console.warn('[WARN] GOOGLE_AI_API_KEY is missing in environment variables.');
}

// ====== CLIENTS ======
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Google AI client with improved error handling
let genAI;
try {
  const googleApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (googleApiKey) {
    genAI = new GoogleGenerativeAI(googleApiKey);
    console.log('[INIT] Google AI client initialized successfully');
  } else {
    console.warn('[INIT] Google AI API key not found - Gemini will be unavailable');
  }
} catch (error) {
  console.error('[INIT] Failed to initialize Google AI client:', error.message);
}

// ====== MODEL CHOICES (auto "latest") ======
// OpenAI: latest stable GPT-4 model
const OPENAI_CHAT_MODEL = 'gpt-4o';
// Anthropic: latest Claude Sonnet 4 model (from API response)
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
// Google: latest stable Gemini 2.5 Pro model
const GEMINI_MODEL = "gemini-2.5-pro";

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json());

// ====== UTILS ======


// OpenAI chat via REST (avoids SDK surface differences)
async function openaiChat(messages, { model = OPENAI_CHAT_MODEL, max_tokens = 400, temperature = 0.7 } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens, temperature }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error?.message || `OpenAI HTTP ${resp.status}`);
  }
  return json;
}

// ====== ENDPOINTS ======
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'AI Agora Backend is running',
    timestamp: new Date().toISOString(),
    apis: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      google: !!process.env.GOOGLE_AI_API_KEY,
    },
    models: {
      openai: OPENAI_CHAT_MODEL,
      anthropic: CLAUDE_MODEL,
      gemini: GEMINI_MODEL,
    },
    features: {
      structuredOutput: true,
      parallelProcessing: true,
      moderatorStyles: ['neutral', 'analytical', 'educational', 'creative', 'quick-summary'],
    },
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const {
      question,
      
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
      // New AI selection parameters (fallback to iOS params)
      enabledAIs = { 
        gpt: includeGPT === true, 
        claude: includeClaude === true, 
        gemini: includeGemini === true, 
        moderator: includeModerator === true 
      },
      // (iOS artık model göndermiyor; backend auto-select yapıyor)
    } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required', success: false });
    }


    // iOS ModeratorStyle compatibility mapping
    const moderatorStyleMapping = {
      'Quick Summary': 'quick-summary',
      'Best Answer': 'neutral', 
      'Action Steps': 'educational',
      'Detailed Analysis': 'analytical'
    };
    
    const finalModeratorStyle = moderatorStyleMapping[moderatorStyle] || moderatorStyle || 'neutral';
    console.log('[MODERATOR STYLE] iOS sent:', moderatorStyle, '→ Backend using:', finalModeratorStyle);

    // iOS moderatorSource compatibility (convert ChatMessage.Role to string)
    const moderatorSourceMapping = {
      'GPT': 'gpt',
      'Claude': 'claude', 
      'Gemini': 'gemini'
    };
    
    const finalModeratorSource = moderatorSourceMapping[moderatorSource] || moderatorSource || 'gpt';
    console.log('[MODERATOR SOURCE] iOS sent:', moderatorSource, '→ Backend using:', finalModeratorSource);

    // Normalize conversation history for different providers
    const conversationHistory = (Array.isArray(conversation) ? conversation : [])
      .map(msg => ({
        role: msg?.sender === 'user' ? 'user' : 'assistant',
        content: msg?.text || '',
      }))
      .filter(m => !!m.content);

    console.log('[DEBUG] Original conversation history:', conversationHistory.length, 'messages');
    
    // IMPORTANT: Each AI should see only USER messages in history, not other AI responses
    // This prevents AIs from responding to each other instead of the user
    const userOnlyHistory = conversationHistory.filter(msg => msg.role === 'user');
    console.log('[DEBUG] User-only history for AIs:', userOnlyHistory.length, 'messages');

    // Validate round count
    const maxRounds = Math.max(1, Math.min(roundCount || 1, 3)); // Limit to 1-3 rounds
    console.log('[ROUNDS] Processing', maxRounds, 'rounds of AI conversation');
    
    console.log('[DEBUG] Incoming iOS params:', { includeGPT, includeClaude, includeGemini, includeModerator });
    console.log('[DEBUG] Resolved enabledAIs:', enabledAIs);
    
    // Validate enabled AIs
    const activeAIs = {
      gpt: enabledAIs?.gpt === true,
      claude: enabledAIs?.claude === true,
      gemini: enabledAIs?.gemini === true,
      moderator: enabledAIs?.moderator === true
    };
    
    console.log('[AI SELECTION] Active AIs:', activeAIs);
    console.log('[MODERATOR] Source:', finalModeratorSource, 'Style:', finalModeratorStyle);

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
    
    console.log('[AI ORDER] Execution sequence:', aiOrder);

    // === Sequential AI calls with selective enabled AIs ===
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

      // Execute AIs in order based on user selection
      for (let i = 0; i < aiOrder.length; i++) {
        const aiName = aiOrder[i];
        
        // Build context of current round responses so far
        let currentRoundContext = '';
        const completedAIs = aiOrder.slice(0, i);
        if (completedAIs.length > 0) {
          currentRoundContext = completedAIs.map(ai => {
            if (roundResponses[ai]) {
              return `${ai.toUpperCase()}: ${roundResponses[ai]}`;
            }
            return '';
          }).filter(text => text).join('\n\n');
        }

        if (aiName === 'gpt' && activeAIs.gpt) {
          // GPT Implementation
          try {
            console.log(`[ROUND ${round}] Step ${i + 1}: GPT responding...`);
            
            let gptPrompt = question;
            if (round > 1 || currentRoundContext) {
              gptPrompt = `Question: "${question}"`;
              
              if (previousRoundsContext) {
                gptPrompt += `\n\nPrevious: ${previousRoundsContext}`;
              }
              
              if (currentRoundContext) {
                gptPrompt += `\n\nOther responses: ${currentRoundContext}`;
              }
              
              gptPrompt += `\n\nBrief response please.`;
            }
            
            const messages = [
              {
                role: 'system',
              },
              ...userOnlyHistory.slice(-3),
              { role: 'user', content: gptPrompt },
            ];
            
            const gptResponse = await openaiChat(messages, {
              model: OPENAI_CHAT_MODEL,
              max_tokens: 150, // Reduced from 400 for faster responses
              temperature: 0.7,
            });
            roundResponses.gpt = gptResponse.choices?.[0]?.message?.content || 'GPT response error';
            console.log(`[ROUND ${round}] GPT response received:`, roundResponses.gpt.substring(0, 100) + '...');
          } catch (err) {
            roundResponses.gpt = `GPT Error: ${err.message}`;
            console.error(`[ROUND ${round}] GPT error:`, err.message);
          }
        }

        if (aiName === 'claude' && activeAIs.claude) {
          // Claude Implementation
          try {
            console.log(`[ROUND ${round}] Step ${i + 1}: Claude responding...`);
            
            let claudePrompt = `Question: "${question}"`;
            
            if (currentRoundContext) {
              claudePrompt += `\n\nOther responses: ${currentRoundContext}`;
            }

            if (previousRoundsContext) {
              claudePrompt += `\n\nPrevious: ${previousRoundsContext}`;
              claudePrompt += `\n\nBrief response please.`;
            } else if (currentRoundContext) {
              claudePrompt += `\n\nProvide a brief response.`;
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
              max_tokens: 150, // Reduced from 500 for faster responses
              messages: msgs,
            });
            roundResponses.claude = claudeResponse?.content?.[0]?.text || 'Claude response error';
            console.log(`[ROUND ${round}] Claude response received:`, roundResponses.claude.substring(0, 100) + '...');
          } catch (err) {
            roundResponses.claude = `Claude Error: ${err.message}`;
            console.error(`[ROUND ${round}] Claude error:`, err.message);
          }
        }

        if (aiName === 'gemini' && activeAIs.gemini) {
          // Gemini Implementation
          try {
            console.log(`[ROUND ${round}] Step ${i + 1}: Gemini responding...`);
            
            // Validate API key first
            const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
            if (!apiKey) {
              throw new Error('Google AI API key not found in environment variables');
            }
            
            // Create model with standard configuration
            const model = genAI.getGenerativeModel({ 
              model: GEMINI_MODEL,
              generationConfig: {
                maxOutputTokens: 150, // Reduced from 500 for faster responses
                temperature: 0.7,
                topP: 0.8,
                topK: 40,
              },
            });
            
            // Prepare conversation history in Gemini format
            const history = userOnlyHistory.slice(-3).map(msg => ({
              role: 'user',
              parts: [{ text: msg.content }],
            }));
            
            // Start chat session
            const chat = model.startChat({ history });
            

User question: "${question}"`;

            if (currentRoundContext) {
              geminiPrompt += `\n\nOther AI responses: ${currentRoundContext}`;
            }

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
            
            roundResponses.gemini = text || 'Gemini response error';
            console.log(`[ROUND ${round}] Gemini response received:`, roundResponses.gemini.substring(0, 100) + '...');
            
          } catch (error) {
            console.error(`[ROUND ${round}] Gemini error:`, error.message);
            if (error.message.includes('API key')) {
              roundResponses.gemini = 'Gemini Error: API key issue';
            } else if (error.message.includes('quota')) {
              roundResponses.gemini = 'Gemini Error: API quota exceeded';
            } else if (error.message.includes('network') || error.message.includes('timeout')) {
              roundResponses.gemini = 'Gemini Error: Network connectivity issue';
            } else {
              roundResponses.gemini = `Gemini Error: ${error.message}`;
            }
          }
        }
      }
      
      // Add this round's responses to the collection
      allRoundsResponses.push(roundResponses);
      console.log(`[ROUND ${round}] Round ${round} completed successfully`);
    }
    
    // Use the last round's responses as the final responses
    const finalResponses = allRoundsResponses[allRoundsResponses.length - 1];

    // === Moderator (Dynamic source based on user selection) ===
    let moderatorText = 'Moderator response unavailable.';
    
    if (activeAIs.moderator) {
      const moderatorPrompts = {
      };
      const moderatorPrompt = moderatorPrompts[finalModeratorStyle] || moderatorPrompts.neutral;

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
        const moderatorTokens = finalModeratorStyle === 'quick-summary' ? 100 : 200; // Much shorter for quick summary
        
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
            const model = genAI.getGenerativeModel({ 
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
          
          const modJson = await openaiChat(modMessages, {
            model: OPENAI_CHAT_MODEL,
            max_tokens: moderatorTokens,
            temperature: 0.8,
          });
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

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedback, deviceId, appVersion, rating, timestamp } = req.body;
    const feedbackData = {
      feedback,
      deviceId,
      appVersion,
      rating,
      timestamp: timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
    console.log('Feedback received:', feedbackData);
    res.json({
      success: true,
      message: 'Thank you for your feedback! We appreciate your input.',
      id: Date.now().toString(),
    });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to save feedback', success: false });
  }
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    status: 'active',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available_endpoints: ['/health', '/api/chat', '/api/feedback', '/api/stats'],
  });
});

app.listen(PORT, () => {
  console.log(` AI Agora Backend running on port ${PORT}`);
  console.log(` Health: http://localhost:${PORT}/health`);
  console.log(` Chat:   http://localhost:${PORT}/api/chat`);
  console.log(' API Keys loaded:', {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google: !!process.env.GOOGLE_AI_API_KEY,
  });
});


// 🔁 STREAMING ENDPOINT - /api/chat-stream
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const {
    question,
    includeGPT,
    includeClaude,
    includeGemini,
    includeModerator,
    moderatorSource,
    moderatorStyle,
    roundCount
  } = req.body;

  function send(source, text) {
    res.write(`data: ${JSON.stringify({ source, text })}\n\n`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    if (includeGPT) {
      send('gpt', 'GPT is thinking...');
      await sleep(1200);
      send('gpt', 'GPT: The capital of France is Paris.');
    }

    if (includeClaude) {
      send('claude', 'Claude is reviewing GPT...');
      await sleep(1000);
      send('claude', 'Claude: GPT is correct. Paris is the capital.');
    }

    if (includeGemini) {
      send('gemini', 'Gemini is analyzing...');
      await sleep(1000);
      send('gemini', 'Gemini: Paris is indeed the capital of France.');
    }

    if (includeModerator) {
      send('moderator', 'Moderator is summarizing...');
      await sleep(1300);
      send('moderator', 'Moderator: All AIs agree. Paris is correct.');
    }

    res.write(`event: end\ndata: done\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});
