import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { Op } from 'sequelize';
import { UsageMetrics, Session } from '../models';
import { authenticateToken } from '../middleware/auth';
import { validateUsageQuery } from '../middleware/validation';
import { createApiError } from '../middleware/errorHandler';
import sequelize from '../database/connection';

const router = Router();

// All usage routes require authentication
router.use(authenticateToken);

// Get user usage metrics
router.get('/', validateUsageQuery, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const userId = req.user.id;
    const {
      startDate,
      endDate,
      aiProvider,
      page = 1,
      limit = 50,
    } = req.query;

    // Build where conditions
    const whereConditions: any = { userId };

    if (startDate || endDate) {
      whereConditions.timestamp = {};
      if (startDate) whereConditions.timestamp[Op.gte] = new Date(startDate as string);
      if (endDate) whereConditions.timestamp[Op.lte] = new Date(endDate as string);
    }

    if (aiProvider) {
      whereConditions.aiProvider = aiProvider;
    }

    const offset = (Number(page) - 1) * Number(limit);

    const usage = await UsageMetrics.findAndCountAll({
      where: whereConditions,
      limit: Number(limit),
      offset,
      order: [['timestamp', 'DESC']],
      include: [
        {
          model: Session,
          as: 'session',
          attributes: ['id', 'title'],
        },
      ],
    });

    res.json({
      usage: usage.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: usage.count,
        pages: Math.ceil(usage.count / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get usage summary
router.get('/summary', validateUsageQuery, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const userId = req.user.id;
    const { startDate, endDate, aiProvider } = req.query;

    // Build where conditions
    const whereConditions: any = { userId };

    if (startDate || endDate) {
      whereConditions.timestamp = {};
      if (startDate) whereConditions.timestamp[Op.gte] = new Date(startDate as string);
      if (endDate) whereConditions.timestamp[Op.lte] = new Date(endDate as string);
    }

    if (aiProvider) {
      whereConditions.aiProvider = aiProvider;
    }

    // Get summary statistics
    const summary = await UsageMetrics.findAll({
      attributes: [
        'aiProvider',
        [sequelize.fn('SUM', sequelize.col('tokenCount')), 'totalTokens'],
        [sequelize.fn('SUM', sequelize.col('cost')), 'totalCost'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalRequests'],
        [sequelize.fn('AVG', sequelize.col('cost')), 'averageCost'],
      ],
      where: whereConditions,
      group: ['aiProvider'],
      raw: true,
    });

    // Get overall totals
    const overallSummary = await UsageMetrics.findOne({
      attributes: [
        [sequelize.fn('SUM', sequelize.col('tokenCount')), 'totalTokens'],
        [sequelize.fn('SUM', sequelize.col('cost')), 'totalCost'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalRequests'],
        [sequelize.fn('AVG', sequelize.col('cost')), 'averageCost'],
      ],
      where: whereConditions,
      raw: true,
    });

    res.json({
      summary,
      overall: overallSummary,
    });
  } catch (error) {
    next(error);
  }
});

// Get usage by time period (daily, weekly, monthly)
router.get('/timeline', validateUsageQuery, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const userId = req.user.id;
    const { startDate, endDate, aiProvider, period = 'daily' } = req.query;

    // Build where conditions
    const whereConditions: any = { userId };

    if (startDate || endDate) {
      whereConditions.timestamp = {};
      if (startDate) whereConditions.timestamp[Op.gte] = new Date(startDate as string);
      if (endDate) whereConditions.timestamp[Op.lte] = new Date(endDate as string);
    }

    if (aiProvider) {
      whereConditions.aiProvider = aiProvider;
    }

    // Determine date truncation based on period
    let dateTrunc;
    switch (period) {
      case 'hourly':
        dateTrunc = sequelize.fn('DATE_TRUNC', 'hour', sequelize.col('timestamp'));
        break;
      case 'daily':
        dateTrunc = sequelize.fn('DATE_TRUNC', 'day', sequelize.col('timestamp'));
        break;
      case 'weekly':
        dateTrunc = sequelize.fn('DATE_TRUNC', 'week', sequelize.col('timestamp'));
        break;
      case 'monthly':
        dateTrunc = sequelize.fn('DATE_TRUNC', 'month', sequelize.col('timestamp'));
        break;
      default:
        dateTrunc = sequelize.fn('DATE_TRUNC', 'day', sequelize.col('timestamp'));
    }

    const timeline = await UsageMetrics.findAll({
      attributes: [
        [dateTrunc, 'period'],
        'aiProvider',
        [sequelize.fn('SUM', sequelize.col('tokenCount')), 'totalTokens'],
        [sequelize.fn('SUM', sequelize.col('cost')), 'totalCost'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalRequests'],
      ],
      where: whereConditions,
      group: [dateTrunc, 'aiProvider'],
      order: [[dateTrunc, 'ASC']],
      raw: true,
    });

    res.json({ timeline });
  } catch (error) {
    next(error);
  }
});

// Get cost breakdown by model
router.get('/models', validateUsageQuery, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const userId = req.user.id;
    const { startDate, endDate, aiProvider } = req.query;

    // Build where conditions
    const whereConditions: any = { userId };

    if (startDate || endDate) {
      whereConditions.timestamp = {};
      if (startDate) whereConditions.timestamp[Op.gte] = new Date(startDate as string);
      if (endDate) whereConditions.timestamp[Op.lte] = new Date(endDate as string);
    }

    if (aiProvider) {
      whereConditions.aiProvider = aiProvider;
    }

    const modelBreakdown = await UsageMetrics.findAll({
      attributes: [
        'aiProvider',
        'model',
        [sequelize.fn('SUM', sequelize.col('tokenCount')), 'totalTokens'],
        [sequelize.fn('SUM', sequelize.col('cost')), 'totalCost'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalRequests'],
        [sequelize.fn('AVG', sequelize.col('cost')), 'averageCost'],
      ],
      where: whereConditions,
      group: ['aiProvider', 'model'],
      order: [
        ['aiProvider', 'ASC'],
        [sequelize.fn('SUM', sequelize.col('cost')), 'DESC'],
      ],
      raw: true,
    });

    res.json({ modelBreakdown });
  } catch (error) {
    next(error);
  }
});

export default router;