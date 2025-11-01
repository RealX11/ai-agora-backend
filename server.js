require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

// AI SDK imports
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize AI clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AI Model configurations
const AI_MODELS = {
  GPT: 'gpt-5-mini-2025-08-07',
  Claude: 'claude-haiku-4-5-20251001',
  Gemini: 'gemini-2.5-flash'
};

// Serious topic detection (inspired by old app)
function detectSeriousTopic(prompt) {
  const seriousKeywords = [
    // Health
    'hasta', 'hastalık', 'ağrı', 'kanser', 'kalp', 'depresyon', 'ilaç', 'doktor', 'acil',
    'sick', 'disease', 'pain', 'cancer', 'heart', 'depression', 'medicine', 'doctor', 'emergency',
    // Legal/Financial
    'boşanma', 'dava', 'mahkeme', 'iflas', 'borç', 'avukat', 'hukuki',
    'divorce', 'lawsuit', 'court', 'bankruptcy', 'debt', 'lawyer', 'legal',
    // Crisis
    'intihar', 'şiddet', 'yardım edin', 'kriz', 'ölüm', 'vefat',
    'suicide', 'violence', 'help me', 'crisis', 'death', 'died'
  ];
  
  const lowerPrompt = prompt.toLowerCase();
  return seriousKeywords.some(keyword => lowerPrompt.includes(keyword));
}

// Helper function to call Claude
async function callClaude(prompt, systemPrompt = '') {
  try {
    const response = await anthropic.messages.create({
      model: AI_MODELS.Claude,
      max_tokens: 1024,
      system: systemPrompt || undefined,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });
    
    return response.content[0].text;
  } catch (error) {
    console.error('Claude API Error:', error);
    throw new Error(`Claude API failed: ${error.message}`);
  }
}

// Helper function to call Gemini
async function callGemini(prompt, systemPrompt = '') {
  try {
    const model = genAI.getGenerativeModel({ 
      model: AI_MODELS.Gemini,
      systemInstruction: systemPrompt || undefined
    });
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw new Error(`Gemini API failed: ${error.message}`);
  }
}

// Helper function to call GPT
async function callGPT(prompt, systemPrompt = '') {
  try {
    let input = prompt;
    
    // If system prompt exists, prepend it to the input
    if (systemPrompt) {
      input = `${systemPrompt}\n\n${prompt}`;
    }
    
    const response = await openai.responses.create({
      model: AI_MODELS.GPT,
      input: input
    });
    
    return response.output_text;
  } catch (error) {
    console.error('GPT API Error:', error);
    throw new Error(`GPT API failed: ${error.message}`);
  }
}

// Route to get AI provider function
function getAIFunction(provider) {
  const functions = {
    'GPT': callGPT,
    'Claude': callClaude,
    'Gemini': callGemini
  };
  
  return functions[provider];
}

// Build prompt based on round number and context (inspired by old app)
function buildPrompt(question, roundNumber, context, isSerious = false) {
  if (roundNumber === 1) {
    // First round - only see the question
    const instruction = isSerious 
      ? "\n\n[ROUND 1 INSTRUCTION]: This appears to be a serious topic. Provide direct, helpful, and empathetic responses without playful elements."
      : "\n\n[ROUND 1 INSTRUCTION]: Provide a short and concise answer.";
    return question + instruction;
  } else if (roundNumber === 2) {
    // Round 2 - see other AIs' responses WITH NAMES, be witty and reference them
    let prompt = `${question}\n\n`;
    
    if (context && context.length > 0) {
      prompt += `Other AIs' responses:\n\n`;
      context.forEach((response) => {
        prompt += `${response}\n\n`;
      });
      
      if (isSerious) {
        prompt += `[ROUND 2 INSTRUCTION]: Reference other AIs' responses professionally. Be thorough, supportive, and provide helpful information. Provide a clear and fluent explanation without writing too long.`;
      } else {
        prompt += `[ROUND 2 INSTRUCTION]: This is the second round. Reference other AIs' responses (not your own!) with brief, playful references. IGNORE YOUR OWN PREVIOUS RESPONSE - act as if you never wrote it. Only mention other AIs (GPT, Claude, Gemini). Be witty and make the reader smile! Use phrases like "While [Name] suggests...", "I find [Name]'s point amusing because...", "[Name] makes a fair point, but...". Provide a clear and fluent explanation without writing too long.`;
      }
    }
    
    return prompt;
  } else {
    // Round 3 - comprehensive synthesis
    let prompt = `${question}\n\n`;
    
    if (context && context.length > 0) {
      prompt += `Other AIs' previous responses:\n\n`;
      context.forEach((response) => {
        prompt += `${response}\n\n`;
      });
      
      if (isSerious) {
        prompt += `[ROUND 3 - COMPREHENSIVE ANALYSIS]: Provide a thorough, professional analysis of other AIs' responses. Focus on practical solutions and actionable advice.`;
      } else {
        prompt += `[ROUND 3 - SERIOUS ANALYSIS]: Alright, let's get serious. If you requested three rounds, you must be serious about this topic! 😏 Analyze other AIs' previous responses, start with a clever quip but then dive deep. Provide practical solutions, real data, concrete suggestions. Be both entertaining and informative - but this time deliver genuinely useful results! Up to 400 words allowed.`;
      }
    }
    
    return prompt;
  }
}

// Build system prompt based on round with word limits (inspired by old app)
function getSystemPrompt(roundNumber) {
  if (roundNumber === 1) {
    return "Provide a short and concise answer. STRICT WORD LIMIT ENFORCEMENT. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If question is in Turkish, answer in Turkish. If in English, answer in English.";
  } else if (roundNumber === 2) {
    return "Provide a clear and fluent explanation without writing too long. Be witty and entertaining while staying analytical. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If question is in Turkish, answer in Turkish. If in English, answer in English.";
  } else {
    return "Provide comprehensive analysis. Up to 400 words allowed. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If question is in Turkish, answer in Turkish. If in English, answer in English.";
  }
}

// ROUTES

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    models: AI_MODELS
  });
});

// Main chat endpoint - SSE streaming for real-time responses
app.post('/api/chat', async (req, res) => {
  try {
    const { question, providers, roundNumber, context } = req.body;
    
    if (!question || !providers || !roundNumber) {
      return res.status(400).json({ 
        error: 'Missing required fields: question, providers, roundNumber' 
      });
    }
    
    // Detect if topic is serious
    const isSerious = detectSeriousTopic(question);
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // Helper to send SSE events
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // Send round start event
    sendEvent('round', { round: roundNumber });
    
    const systemPrompt = getSystemPrompt(roundNumber);
    
    // Process each AI sequentially for better streaming experience
    for (const provider of providers) {
      try {
        const aiFunction = getAIFunction(provider);
        
        if (!aiFunction) {
          sendEvent('provider_error', { 
            model: provider, 
            round: roundNumber,
            message: `Unknown provider: ${provider}` 
          });
          continue;
        }
        
        // Get context for this specific provider
        const providerContext = context && context[provider] ? [] : (context ? Object.values(context).flat() : []);
        const prompt = buildPrompt(question, roundNumber, providerContext, isSerious);
        
        // Get AI response
        const response = await aiFunction(prompt, systemPrompt);
        
        // Stream the complete message (chunk by chunk in future)
        sendEvent('message', {
          model: provider,
          round: roundNumber,
          text: response
        });
        
      } catch (error) {
        console.error(`Error with ${provider}:`, error);
        sendEvent('provider_error', { 
          model: provider, 
          round: roundNumber,
          message: error.message 
        });
      }
    }
    
    // Send completion event
    sendEvent('complete', { round: roundNumber });
    
    res.end();
    
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
    res.end();
  }
});

// Moderator endpoint - summarizes all AI responses
app.post('/api/moderate', async (req, res) => {
  try {
    const { question, responses, moderator, roundNumber, totalRounds } = req.body;
    
    if (!question || !responses || !moderator || !roundNumber || !totalRounds) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }
    
    // Build moderator prompt
    let moderatorPrompt = `You are the moderator of an AI debate. All ${totalRounds} rounds have concluded.\n\n`;
    moderatorPrompt += `Original Question: ${question}\n\n`;
    moderatorPrompt += `AI Responses across all rounds:\n`;
    
    for (const [provider, responseList] of Object.entries(responses)) {
      moderatorPrompt += `\n${provider}:\n`;
      responseList.forEach((response, index) => {
        moderatorPrompt += `Round ${index + 1}: ${response}\n`;
      });
    }
    
    moderatorPrompt += `\n\nAs the moderator, after reviewing ALL ${totalRounds} rounds, provide a comprehensive summary that:\n`;
    
    if (totalRounds === 1) {
      moderatorPrompt += `- Identifies the most logical and well-reasoned answer\n`;
      moderatorPrompt += `- Notes key agreements or disagreements\n`;
      moderatorPrompt += `- Keeps it brief (2-3 sentences)`;
    } else if (totalRounds === 2) {
      moderatorPrompt += `- Analyzes how perspectives evolved across both rounds\n`;
      moderatorPrompt += `- Identifies which AI provided the most coherent argument across both rounds\n`;
      moderatorPrompt += `- Summarizes key insights (3-4 sentences)`;
    } else {
      moderatorPrompt += `- Reviews all three rounds comprehensively\n`;
      moderatorPrompt += `- Determines the most accurate and consistent answer across all rounds\n`;
      moderatorPrompt += `- Provides a definitive conclusion (4-5 sentences)`;
    }
    
    const aiFunction = getAIFunction(moderator);
    const summary = await aiFunction(
      moderatorPrompt, 
      "You are an impartial moderator analyzing an AI debate. Be concise, analytical, and fair. IMPORTANT: Respond in the SAME LANGUAGE as the AI responses you are analyzing. If the AIs responded in Turkish, you must respond in Turkish. If they responded in Spanish, respond in Spanish. Match the language of the debate."
    );
    
    res.json({ summary });
    
  } catch (error) {
    console.error('Moderate endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to generate moderator summary',
      details: error.message 
    });
  }
});

// Feedback endpoint - save user feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedback, timestamp } = req.body;
    
    if (!feedback) {
      return res.status(400).json({ error: 'Feedback text is required' });
    }
    
    const feedbackEntry = {
      id: Date.now().toString(),
      feedback,
      timestamp: timestamp || Date.now(),
      date: new Date().toISOString()
    };
    
    // Read existing feedback
    const feedbackPath = path.join(__dirname, 'feedback.json');
    let feedbackList = [];
    
    try {
      const data = await fs.readFile(feedbackPath, 'utf8');
      feedbackList = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start with empty array
      feedbackList = [];
    }
    
    // Add new feedback
    feedbackList.push(feedbackEntry);
    
    // Save back to file
    await fs.writeFile(
      feedbackPath, 
      JSON.stringify(feedbackList, null, 2)
    );
    
    res.json({ 
      success: true, 
      message: 'Feedback received',
      id: feedbackEntry.id
    });
    
  } catch (error) {
    console.error('Feedback endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to save feedback',
      details: error.message 
    });
  }
});

// Get all feedback (admin endpoint - should be protected in production)
app.get('/api/feedback', async (req, res) => {
  try {
    const feedbackPath = path.join(__dirname, 'feedback.json');
    
    try {
      const data = await fs.readFile(feedbackPath, 'utf8');
      const feedbackList = JSON.parse(data);
      res.json({ feedback: feedbackList, count: feedbackList.length });
    } catch (error) {
      res.json({ feedback: [], count: 0 });
    }
    
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve feedback',
      details: error.message 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: error.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Agora Backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🤖 Models: GPT (${AI_MODELS.GPT}), Claude (${AI_MODELS.Claude}), Gemini (${AI_MODELS.Gemini})`);
});

