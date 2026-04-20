import { MongoClient, Db } from 'mongodb';
import { createApp } from '../src/app';
import express from 'express';

let client: MongoClient;
let db: Db;
let app: express.Application;

const TEST_MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/studyroomops_test?replicaSet=rs0';

export async function setupTestDb(): Promise<{ db: Db; client: MongoClient; app: express.Application }> {
  // Override env for test
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-64-characters-long-for-testing-purposes';
  process.env.CSRF_SECRET = 'test-csrf-secret';
  process.env.FIELD_ENCRYPTION_KEY = 'test-field-encryption-key-32chars';
  process.env.FILE_ENCRYPTION_KEY = 'test-file-encryption-key-32chars!';
  process.env.MONGO_URI = TEST_MONGO_URI;
  process.env.MONGO_DB_NAME = 'studyroomops_test';

  // Dynamic import to pick up env changes
  const { connectDb, bootstrapIndexes } = await import('../src/config/db');

  db = await connectDb();
  client = (await import('../src/config/db')).getClient();
  await bootstrapIndexes();

  app = createApp();
  return { db, client, app };
}

export async function teardownTestDb(): Promise<void> {
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

export function getTestApp(): express.Application {
  return app;
}

export function getTestDb(): Db {
  return db;
}
