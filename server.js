const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'AI Agora Backend is running' });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { question, language, settings } = req.body;
    
    // Bu kısım AI API'ları için placeholder
    res.json({
      success: true,
      responses: {
        gpt: `GPT response to: ${question}`,
        claude: `Claude response to: ${question}`, 
        gemini: `Gemini response to: ${question}`,
        moderator: `Moderator summary for: ${question}`
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedback, deviceId, appVersion } = req.body;
    
    // Bu kısım database için placeholder
    console.log('Feedback received:', { feedback, deviceId, appVersion });
    
    res.json({ success: true, message: 'Feedback saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
