const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Model Sabitleri (Değiştirilemez) ---
const OPENAI_CHAT_MODEL = 'gpt-4o';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GEMINI_MODEL = 'gemini-2.5-pro';
// ----------------------------------------

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Client Initialization
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

// Environment Variable Validation
const validateEnv = () => {
  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!process.env.GOOGLE_AI_API_KEY) missing.push('GOOGLE_AI_API_KEY');
  
  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
  }
};
validateEnv();

// Utility Functions
function createSSEMessage(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function getSystemPromptForModerator(style, language, rounds, question, modelResponses) {
  const basePrompt = {
    neutral: `Provide a balanced and objective summary of the following AI responses to the question: "${question}".`,
    analytical: `Analyze the following AI responses. Compare their strengths, weaknesses, and points of agreement/disagreement regarding: "${question}".`,
    educational: `Explain the key insights from these AI responses to the question: "${question}" in an informative and easy-to-understand manner.`,
    creative: `Synthesize these AI responses to the question: "${question}" into a creative and engaging narrative or explanation.`,
    'quick-summary': `Provide a very concise bullet-point summary of the main points from these AI responses to: "${question}".`
  }[style] || basePrompt.neutral;

  const roundContext = rounds > 1 ? 
    ` The models have engaged in ${rounds} rounds of discussion, refining their perspectives.` : 
    '';

  const responsesText = modelResponses.map(r => `--- ${r.model} ---\n${r.text}`).join('\n\n');

  return `${basePrompt}${roundContext}\n\n${responsesText}`;
}

// SSE Chat Endpoint
app.post('/api/chat', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const {
    question,
    activeModels = ['gpt', 'claude', 'gemini'],
    rounds = 1,
    moderatorEngine = 'moderator',
    moderatorStyle = 'neutral',
    language = null
  } = req.body;

  // Input validation
  if (!question || question.trim().length === 0) {
    res.write(createSSEMessage('error', { message: 'Question is required' }));
    res.end();
    return;
  }

  if (activeModels.length === 0) {
    res.write(createSSEMessage('error', { message: 'At least one model must be active' }));
    res.end();
    return;
  }

  const requestId = Math.random().toString(36).substring(2, 9);
  console.log(`[${requestId}] New request for: "${question.substring(0, 50)}${question.length > 50 ? '...' : ''}"`);

  // Send session start event
  res.write(createSSEMessage('session_start', { 
    requestId,
    timestamp: new Date().toISOString()
  }));

  let allModelResponses = [];
  const modelMap = {
    gpt: { name: 'GPT', model: OPENAI_CHAT_MODEL, active: activeModels.includes('gpt') },
    claude: { name: 'Claude', model: CLAUDE_MODEL, active: activeModels.includes('claude') },
    gemini: { name: 'Gemini', model: GEMINI_MODEL, active: activeModels.includes('gemini') }
  };

  // Main processing loop for rounds
  try {
    for (let currentRound = 1; currentRound <= rounds; currentRound++) {
      // Send round start event
      if (currentRound > 1) {
        res.write(createSSEMessage('round_complete', { round: currentRound - 1 }));
        res.write(createSSEMessage('round_start', { round: currentRound }));
      }

      const roundPromises = [];
      const roundResponses = [];

      // OpenAI GPT processing
      if (modelMap.gpt.active) {
        roundPromises.push((async () => {
          try {
            const stream = await openai.chat.completions.create({
              model: modelMap.gpt.model,
              messages: [
                {
                  role: 'system',
                  content: currentRound === 1 ? 
                    `Answer the user's question clearly and concisely in ${language || 'the same language as the question'}.` :
                    `Review the previous round responses and provide your analysis. Identify points of agreement/disagreement and refine your answer. Use ${language || 'the same language as the question'}.`
                },
                {
                  role: 'user', 
                  content: currentRound === 1 ? 
                    question : 
                    `Original question: ${question}\n\nPrevious responses:\n${allModelResponses.map(r => `${r.model}: ${r.text}`).join('\n\n')}`
                }
              ],
              stream: true,
              max_tokens: 1024
            });

            let fullResponse = '';
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                res.write(createSSEMessage('model_chunk', { 
                  model: 'gpt', 
                  textChunk: content 
                }));
              }
            }

            roundResponses.push({ model: 'gpt', text: fullResponse });
            res.write(createSSEMessage('model_done', { model: 'gpt' }));

          } catch (error) {
            console.error(`[${requestId}] GPT error:`, error.message);
            res.write(createSSEMessage('error', { 
              model: 'gpt', 
              message: error.message 
            }));
          }
        })());
      }

      // Anthropic Claude processing
      if (modelMap.claude.active) {
        roundPromises.push((async () => {
          try {
            const stream = await anthropic.messages.create({
              model: modelMap.claude.model,
              max_tokens: 1024,
              messages: [{
                role: 'user',
                content: currentRound === 1 ? 
                  question : 
                  `Original question: ${question}\n\nPrevious responses:\n${allModelResponses.map(r => `${r.model}: ${r.text}`).join('\n\n')}\n\nPlease analyze these responses and provide your refined perspective.`
              }],
              stream: true
            });

            let fullResponse = '';
            for await (const chunk of stream) {
              if (chunk.type === 'content_block_delta') {
                const content = chunk.delta.text || '';
                fullResponse += content;
                res.write(createSSEMessage('model_chunk', { 
                  model: 'claude', 
                  textChunk: content 
                }));
              }
            }

            roundResponses.push({ model: 'claude', text: fullResponse });
            res.write(createSSEMessage('model_done', { model: 'claude' }));

          } catch (error) {
            console.error(`[${requestId}] Claude error:`, error.message);
            res.write(createSSEMessage('error', { 
              model: 'claude', 
              message: error.message 
            }));
          }
        })());
      }

      // Google Gemini processing
      if (modelMap.gemini.active) {
        roundPromises.push((async () => {
          try {
            const model = genAI.getGenerativeModel({ model: modelMap.gemini.model });
            const prompt = currentRound === 1 ? 
              question : 
              `Original question: ${question}\n\nPrevious responses:\n${allModelResponses.map(r => `${r.model}: ${r.text}`).join('\n\n')}\n\nPlease analyze these responses and provide your refined perspective.`;

            const result = await model.generateContentStream(prompt);
            let fullResponse = '';

            for await (const chunk of result.stream) {
              const content = chunk.text();
              if (content) {
                fullResponse += content;
                res.write(createSSEMessage('model_chunk', { 
                  model: 'gemini', 
                  textChunk: content 
                }));
              }
            }

            roundResponses.push({ model: 'gemini', text: fullResponse });
            res.write(createSSEMessage('model_done', { model: 'gemini' }));

          } catch (error) {
            console.error(`[${requestId}] Gemini error:`, error.message);
            res.write(createSSEMessage('error', { 
              model: 'gemini', 
              message: error.message 
            }));
          }
        })());
      }

      // Wait for all models to complete this round
      await Promise.allSettled(roundPromises);
      allModelResponses = roundResponses;
    }

    // Moderator phase
    if (allModelResponses.length > 0) {
      res.write(createSSEMessage('round_complete', { round: rounds }));
      
      const moderatorPrompt = getSystemPromptForModerator(
        moderatorStyle, 
        language, 
        rounds, 
        question, 
        allModelResponses
      );

      // Use the selected engine for moderation
      try {
        if (moderatorEngine === 'gpt') {
          const stream = await openai.chat.completions.create({
            model: OPENAI_CHAT_MODEL,
            messages: [
              { role: 'system', content: moderatorPrompt },
              { role: 'user', content: 'Please synthesize the responses.' }
            ],
            stream: true,
            max_tokens: 1024
          });

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              res.write(createSSEMessage('model_chunk', { 
                model: 'moderator', 
                textChunk: content 
              }));
            }
          }
        } 
        // Similar logic for claude and gemini moderator engines would go here
        // For simplicity, using GPT as default moderator if not specified
        else {
          const stream = await openai.chat.completions.create({
            model: OPENAI_CHAT_MODEL,
            messages: [
              { role: 'system', content: moderatorPrompt },
              { role: 'user', content: 'Please provide a comprehensive synthesis.' }
            ],
            stream: true,
            max_tokens: 1024
          });

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              res.write(createSSEMessage('model_chunk', { 
                model: 'moderator', 
                textChunk: content 
              }));
            }
          }
        }

        res.write(createSSEMessage('model_done', { model: 'moderator' }));

      } catch (error) {
        console.error(`[${requestId}] Moderator error:`, error.message);
        res.write(createSSEMessage('error', { 
          model: 'moderator', 
          message: error.message 
        }));
      }
    }

    // Send completion event
    res.write(createSSEMessage('done', { 
      requestId,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    console.error(`[${requestId}] General error:`, error.message);
    res.write(createSSEMessage('error', { 
      message: `Processing error: ${error.message}` 
    }));
  } finally {
    res.end();
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    models: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      google: !!process.env.GOOGLE_AI_API_KEY
    }
  });
});

// Feedback endpoint
app.post('/api/feedback', (req, res) => {
  const { message, timestamp, clientInfo } = req.body;
  
  console.log('Feedback received:', { 
    timestamp, 
    clientInfo,
    message: message.substring(0, 100) + (message.length > 100 ? '...' : '')
  });
  
  res.json({ status: 'received', id: Date.now() });
});

// Stats endpoint (optional)
app.get('/api/stats', (req, res) => {
  res.json({
    requests_processed: 0, // Would track in production
    average_latency: 0,
    success_rate: 1.0
  });
});

app.listen(port, () => {
  console.log(`AI Agora backend running on port ${port}`);
});
