# 🧠 AI Agora Backend

Backend API for AI Agora - A platform where GPT, Claude, and Gemini debate questions through multiple rounds.

## 🚀 Quick Start

### Prerequisites

- Node.js 18.20.8 or higher
- npm 9.0.0 or higher
- API keys for Anthropic, Google AI, and OpenAI

### Installation

```bash
cd backend
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Add your API keys to `.env`:
```env
ANTHROPIC_API_KEY=your_key_here
GOOGLE_AI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

### Running Locally

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

Server will start on `http://localhost:3000`

## 📡 API Endpoints

### Health Check
```
GET /api/health
```

Returns server status and available models.

### Chat (Multi-AI Response)
```
POST /api/chat
```

**Request Body:**
```json
{
  "question": "What is artificial intelligence?",
  "providers": ["GPT", "Claude", "Gemini"],
  "roundNumber": 1,
  "context": {}
}
```

**Response:**
```json
{
  "responses": {
    "GPT": "AI is the simulation of human intelligence...",
    "Claude": "Artificial intelligence refers to...",
    "Gemini": "AI encompasses machine learning..."
  }
}
```

### Moderate (Get Summary)
```
POST /api/moderate
```

**Request Body:**
```json
{
  "question": "What is AI?",
  "responses": {
    "GPT": ["response from round 1", "response from round 2"],
    "Claude": ["response from round 1"],
    "Gemini": ["response from round 1"]
  },
  "moderator": "Claude",
  "roundNumber": 2
}
```

**Response:**
```json
{
  "summary": "The moderator's analysis of all responses..."
}
```

### Feedback
```
POST /api/feedback
```

**Request Body:**
```json
{
  "feedback": "Great app! Would love to see...",
  "timestamp": 1699999999999
}
```

### Get All Feedback (Admin)
```
GET /api/feedback
```

Returns all user feedback stored in `feedback.json`.

## 🤖 AI Models Used

| Provider | Model | API Docs |
|----------|-------|----------|
| Anthropic | `claude-3-5-haiku-20241022` | [docs.anthropic.com](https://docs.anthropic.com) |
| Google AI | `gemini-2.0-flash-exp` | [ai.google.dev](https://ai.google.dev) |
| OpenAI | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com) |

## 🚂 Railway Deployment

### Setup

1. Create a new project on [Railway.app](https://railway.app)

2. Connect your GitHub repository:
   - Go to Railway dashboard
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `ai-agora-backend` repository

3. Add environment variables in Railway dashboard:
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_AI_API_KEY`
   - `OPENAI_API_KEY`
   - `NODE_ENV=production`

4. Railway will automatically:
   - Detect Node.js project
   - Run `npm install`
   - Execute `npm start`
   - Provide a public URL (e.g., `https://ai-agora-backend.up.railway.app`)

### Auto-Deploy

Every push to your GitHub repository will automatically trigger a new deployment on Railway.

### Monitoring

Check your Railway dashboard for:
- Deployment logs
- API usage
- Error tracking
- Performance metrics

## 📁 Project Structure

```
backend/
├── server.js           # Main Express server
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variables template
├── .gitignore          # Git ignore rules
├── feedback.json       # User feedback storage (auto-generated)
└── README.md          # This file
```

## 🔒 Security Notes

- Never commit `.env` file
- Keep API keys secure
- Add authentication for admin endpoints in production
- Consider rate limiting for public API

## 🧪 Testing

Test the API with curl:

```bash
# Health check
curl http://localhost:3000/api/health

# Send a question
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is AI?",
    "providers": ["GPT", "Claude", "Gemini"],
    "roundNumber": 1,
    "context": {}
  }'
```

## 📝 License

MIT

## 👥 Support

For issues or questions:
- Email: x11aiagent@gmail.com
- GitHub Issues: [Create an issue](https://github.com/yourusername/ai-agora-backend/issues)

---

Built with ❤️ for AI Agora

