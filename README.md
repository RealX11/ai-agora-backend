# AI Agora Backend

A comprehensive Express.js backend for the AI Agora application, featuring multi-AI chat capabilities with OpenAI, Anthropic, and Google AI integration, PostgreSQL database, user feedback system, usage tracking, and session management.

## Features

- 🤖 **Multi-AI Integration**: Support for OpenAI, Anthropic Claude, and Google AI
- 🗄️ **PostgreSQL Database**: Robust data persistence with Sequelize ORM
- 🔐 **Authentication & Authorization**: JWT-based authentication system
- 💬 **Session Management**: Organize conversations in sessions
- 📊 **Usage Tracking**: Monitor API usage and costs across providers
- ⭐ **Feedback System**: User rating and feedback collection
- 🛡️ **Security**: Rate limiting, CORS, helmet security headers
- 📝 **Validation**: Comprehensive input validation with express-validator
- 🚀 **TypeScript**: Full TypeScript support for type safety

## Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL with Sequelize ORM
- **Authentication**: JWT tokens
- **Validation**: express-validator
- **Security**: Helmet, CORS, Rate limiting
- **AI Providers**: OpenAI, Anthropic, Google AI

## Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/RealX11/ai-agora-backend.git
cd ai-agora-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Set up the database:
```bash
# Create PostgreSQL database
createdb ai_agora_dev

# Run migrations
npm run migrate
```

5. Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3000` by default.

## Environment Configuration

Create a `.env` file based on `.env.example`:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_agora_dev
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_SSL=false

# Authentication
SESSION_SECRET=your_session_secret_key_here
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=24h

# AI Provider API Keys
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=http://localhost:3000
```

## API Documentation

### Base URL
```
http://localhost:3000/api
```

### Authentication

Most endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

### Endpoints

#### Authentication (`/api/auth`)
- `POST /register` - Register new user
- `POST /login` - User login
- `GET /profile` - Get user profile (requires auth)

#### Sessions (`/api/sessions`)
- `POST /` - Create new chat session
- `GET /` - Get user sessions
- `GET /:sessionId` - Get session with messages
- `PUT /:sessionId` - Update session
- `DELETE /:sessionId` - Delete session

#### Chat (`/api/chat`)
- `POST /` - Send message to AI
- `GET /history/:sessionId` - Get conversation history
- `GET /models/:provider` - Get available models for AI provider

#### Feedback (`/api/feedback`)
- `POST /` - Submit message feedback
- `GET /message/:messageId` - Get feedback for message
- `GET /history` - Get user feedback history
- `DELETE /:feedbackId` - Delete feedback
- `GET /stats` - Get feedback statistics

#### Usage (`/api/usage`)
- `GET /` - Get usage metrics
- `GET /summary` - Get usage summary
- `GET /timeline` - Get usage timeline
- `GET /models` - Get usage by model

#### Health
- `GET /health` - Health check endpoint

### Example Requests

#### Register User
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "username",
    "password": "password123"
  }'
```

#### Send Chat Message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "message": "Hello, how are you?",
    "sessionId": "session-uuid",
    "aiProvider": "openai",
    "model": "gpt-3.5-turbo"
  }'
```

## Database Schema

The application uses the following main tables:

- **users**: User accounts and authentication
- **sessions**: Chat session organization  
- **messages**: Individual chat messages
- **feedback**: User ratings and feedback
- **usage_metrics**: API usage and cost tracking

## Development

### Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build TypeScript to JavaScript
npm start           # Start production server
npm run migrate     # Run database migrations
npm test            # Run tests
npm run lint        # Run ESLint
npm run lint:fix    # Fix ESLint issues
```

### Project Structure

```
src/
├── database/           # Database configuration and migrations
├── middleware/         # Express middleware (auth, validation, errors)
├── models/            # Sequelize database models
├── routes/            # API route handlers
├── services/          # External service integrations (AI providers)
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── server.ts          # Main application entry point
```

## Security Considerations

- All API keys should be kept secure and never committed to version control
- Use strong, unique secrets for JWT and session signing
- Enable SSL/HTTPS in production
- Configure proper CORS origins for your frontend
- Regularly update dependencies for security patches
- Monitor usage to detect unusual patterns

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For questions or support, please open an issue on the GitHub repository.
