import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { Feedback, Message, User, Session } from '../models';
import { authenticateToken } from '../middleware/auth';
import { validateFeedback } from '../middleware/validation';
import { createApiError } from '../middleware/errorHandler';
import sequelize from '../database/connection';

const router = Router();

// All feedback routes require authentication
router.use(authenticateToken);

// Submit feedback for a message
router.post('/', validateFeedback, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { messageId, rating, comment } = req.body;
    const userId = req.user.id;

    // Verify message exists and belongs to user's session
    const message = await Message.findOne({
      where: { id: messageId },
      include: [
        {
          model: Session,
          as: 'session',
          where: { userId },
        },
      ],
    });

    if (!message) {
      throw createApiError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    // Check if user already provided feedback for this message
    const existingFeedback = await Feedback.findOne({
      where: { messageId, userId },
    });

    if (existingFeedback) {
      // Update existing feedback
      await existingFeedback.update({ rating, comment });
      
      res.json({
        message: 'Feedback updated successfully',
        feedback: existingFeedback,
      });
    } else {
      // Create new feedback
      const feedback = await Feedback.create({
        messageId,
        userId,
        rating,
        comment,
      });

      res.status(201).json({
        message: 'Feedback submitted successfully',
        feedback,
      });
    }
  } catch (error) {
    next(error);
  }
});

// Get feedback for a message
router.get('/message/:messageId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Verify message exists and belongs to user's session
    const message = await Message.findOne({
      where: { id: messageId },
      include: [
        {
          model: Session,
          as: 'session',
          where: { userId },
        },
      ],
    });

    if (!message) {
      throw createApiError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    const feedback = await Feedback.findAll({
      where: { messageId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    res.json({ feedback });
  } catch (error) {
    next(error);
  }
});

// Get user's feedback history
router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const feedback = await Feedback.findAndCountAll({
      where: { userId },
      limit: Number(limit),
      offset,
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: Message,
          as: 'message',
          attributes: ['id', 'content', 'aiProvider', 'model'],
        },
      ],
    });

    res.json({
      feedback: feedback.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: feedback.count,
        pages: Math.ceil(feedback.count / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Delete feedback
router.delete('/:feedbackId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { feedbackId } = req.params;
    const userId = req.user.id;

    const feedback = await Feedback.findOne({
      where: { id: feedbackId, userId },
    });

    if (!feedback) {
      throw createApiError('Feedback not found', 404, 'FEEDBACK_NOT_FOUND');
    }

    await feedback.destroy();

    res.json({
      message: 'Feedback deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Get feedback statistics for AI providers
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.id;

    // Get average ratings by AI provider
    const stats = await Feedback.findAll({
      attributes: [
        [sequelize.fn('AVG', sequelize.col('rating')), 'averageRating'],
        [sequelize.fn('COUNT', sequelize.col('Feedback.id')), 'totalFeedback'],
      ],
      include: [
        {
          model: Message,
          as: 'message',
          attributes: ['aiProvider'],
          include: [
            {
              model: Session,
              as: 'session',
              where: { userId },
              attributes: [],
            },
          ],
        },
      ],
      group: ['message.aiProvider'],
      raw: true,
    });

    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

export default router;