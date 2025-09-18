import { body, param, query, ValidationChain } from 'express-validator';

export const validateRegister: ValidationChain[] = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('username')
    .isLength({ min: 3, max: 50 })
    .isAlphanumeric()
    .withMessage('Username must be 3-50 alphanumeric characters'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
];

export const validateLogin: ValidationChain[] = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

export const validateChatMessage: ValidationChain[] = [
  body('message')
    .notEmpty()
    .isLength({ max: 10000 })
    .withMessage('Message is required and must be less than 10000 characters'),
  body('sessionId')
    .isUUID()
    .withMessage('Valid session ID is required'),
  body('aiProvider')
    .isIn(['openai', 'anthropic', 'google'])
    .withMessage('AI provider must be openai, anthropic, or google'),
  body('model')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Model name must be a string less than 100 characters'),
];

export const validateSessionCreate: ValidationChain[] = [
  body('title')
    .notEmpty()
    .isLength({ min: 1, max: 200 })
    .withMessage('Session title is required and must be less than 200 characters'),
];

export const validateSessionId: ValidationChain[] = [
  param('sessionId')
    .isUUID()
    .withMessage('Valid session ID is required'),
];

export const validateFeedback: ValidationChain[] = [
  body('messageId')
    .isUUID()
    .withMessage('Valid message ID is required'),
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),
  body('comment')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Comment must be less than 1000 characters'),
];

export const validateUsageQuery: ValidationChain[] = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO8601 date'),
  query('aiProvider')
    .optional()
    .isIn(['openai', 'anthropic', 'google'])
    .withMessage('AI provider must be openai, anthropic, or google'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];