import request from 'supertest';
import app from '../server';

describe('Server Health Check', () => {
  test('should respond with health status', async () => {
    const response = await request(app).get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'OK');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('environment');
  });
});

describe('API Info Endpoint', () => {
  test('should respond with API information', async () => {
    const response = await request(app).get('/api');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('name', 'AI Agora Backend API');
    expect(response.body).toHaveProperty('version', '1.0.0');
    expect(response.body).toHaveProperty('endpoints');
  });
});

describe('404 Handler', () => {
  test('should return 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route');
    
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('message');
    expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
  });
});