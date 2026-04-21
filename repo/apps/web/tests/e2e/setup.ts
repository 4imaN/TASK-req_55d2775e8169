/**
 * E2E Test Setup
 *
 * Shared helpers for all frontend E2E integration tests.
 * These tests boot the real Express app (same as the API integration tests)
 * and drive it with supertest, validating the exact API contract the
 * React frontend depends on.
 *
 * Pattern mirrors apps/api/tests/setup.ts — the web E2E tests import
 * the API app directly so no network is needed and no port binding occurs.
 */

import request from 'supertest';
import { MongoClient, Db, ObjectId } from 'mongodb';
import express from 'express';

// Static imports from the API source.
// Paths resolve relative to this file: apps/web/tests/e2e/ → ../../../api/src/
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbModule = require('../../../api/src/config/db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appModule = require('../../../api/src/app');

let client: MongoClient;
let db: Db;
let app: express.Application;

const TEST_MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/studyroomops_e2e_test?replicaSet=rs0';

export async function setupE2eDb(): Promise<{
  db: Db;
  client: MongoClient;
  app: express.Application;
}> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET =
    'test-jwt-secret-that-is-at-least-64-characters-long-for-testing-purposes';
  process.env.CSRF_SECRET = 'test-csrf-secret';
  process.env.FIELD_ENCRYPTION_KEY = 'test-field-encryption-key-32chars';
  process.env.FILE_ENCRYPTION_KEY = 'test-file-encryption-key-32chars!';
  process.env.MONGO_URI = TEST_MONGO_URI;
  process.env.MONGO_DB_NAME = 'studyroomops_e2e_test';

  const { connectDb, bootstrapIndexes, getClient } = dbModule;

  db = await connectDb();
  client = getClient();
  await bootstrapIndexes();

  const { createApp } = appModule;
  app = createApp();

  return { db, client, app };
}

export async function teardownE2eDb(): Promise<void> {
  if (db) {
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
  }
  if (client) {
    await client.close();
  }
}

export async function clearAndReindex(): Promise<void> {
  if (db) {
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
  }
  const { bootstrapIndexes } = dbModule;
  await bootstrapIndexes();
}

export function getE2eApp(): express.Application {
  return app;
}

export function getE2eDb(): Db {
  return db;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Fetch a fresh CSRF token using a supertest agent (session-bound). */
export async function getCsrfToken(
  agent: ReturnType<typeof request.agent>
): Promise<string> {
  const res = await agent.get('/api/v1/auth/csrf');
  return res.body.data.csrfToken as string;
}

/** Register a user and return cookies + csrfToken. */
export async function registerUser(
  appInstance: express.Application,
  opts: {
    username: string;
    password: string;
    displayName: string;
    phone?: string;
  }
): Promise<{
  cookies: string[];
  csrfToken: string;
  userId: string;
  user: Record<string, unknown>;
}> {
  const ag = request.agent(appInstance);
  const csrf = await getCsrfToken(ag);

  const body: Record<string, unknown> = {
    username: opts.username,
    password: opts.password,
    displayName: opts.displayName,
  };
  if (opts.phone) body.phone = opts.phone;

  const res = await ag
    .post('/api/v1/auth/register')
    .set('x-csrf-token', csrf)
    .send(body);

  if (res.status !== 200) {
    throw new Error(
      `Register failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  const cookies = res.headers['set-cookie'] as unknown as string[];
  const csrfToken = res.body.data.csrfToken as string;
  const userId = res.body.data.user._id as string;
  const user = res.body.data.user as Record<string, unknown>;

  return { cookies, csrfToken, userId, user };
}

/** Login a user and return cookies + csrfToken. */
export async function loginUser(
  appInstance: express.Application,
  opts: { username: string; password: string }
): Promise<{ cookies: string[]; csrfToken: string; userId: string }> {
  const ag = request.agent(appInstance);
  const csrf = await getCsrfToken(ag);

  const res = await ag
    .post('/api/v1/auth/login')
    .set('x-csrf-token', csrf)
    .send({ username: opts.username, password: opts.password });

  if (res.status !== 200) {
    throw new Error(
      `Login failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  const cookies = res.headers['set-cookie'] as unknown as string[];
  const csrfToken = res.body.data.csrfToken as string;
  const userId = res.body.data.user._id as string;

  return { cookies, csrfToken, userId };
}

/** Promote a user to administrator via direct DB write. */
export async function promoteToAdmin(userId: string): Promise<void> {
  await db
    .collection('users')
    .updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles: ['administrator'] } }
    );
}

/** Seed business hours for a given day-of-week (0=Sunday). */
export async function seedBusinessHours(dayOfWeek: number): Promise<void> {
  const existing = await db
    .collection('business_hours')
    .findOne({ scope: 'site', dayOfWeek });
  if (!existing) {
    await db.collection('business_hours').insertOne({
      scope: 'site',
      scopeId: null,
      dayOfWeek,
      openTime: '00:00',
      closeTime: '23:59',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
  }
}

/** Build ISO timestamps for tomorrow at specific hours (aligns to :00 minutes). */
export function tomorrowSlot(
  startHour: number,
  endHour: number
): { startAtUtc: string; endAtUtc: string; dayOfWeek: number } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(startHour, 0, 0, 0);

  const end = new Date(start);
  end.setHours(endHour, 0, 0, 0);

  return {
    startAtUtc: start.toISOString(),
    endAtUtc: end.toISOString(),
    dayOfWeek: start.getDay(),
  };
}
