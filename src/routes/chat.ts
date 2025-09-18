import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { Session, Message, UsageMetrics } from '../models';
import { OpenAIService, AnthropicService, GoogleAIService } from '../services/aiServices';
import { authenticateToken } from '../middleware/auth';
import { validateChatMessage } from '../middleware/validation';
import { createApiError } from '../middleware/errorHandler';

const router = Router();

// Initialize AI services
const openaiService = new OpenAIService(process.env.OPENAI_API_KEY || '');
const anthropicService = new AnthropicService(process.env.ANTHROPIC_API_KEY || '');
const googleService = new GoogleAIService(process.env.GOOGLE_AI_API_KEY || '');

// All chat routes require authentication
router.use(authenticateToken);

// Send message to AI
router.post('/', validateChatMessage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { message, sessionId, aiProvider, model } = req.body;
    const userId = req.user.id;

    // Verify session belongs to user
    const session = await Session.findOne({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw createApiError('Session not found', 404, 'SESSION_NOT_FOUND');
    }

    if (!session.isActive) {
      throw createApiError('Session is not active', 400, 'SESSION_INACTIVE');
    }

    // Save user message
    const userMessage = await Message.create({
      sessionId,
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Get AI response
    let aiResponse;
    
    switch (aiProvider) {
      case 'openai':
        aiResponse = await openaiService.chat(message, model);
        break;
      case 'anthropic':
        aiResponse = await anthropicService.chat(message, model);
        break;
      case 'google':
        aiResponse = await googleService.chat(message, model);
        break;
      default:
        throw createApiError('Invalid AI provider', 400, 'INVALID_AI_PROVIDER');
    }

    // Save AI response
    const assistantMessage = await Message.create({
      sessionId,
      role: 'assistant',
      content: aiResponse.content,
      aiProvider,
      model: aiResponse.model,
      tokenCount: aiResponse.tokenCount,
      timestamp: new Date(),
    });

    // Record usage metrics
    if (aiResponse.tokenCount && aiResponse.cost) {
      await UsageMetrics.create({
        userId,
        sessionId,
        aiProvider,
        model: aiResponse.model,
        tokenCount: aiResponse.tokenCount,
        cost: aiResponse.cost,
        timestamp: new Date(),
      });
    }

    // Update session
    await session.update({ updatedAt: new Date() });

    res.json({
      userMessage,
      assistantMessage,
      usage: {
        tokenCount: aiResponse.tokenCount,
        cost: aiResponse.cost,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get conversation history for a session
router.get('/history/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;

    // Verify session belongs to user
    const session = await Session.findOne({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw createApiError('Session not found', 404, 'SESSION_NOT_FOUND');
    }

    const offset = (Number(page) - 1) * Number(limit);

    const messages = await Message.findAndCountAll({
      where: { sessionId },
      limit: Number(limit),
      offset,
      order: [['timestamp', 'ASC']],
    });

    res.json({
      messages: messages.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: messages.count,
        pages: Math.ceil(messages.count / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get AI provider models
router.get('/models/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider } = req.params;

    const models: Record<string, string[]> = {
      openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'],
      anthropic: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229'],
      google: ['gemini-pro', 'gemini-pro-vision'],
    };

    if (!models[provider]) {
      throw createApiError('Invalid AI provider', 400, 'INVALID_AI_PROVIDER');
    }

    res.json({
      provider,
      models: models[provider],
    });
  } catch (error) {
    next(error);
  }
});

export default router;