export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  aiProvider?: 'openai' | 'anthropic' | 'google';
  model?: string;
  timestamp: Date;
  tokenCount?: number;
}

export interface Feedback {
  id: string;
  messageId: string;
  userId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: Date;
}

export interface UsageMetrics {
  id: string;
  userId: string;
  sessionId: string;
  aiProvider: 'openai' | 'anthropic' | 'google';
  model: string;
  tokenCount: number;
  cost: number;
  timestamp: Date;
}

export interface AIResponse {
  content: string;
  model: string;
  tokenCount?: number;
  cost?: number;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  aiProvider: 'openai' | 'anthropic' | 'google';
  model?: string;
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
}