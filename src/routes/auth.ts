import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { validationResult } from 'express-validator';
import { Op } from 'sequelize';
import { User } from '../models';
import { generateToken } from '../middleware/auth';
import { validateRegister, validateLogin } from '../middleware/validation';
import { createApiError } from '../middleware/errorHandler';

const router = Router();

// Register new user
router.post('/register', validateRegister, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { email, username, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      where: {
        [Op.or]: [{ email }, { username }]
      }
    });

    if (existingUser) {
      throw createApiError('User already exists', 409, 'USER_EXISTS');
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await User.create({
      email,
      username,
      passwordHash,
    });

    // Generate token
    const token = generateToken(user.id);

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// Login user
router.post('/login', validateLogin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createApiError('Validation failed', 400, 'VALIDATION_ERROR');
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ where: { email } });
    if (!user) {
      throw createApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw createApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // Generate token
    const token = generateToken(user.id);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// Get current user profile
router.get('/profile', async (req: Request, res: Response, next) => {
  try {
    const user = req.user;
    if (!user) {
      throw createApiError('User not authenticated', 401, 'NOT_AUTHENTICATED');
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;