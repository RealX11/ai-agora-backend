import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types';

export const errorHandler = (
  error: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Log error
  console.error('Error:', {
    message: error.message,
    stack: 'stack' in error ? error.stack : undefined,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Handle different error types
  if ('status' in error) {
    const apiError = error as ApiError;
    return res.status(apiError.status).json({
      error: {
        message: apiError.message,
        code: apiError.code,
      },
    });
  }

  // Handle Sequelize validation errors
  if (error.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: {
        message: 'Validation error',
        details: (error as any).errors.map((err: any) => ({
          field: err.path,
          message: err.message,
        })),
      },
    });
  }

  // Handle Sequelize unique constraint errors
  if (error.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: {
        message: 'Resource already exists',
        details: (error as any).errors.map((err: any) => ({
          field: err.path,
          message: `${err.path} must be unique`,
        })),
      },
    });
  }

  // Default server error
  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: `Route ${req.originalUrl} not found`,
      code: 'NOT_FOUND',
    },
  });
};

export class ApiErrorClass extends Error implements ApiError {
  public status: number;
  public code?: string;

  constructor(message: string, status: number = 500, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

export const createApiError = (message: string, status: number = 500, code?: string) => {
  return new ApiErrorClass(message, status, code);
};