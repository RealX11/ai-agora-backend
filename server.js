const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize AI clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to detect language
function detectLanguage(text) {
  const turkishWords = ['ve', 'bir', 'bu', 'da', 'de', 'ile', 'için', 'var', 'olan', 'çok', 'daha', 'en', 'şey', 'gibi', 'sonra'];
  const englishWords = ['the', 'and', 'is', 'a', 'to', 'in', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as', 'with'];
  const spanishWords = ['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da'];
  const frenchWords = ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son'];
  const germanWords = ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im'];
  const arabicWords = ['في', 'من', 'إلى', 'على', 'أن', 'هذا', 'هذه', 'كان', 'التي', 'الذي', 'ما', 'لا', 'أو', 'كل'];

  const lowercaseText = text.toLowerCase();
  
  const scores = {
    tr: turkishWords.filter(word => lowercaseText.includes(word)).length,
    en: englishWords.filter(word => lowercaseText.includes(word)).length,
    es: spanishWords.filter(word => lowercaseText.includes(word)).length,
    fr: frenchWords.filter(word => lowercaseText.includes(word)).length,
    de: germanWords.filter(word => lowercaseText.includes(word)).length,
    ar: arabicWords.filter(word => text.includes(word)).length
  };
  
  return Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'AI Agora Backend is running',
    timestamp: new Date().toISOString(),
    apis: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      google: !!process.env.GOOGLE_AI_API_KEY
    }
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { question, language, settings, conversation = [], moderatorStyle = 'neutral' } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log('Chat request:', { question, language, moderatorStyle });

    // Detect language if not provided
    const detectedLang = language || detectLanguage(question);
    
    // Build conversation context
    const conversationHistory = conversation.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }));

    // Language instruction for AI responses
    const languageInstruction = {
      tr: 'Türkçe',
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      ar: 'Arabic'
    }[detectedLang] || 'English';

    // Prepare responses from all AIs
    const aiPromises = [];

    // GPT-4 Response
    aiPromises.push(
      openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { 
            role: "system", 
            content: `You are ChatGPT, a helpful AI assistant created by OpenAI. Respond naturally and informatively in ${languageInstruction}. Keep responses concise but informative.`
          },
          ...conversationHistory.slice(-6), // Keep last 6 messages for context
          { role: "user", content: question }
        ],
        max_tokens: 400,
        temperature: 0.7,
      }).catch(error => ({ error: `GPT Error: ${error.message}` }))
    );

    // Claude Response
    aiPromises.push(
      anthropic.messages.create({
        model: "claude-3-sonnet-20240229",
        max_tokens: 400,
        system: `You are Claude, an AI assistant created by Anthropic. Be helpful, harmless, and honest. Respond in ${languageInstruction}. Keep responses concise but thorough.`,
        messages: [
          ...conversationHistory.slice(-6).filter(msg => msg.role !== 'system'),
          { role: "user", content: question }
        ],
      }).catch(error => ({ error: `Claude Error: ${error.message}` }))
    );

    // Gemini Response
    aiPromises.push(
      (async () => {
        try {
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          
          // Build conversation for Gemini
          const geminiHistory = conversationHistory.slice(-6).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
          }));
          
          const chat = model.startChat({
            history: geminiHistory,
            generationConfig: {
              maxOutputTokens: 400,
              temperature: 0.7,
            },
          });

          const result = await chat.sendMessage(`Please respond in ${languageInstruction}: ${question}`);
          return result;
        } catch (error) {
          return { error: `Gemini Error: ${error.message}` };
        }
      })()
    );

    // Wait for all AI responses
    const responses = await Promise.allSettled(aiPromises);

    // Process responses
    const aiResponses = {
      gpt: 'GPT response unavailable',
      claude: 'Claude response unavailable', 
      gemini: 'Gemini response unavailable'
    };

    // GPT Response
    if (responses[0].status === 'fulfilled' && !responses[0].value.error) {
      aiResponses.gpt = responses[0].value.choices?.[0]?.message?.content || 'GPT response error';
    } else if (responses[0].value?.error) {
      aiResponses.gpt = responses[0].value.error;
    }

    // Claude Response  
    if (responses[1].status === 'fulfilled' && !responses[1].value.error) {
      aiResponses.claude = responses[1].value.content?.[0]?.text || 'Claude response error';
    } else if (responses[1].value?.error) {
      aiResponses.claude = responses[1].value.error;
    }

    // Gemini Response
    if (responses[2].status === 'fulfilled' && !responses[2].value.error) {
      aiResponses.gemini = responses[2].value.response?.text() || 'Gemini response error';
    } else if (responses[2].value?.error) {
      aiResponses.gemini = responses[2].value.error;
    }

    // Generate moderator response based on style
    const moderatorPrompts = {
      neutral: `You are a neutral moderator. Summarize the key points from the AI responses objectively in ${languageInstruction}.`,
      analytical: `You are an analytical moderator. Compare and analyze the different AI perspectives, highlighting strengths and differences in ${languageInstruction}.`,
      educational: `You are an educational moderator. Explain the topic in a teaching manner, drawing from all AI responses in ${languageInstruction}.`,
      creative: `You are a creative moderator. Present the information in an engaging, storytelling manner in ${languageInstruction}.`
    };

    const moderatorPrompt = moderatorPrompts[moderatorStyle] || moderatorPrompts.neutral;

    try {
      const moderatorResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: moderatorPrompt },
          { role: "user", content: `User asked: "${question}"\n\nAI Responses:\nGPT: ${aiResponses.gpt}\nClaude: ${aiResponses.claude}\nGemini: ${aiResponses.gemini}\n\nPlease provide a moderator response that synthesizes these perspectives.` }
        ],
        max_tokens: 300,
        temperature: 0.8,
      });

      const moderatorText = moderatorResponse.choices[0].message.content;
      
      res.json({
        success: true,
        detectedLanguage: detectedLang,
        responses: {
          gpt: aiResponses.gpt,
          claude: aiResponses.claude,
          gemini: aiResponses.gemini,
          moderator: moderatorText
        }
      });
    } catch (moderatorError) {
      // If moderator fails, still return AI responses
      res.json({
        success: true,
        detectedLanguage: detectedLang,
        responses: {
          gpt: aiResponses.gpt,
          claude: aiResponses.claude,
          gemini: aiResponses.gemini,
          moderator: `Moderator response unavailable: ${moderatorError.message}`
        }
      });
    }

  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      success: false
    });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedback, deviceId, appVersion, rating, timestamp } = req.body;
    
    // Log feedback (in production, save to database)
    const feedbackData = {
      feedback,
      deviceId,
      appVersion,
      rating,
      timestamp: timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString()
    };
    
    console.log('Feedback received:', feedbackData);
    
    res.json({ 
      success: true, 
      message: 'Thank you for your feedback! We appreciate your input.',
      id: Date.now().toString() // Simple ID generation
    });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ 
      error: 'Failed to save feedback',
      success: false
    });
  }
});

// Usage stats endpoint (for monitoring)
app.get('/api/stats', (req, res) => {
  res.json({
    status: 'active',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    available_endpoints: ['/health', '/api/chat', '/api/feedback', '/api/stats']
  });
});

app.listen(PORT, () => {
  console.log(`🚀 AI Agora Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Chat API: http://localhost:${PORT}/api/chat`);
  console.log('🔑 API Keys loaded:', {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google: !!process.env.GOOGLE_AI_API_KEY
  });
});
