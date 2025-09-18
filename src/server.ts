import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import dotenv from 'dotenv';

// Import database connection and models
import sequelize from './database/connection';
import { migrateDatabase } from './database/migrate';

// Import middleware
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authenticateToken } from './middleware/auth';

// Import routes
import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessions';
import chatRoutes from './routes/chat';
import feedbackRoutes from './routes/feedback';
import usageRoutes from './routes/usage';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: {
    error: {
      message: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      conObject: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'ai_agora_dev',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
      },
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/usage', usageRoutes);

// Protected route example
app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({
    message: 'This is a protected route',
    user: req.user,
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'AI Agora Backend API',
    version: '1.0.0',
    description: 'Express.js backend for AI Agora app with multi-AI chat capabilities',
    endpoints: {
      auth: '/api/auth',
      sessions: '/api/sessions',
      chat: '/api/chat',
      feedback: '/api/feedback',
      usage: '/api/usage',
      health: '/health',
    },
    documentation: 'https://github.com/RealX11/ai-agora-backend',
  });
});

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Database initialization and server startup
const startServer = async () => {
  try {
    console.log('🚀 Starting AI Agora Backend...');
    
    // Initialize database
    console.log('📊 Initializing database...');
    await migrateDatabase();
    console.log('✅ Database initialized successfully');
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🌐 Server running on port ${PORT}`);
      console.log(`📚 API documentation available at http://localhost:${PORT}/api`);
      console.log(`❤️ Health check available at http://localhost:${PORT}/health`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('\n🔧 Development mode active');
        console.log('Environment variables:');
        console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
        console.log(`- DB_HOST: ${process.env.DB_HOST || 'localhost'}`);
        console.log(`- DB_NAME: ${process.env.DB_NAME || 'ai_agora_dev'}`);
        console.log(`- CORS_ORIGIN: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

// Start the server
if (require.main === module) {
  startServer();
}

export default app;