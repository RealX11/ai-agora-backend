import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIResponse } from '../types';

export class OpenAIService {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(message: string, model: string = 'gpt-3.5-turbo'): Promise<AIResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
        max_tokens: 1000,
      });

      const content = completion.choices[0]?.message?.content || '';
      const tokenCount = completion.usage?.total_tokens || 0;
      
      // Approximate cost calculation (prices may vary)
      const cost = this.calculateCost(model, tokenCount);

      return {
        content,
        model,
        tokenCount,
        cost
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error('Failed to get response from OpenAI');
    }
  }

  private calculateCost(model: string, tokens: number): number {
    // Simplified cost calculation - adjust based on actual pricing
    const rates: Record<string, number> = {
      'gpt-3.5-turbo': 0.002 / 1000,
      'gpt-4': 0.03 / 1000,
      'gpt-4-turbo': 0.01 / 1000,
    };
    return (rates[model] || rates['gpt-3.5-turbo']) * tokens;
  }
}

export class AnthropicService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(message: string, model: string = 'claude-3-haiku-20240307'): Promise<AIResponse> {
    try {
      // Note: This is a simplified implementation
      // You may need to adjust based on the actual Anthropic SDK API
      const response = await (this.client as any).messages.create({
        model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: message }],
      });

      const content = response.content?.[0]?.text || '';
      const tokenCount = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      
      // Approximate cost calculation
      const cost = this.calculateCost(model, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);

      return {
        content,
        model,
        tokenCount,
        cost
      };
    } catch (error) {
      console.error('Anthropic API error:', error);
      throw new Error('Failed to get response from Anthropic');
    }
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Simplified cost calculation - adjust based on actual pricing
    const rates: Record<string, { input: number, output: number }> = {
      'claude-3-haiku-20240307': { input: 0.00025 / 1000, output: 0.00125 / 1000 },
      'claude-3-sonnet-20240229': { input: 0.003 / 1000, output: 0.015 / 1000 },
    };
    const rate = rates[model] || rates['claude-3-haiku-20240307'];
    return (rate.input * inputTokens) + (rate.output * outputTokens);
  }
}

export class GoogleAIService {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async chat(message: string, model: string = 'gemini-pro'): Promise<AIResponse> {
    try {
      const genModel = this.client.getGenerativeModel({ model });
      const result = await genModel.generateContent(message);
      const response = await result.response;
      
      const content = response.text();
      // Note: Google AI doesn't provide detailed usage metrics in the same way
      // This is a rough estimation
      const tokenCount = Math.ceil(content.length / 4); 
      
      // Approximate cost calculation
      const cost = this.calculateCost(model, tokenCount);

      return {
        content,
        model,
        tokenCount,
        cost
      };
    } catch (error) {
      console.error('Google AI API error:', error);
      throw new Error('Failed to get response from Google AI');
    }
  }

  private calculateCost(model: string, tokens: number): number {
    // Simplified cost calculation - adjust based on actual pricing
    const rates: Record<string, number> = {
      'gemini-pro': 0.0005 / 1000,
      'gemini-pro-vision': 0.0025 / 1000,
    };
    return (rates[model] || rates['gemini-pro']) * tokens;
  }
}