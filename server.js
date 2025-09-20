const express = require('express');
const cors = require('cors');
require('dotenv').config();

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Model Constants (birebir dokümandaki gibi)
const OPENAI_CHAT_MODEL = 'gpt-4o';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GEMINI_MODEL = 'gemini-2.5-pro';

// Initialize API clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Environment variable check
const requiredEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Stats for /api/stats endpoint
let serverStats = {
  totalRequests: 0,
  totalRounds: 0,
  modelUsage: {
    gpt: 0,
    claude: 0,
    gemini: 0,
    moderator: 0
  },
  startTime: new Date().toISOString()
};

// Utility function to detect language
function detectLanguage(text) {
  const turkishWords = ['bir', 'bu', 've', 'için', 'ile', 'de', 'da', 'nedir', 'nasıl', 'neden'];
  const spanishWords = ['un', 'el', 'la', 'es', 'en', 'de', 'que', 'y', 'por', 'para'];
  const frenchWords = ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir'];
  const germanWords = ['der', 'die', 'das', 'und', 'in', 'den', 'von', 'zu', 'mit', 'ist'];

  const words = text.toLowerCase().split(/\s+/);
  
  const turkishCount = words.filter(word => turkishWords.includes(word)).length;
  const spanishCount = words.filter(word => spanishWords.includes(word)).length;
  const frenchCount = words.filter(word => frenchWords.includes(word)).length;
  const germanCount = words.filter(word => germanWords.includes(word)).length;

  if (turkishCount > 0) return 'tr';
  if (spanishCount > 0) return 'es';
  if (frenchCount > 0) return 'fr';
  if (germanCount > 0) return 'de';
  
  return 'en'; // Default to English
}

// Generate system prompt based on language and style
function generateSystemPrompt(language, moderatorStyle, isModeratorTurn = false, previousResponses = null) {
  const languageMap = {
    'en': 'English',
    'tr': 'Turkish',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German'
  };

  const styleInstructions = {
    'neutral': 'Provide a balanced, objective perspective without strong opinions.',
    'analytical': 'Focus on data, facts, and logical analysis. Break down complex topics systematically.',
    'educational': 'Explain concepts clearly as if teaching. Include examples and context.',
    'creative': 'Think outside the box and provide innovative, imaginative perspectives.',
    'quick-summary': 'Be concise and to the point. Summarize key information efficiently.'
  };

  let prompt = `You are an AI assistant responding in ${languageMap[language]}. ${styleInstructions[moderatorStyle]}`;

  if (isModeratorTurn && previousResponses) {
    prompt += `\n\nAs the moderator, you have access to responses from other AI models. Your role is to synthesize their perspectives and provide a comprehensive final answer that incorporates the best insights from each response while maintaining your ${moderatorStyle} style.`;
  }

  return prompt;
}

// AI Model Functions
async function callOpenAI(messages, language, moderatorStyle) {
  try {
    const systemPrompt = generateSystemPrompt(language, moderatorStyle);
    const response = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 1000
    });

    return response;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw error;
  }
}

async function callClaude(messages, language, moderatorStyle) {
  try {
    const systemPrompt = generateSystemPrompt(language, moderatorStyle);
    const userMessage = messages.map(msg => msg.content).join('\n');
    
    const response = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 1000,
      temperature: 0.7
    });

    return response;
  } catch (error) {
    console.error('Claude API Error:', error);
    throw error;
  }
}

async function callGemini(messages, language, moderatorStyle) {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const systemPrompt = generateSystemPrompt(language, moderatorStyle);
    const userMessage = messages.map(msg => msg.content).join('\n');
    const prompt = `${systemPrompt}\n\nUser: ${userMessage}`;

    const response = await model.generateContentStream(prompt);
    return response;
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
}

// Moderator function
async function generateModeratorResponse(previousResponses, userQuestion, language, moderatorStyle, moderatorEngine) {
  const responsesText = previousResponses.map((resp, idx) => 
    `Model ${idx + 1} Response:\n${resp}`
  ).join('\n\n');

  const moderatorPrompt = `Previous AI responses to user question: "${userQuestion}"\n\n${responsesText}\n\nAs a moderator with ${moderatorStyle} style, provide a synthesized final response that incorporates the best insights from all models.`;

  const messages = [{ role: 'user', content: moderatorPrompt }];

  switch (moderatorEngine) {
    case 'gpt':
      return await callOpenAI(messages, language, moderatorStyle);
    case 'claude':
      return await callClaude(messages, language, moderatorStyle);
    case 'gemini':
      return await callGemini(messages, language, moderatorStyle);
    default:
      // Use OpenAI as default moderator
      return await callOpenAI(messages, language, moderatorStyle);
  }
}

// Stream handler for different models
async function streamModelResponse(modelName, stream, res, sendEvent) {
  try {
    if (modelName === 'gpt') {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          sendEvent('message', JSON.stringify({
            model: modelName,
            content: content,
            isComplete: false
          }));
        }
      }
    } else if (modelName === 'claude') {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          sendEvent('message', JSON.stringify({
            model: modelName,
            content: chunk.delta.text,
            isComplete: false
          }));
        }
      }
    } else if (modelName === 'gemini') {
      for await (const chunk of stream.stream) {
        const content = chunk.text();
        if (content) {
          sendEvent('message', JSON.stringify({
            model: modelName,
            content: content,
            isComplete: false
          }));
        }
      }
    }

    // Send completion marker
    sendEvent('message', JSON.stringify({
      model: modelName,
      content: '',
      isComplete: true
    }));

  } catch (error) {
    console.error(`Error streaming ${modelName}:`, error);
    sendEvent('error', JSON.stringify({
      model: modelName,
      error: error.message
    }));
  }
}

// Main chat endpoint with SSE
app.post('/api/chat', async (req, res) => {
  try {
    const { 
      message, 
      activeModels = ['gpt', 'claude', 'gemini'], 
      rounds = 1, 
      moderatorStyle = 'neutral',
      moderatorEngine = 'gpt',
      language 
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    serverStats.totalRequests++;
    serverStats.totalRounds += rounds;

    // Detect language if not provided
    const detectedLanguage = language || detectLanguage(message);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };

    // Track responses for each round
    let allRoundResponses = [];
    
    for (let round = 1; round <= rounds; round++) {
      if (round > 1) {
        sendEvent('round', JSON.stringify({ round, message: `Round ${round} starting...` }));
      }

      const roundResponses = [];
      const modelPromises = [];

      // Prepare messages for this round
      let messages = [{ role: 'user', content: message }];
      
      if (round > 1) {
        // Add previous round responses to context
        const contextMessage = allRoundResponses.map((roundResp, idx) => 
          `Previous Round ${idx + 1} Responses:\n${roundResp.join('\n\n')}`
        ).join('\n\n');
        
        messages.push({ 
          role: 'user', 
          content: `${contextMessage}\n\nPlease provide your updated response considering the above discussions.` 
        });
      }

      // Start model calls
      if (activeModels.includes('gpt')) {
        modelPromises.push(
          (async () => {
            serverStats.modelUsage.gpt++;
            const stream = await callOpenAI(messages, detectedLanguage, moderatorStyle);
            let fullResponse = '';
            
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                sendEvent('message', JSON.stringify({
                  model: 'gpt',
                  content: content,
                  isComplete: false,
                  round
                }));
              }
            }
            
            sendEvent('message', JSON.stringify({
              model: 'gpt',
              content: '',
              isComplete: true,
              round
            }));
            
            roundResponses.push(`GPT: ${fullResponse}`);
          })()
        );
      }

      if (activeModels.includes('claude')) {
        modelPromises.push(
          (async () => {
            serverStats.modelUsage.claude++;
            const stream = await callClaude(messages, detectedLanguage, moderatorStyle);
            let fullResponse = '';
            
            for await (const chunk of stream) {
              if (chunk.type === 'content_block_delta') {
                const content = chunk.delta.text;
                fullResponse += content;
                sendEvent('message', JSON.stringify({
                  model: 'claude',
                  content: content,
                  isComplete: false,
                  round
                }));
              }
            }
            
            sendEvent('message', JSON.stringify({
              model: 'claude',
              content: '',
              isComplete: true,
              round
            }));
            
            roundResponses.push(`Claude: ${fullResponse}`);
          })()
        );
      }

      if (activeModels.includes('gemini')) {
        modelPromises.push(
          (async () => {
            serverStats.modelUsage.gemini++;
            const stream = await callGemini(messages, detectedLanguage, moderatorStyle);
            let fullResponse = '';
            
            for await (const chunk of stream.stream) {
              const content = chunk.text();
              if (content) {
                fullResponse += content;
                sendEvent('message', JSON.stringify({
                  model: 'gemini',
                  content: content,
                  isComplete: false,
                  round
                }));
              }
            }
            
            sendEvent('message', JSON.stringify({
              model: 'gemini',
              content: '',
              isComplete: true,
              round
            }));
            
            roundResponses.push(`Gemini: ${fullResponse}`);
          })()
        );
      }

      // Wait for all models to complete this round
      await Promise.allSettled(modelPromises);
      allRoundResponses.push(roundResponses);
    }

    // Generate moderator response
    if (allRoundResponses.length > 0) {
      serverStats.modelUsage.moderator++;
      sendEvent('moderator', JSON.stringify({ message: 'Moderator analysis starting...' }));
      
      const flatResponses = allRoundResponses.flat();
      const moderatorStream = await generateModeratorResponse(
        flatResponses, 
        message, 
        detectedLanguage, 
        moderatorStyle, 
        moderatorEngine
      );

      let fullModeratorResponse = '';
      
      if (moderatorEngine === 'gpt' || moderatorEngine === 'moderator') {
        for await (const chunk of moderatorStream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            fullModeratorResponse += content;
            sendEvent('message', JSON.stringify({
              model: 'moderator',
              content: content,
              isComplete: false
            }));
          }
        }
      } else if (moderatorEngine === 'claude') {
        for await (const chunk of moderatorStream) {
          if (chunk.type === 'content_block_delta') {
            const content = chunk.delta.text;
            fullModeratorResponse += content;
            sendEvent('message', JSON.stringify({
              model: 'moderator',
              content: content,
              isComplete: false
            }));
          }
        }
      } else if (moderatorEngine === 'gemini') {
        for await (const chunk of moderatorStream.stream) {
          const content = chunk.text();
          if (content) {
            fullModeratorResponse += content;
            sendEvent('message', JSON.stringify({
              model: 'moderator',
              content: content,
              isComplete: false
            }));
          }
        }
      }

      sendEvent('message', JSON.stringify({
        model: 'moderator',
        content: '',
        isComplete: true
      }));
    }

    sendEvent('complete', JSON.stringify({ message: 'Conversation complete' }));
    res.end();

  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    ...serverStats,
    uptime: process.uptime(),
    currentTime: new Date().toISOString()
  });
});

// Feedback endpoint
app.post('/api/feedback', (req, res) => {
  try {
    const { feedback, userInfo, timestamp } = req.body;
    
    // Log feedback (in production, save to database)
    console.log('Feedback received:', {
      feedback,
      userInfo,
      timestamp: timestamp || new Date().toISOString()
    });

    res.json({ 
      success: true, 
      message: 'Feedback received successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Feedback endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process feedback' 
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'POST /api/chat',
      'GET /health',
      'GET /api/stats',
      'POST /api/feedback'
    ]
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`AI Agora Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('Available models:', { OPENAI_CHAT_MODEL, CLAUDE_MODEL, GEMINI_MODEL });
});

module.exports = app;
