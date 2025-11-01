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
    const messages = [];
    
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    messages.push({
      role: 'user',
      content: prompt
    });
    
    const response = await openai.chat.completions.create({
      model: AI_MODELS.GPT,
      messages: messages,
      max_tokens: 1024
    });
    
    return response.choices[0].message.content;
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

// Build prompt based on round number and context
function buildPrompt(question, roundNumber, context) {
  if (roundNumber === 1) {
    // First round - only see the question
    return question;
  } else {
    // Subsequent rounds - see other AIs' previous responses
    let prompt = `Original Question: ${question}\n\n`;
    
    if (context && context.length > 0) {
      prompt += `Other AI perspectives from previous rounds:\n`;
      context.forEach((response, index) => {
        prompt += `\nPerspective ${index + 1}:\n${response}\n`;
      });
      prompt += `\nNow provide your analysis, considering these other perspectives:\n`;
    }
    
    return prompt;
  }
}

// Build system prompt based on round
function getSystemPrompt(roundNumber) {
  if (roundNumber === 1) {
    return "You are participating in a multi-AI debate. Provide a concise, clear answer to the question. Be direct and informative.";
  } else if (roundNumber === 2) {
    return "You are in round 2 of a multi-AI debate. You can now see other AIs' responses. Analyze their perspectives and provide your enhanced viewpoint. You may agree, disagree, or add new insights. Be analytical but also engaging.";
  } else {
    return "You are in the final round of a multi-AI debate. Synthesize the discussion so far and provide your most comprehensive and well-reasoned response. Build on the collective insights.";
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

// Main chat endpoint - handles multi-AI responses
app.post('/api/chat', async (req, res) => {
  try {
    const { question, providers, roundNumber, context } = req.body;
    
    if (!question || !providers || !roundNumber) {
      return res.status(400).json({ 
        error: 'Missing required fields: question, providers, roundNumber' 
      });
    }
    
    const systemPrompt = getSystemPrompt(roundNumber);
    const responses = {};
    
    // Call all AIs in parallel
    const promises = providers.map(async (provider) => {
      const aiFunction = getAIFunction(provider);
      
      if (!aiFunction) {
        throw new Error(`Unknown provider: ${provider}`);
      }
      
      // Get context for this specific provider (excluding its own previous responses)
      const providerContext = context && context[provider] ? [] : (context ? Object.values(context).flat() : []);
      const prompt = buildPrompt(question, roundNumber, providerContext);
      
      const response = await aiFunction(prompt, systemPrompt);
      responses[provider] = response;
    });
    
    await Promise.all(promises);
    
    res.json({ responses });
    
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message 
    });
  }
});

// Moderator endpoint - summarizes all AI responses
app.post('/api/moderate', async (req, res) => {
  try {
    const { question, responses, moderator, roundNumber } = req.body;
    
    if (!question || !responses || !moderator || !roundNumber) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }
    
    // Build moderator prompt
    let moderatorPrompt = `You are the moderator of an AI debate. Round ${roundNumber} has concluded.\n\n`;
    moderatorPrompt += `Original Question: ${question}\n\n`;
    moderatorPrompt += `AI Responses:\n`;
    
    for (const [provider, responseList] of Object.entries(responses)) {
      moderatorPrompt += `\n${provider}:\n`;
      responseList.forEach((response, index) => {
        moderatorPrompt += `Round ${index + 1}: ${response}\n`;
      });
    }
    
    moderatorPrompt += `\n\nAs the moderator, provide a concise summary that:\n`;
    
    if (roundNumber === 1) {
      moderatorPrompt += `- Identifies the most logical and well-reasoned answer\n`;
      moderatorPrompt += `- Notes key agreements or disagreements\n`;
      moderatorPrompt += `- Keeps it brief (2-3 sentences)`;
    } else if (roundNumber === 2) {
      moderatorPrompt += `- Analyzes how perspectives evolved across both rounds\n`;
      moderatorPrompt += `- Identifies which AI provided the most coherent argument\n`;
      moderatorPrompt += `- Summarizes key insights (3-4 sentences)`;
    } else {
      moderatorPrompt += `- Reviews all rounds comprehensively\n`;
      moderatorPrompt += `- Determines the most accurate and consistent answer\n`;
      moderatorPrompt += `- Provides a definitive conclusion (4-5 sentences)`;
    }
    
    const aiFunction = getAIFunction(moderator);
    const summary = await aiFunction(
      moderatorPrompt, 
      "You are an impartial moderator analyzing an AI debate. Be concise, analytical, and fair."
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

