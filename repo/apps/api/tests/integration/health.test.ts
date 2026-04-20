import request from 'supertest';
import { setupTestDb, teardownTestDb } from '../setup';
import express from 'express';

let app: express.Application;

beforeAll(async () => {
  const result = await setupTestDb();
  app = result.app;
});

afterAll(async () => {
  await teardownTestDb();
});

describe('Health API', () => {
  describe('GET /api/v1/health', () => {
    it('returns 200 with ok:true', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('includes service name studyroomops-api', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.body.service).toBe('studyroomops-api');
    });

    it('includes a valid ISO timestamp', async () => {
      const before = new Date();
      const res = await request(app).get('/api/v1/health');
      const after = new Date();

      expect(res.status).toBe(200);
      const ts = new Date(res.body.timestamp);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it('does not require authentication', async () => {
      // No cookies, no CSRF — should succeed
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
    });
  });
});
