import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { Session, Message } from '../models';
import { authenticateToken } from '../middleware/auth';
import { validateSessionCreate, validateSessionId } from '../middleware/validation';
import { createApiError } from '../middleware/errorHandler';

const router = Router();

// All session routes require authentication
router.use(authenticateToken);

// Create new session
router.post('/', validateSessionCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { title } = req.body;
    const userId = req.user.id;

    const session = await Session.create({
      userId,
      title,
      isActive: true,
    });

    res.status(201).json({
      message: 'Session created successfully',
      session,
    });
  } catch (error) {
    next(error);
  }
});

// Get user sessions
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const sessions = await Session.findAndCountAll({
      where: { userId },
      limit: Number(limit),
      offset,
      order: [['updatedAt', 'DESC']],
      include: [
        {
          model: Message,
          as: 'messages',
          limit: 1,
          order: [['timestamp', 'DESC']],
        },
      ],
    });

    res.json({
      sessions: sessions.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: sessions.count,
        pages: Math.ceil(sessions.count / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get specific session with messages
router.get('/:sessionId', validateSessionId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await Session.findOne({
      where: { id: sessionId, userId },
      include: [
        {
          model: Message,
          as: 'messages',
          order: [['timestamp', 'ASC']],
        },
      ],
    });

    if (!session) {
      throw createApiError('Session not found', 404, 'SESSION_NOT_FOUND');
    }

    res.json({ session });
  } catch (error) {
    next(error);
  }
});

// Update session
router.put('/:sessionId', validateSessionId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { sessionId } = req.params;
    const { title, isActive } = req.body;
    const userId = req.user.id;

    const session = await Session.findOne({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw createApiError('Session not found', 404, 'SESSION_NOT_FOUND');
    }

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (isActive !== undefined) updateData.isActive = isActive;

    await session.update(updateData);

    res.json({
      message: 'Session updated successfully',
      session,
    });
  } catch (error) {
    next(error);
  }
});

// Delete session
router.delete('/:sessionId', validateSessionId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await Session.findOne({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw createApiError('Session not found', 404, 'SESSION_NOT_FOUND');
    }

    await session.destroy();

    res.json({
      message: 'Session deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;