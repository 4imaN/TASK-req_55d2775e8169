import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function agent() {
  return request.agent(app);
}

async function getCsrf(ag: ReturnType<typeof request.agent>): Promise<string> {
  const res = await ag.get('/api/v1/auth/csrf');
  return res.body.data.csrfToken as string;
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ agent: ReturnType<typeof request.agent>; userId: string }> {
  const ag = agent();

  const csrf1 = await getCsrf(ag);
  const regRes = await ag
    .post('/api/v1/auth/register')
    .set('x-csrf-token', csrf1)
    .send({ username, password, displayName });
  expect(regRes.status).toBe(200);
  const userId = regRes.body.data.user._id as string;

  if (roles && roles.length > 0) {
    const db = getTestDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles } }
    );
  }

  const csrf2 = await getCsrf(ag);
  const loginRes = await ag
    .post('/api/v1/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ username, password });
  expect(loginRes.status).toBe(200);

  return { agent: ag, userId };
}

const validLeadPayload = {
  type: 'group_study',
  requirements: 'Need a quiet meeting room for 6 people with projector and whiteboard.',
  budgetCapCents: 50000,
  availabilityWindows: [
    {
      start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
  contactPhone: '+15005550006',
};

beforeAll(async () => {
  const result = await setupTestDb();
  app = result.app;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  const db = getTestDb();
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.collection(col.name).deleteMany({});
  }
  const { bootstrapIndexes } = await import('../../src/config/db');
  await bootstrapIndexes();
});

describe('Lead history API contract', () => {
  it('returns history entries with note, changedAt, and all expected fields', async () => {
    const { agent: userAg } = await registerAndLogin(
      'histowner', 'HistPass1234!', 'History Owner'
    );
    const { agent: staffAg } = await registerAndLogin(
      'histstaff', 'StaffPass1234!', 'History Staff', ['creator']
    );

    // Create lead
    let csrf = await getCsrf(userAg);
    const createRes = await userAg
      .post('/api/v1/leads')
      .set('x-csrf-token', csrf)
      .set('idempotency-key', 'hist-test-1')
      .send(validLeadPayload);
    expect(createRes.status).toBe(201);
    const leadId = createRes.body.data._id;

    // Transition: New -> In Discussion
    csrf = await getCsrf(staffAg);
    await staffAg
      .put(`/api/v1/leads/${leadId}/status`)
      .set('x-csrf-token', csrf)
      .send({ status: 'In Discussion' });

    // Transition: In Discussion -> Quoted (with quote)
    csrf = await getCsrf(staffAg);
    await staffAg
      .put(`/api/v1/leads/${leadId}/status`)
      .set('x-csrf-token', csrf)
      .send({ status: 'Quoted', quoteAmountCents: 25000 });

    // Transition: Quoted -> Closed (with reason)
    csrf = await getCsrf(staffAg);
    await staffAg
      .put(`/api/v1/leads/${leadId}/status`)
      .set('x-csrf-token', csrf)
      .send({ status: 'Closed', closeReason: 'Budget exceeded' });

    // Fetch history
    const histRes = await userAg
      .get(`/api/v1/leads/${leadId}/history`);
    expect(histRes.status).toBe(200);

    const history = histRes.body.data;
    expect(history.length).toBe(4); // initial New + 3 transitions

    // Every entry must have both changedAt and createdAt
    for (const entry of history) {
      expect(entry).toHaveProperty('_id');
      expect(entry).toHaveProperty('fromStatus');
      expect(entry).toHaveProperty('toStatus');
      expect(entry).toHaveProperty('createdAt');
      expect(entry).toHaveProperty('changedAt');
      // changedAt should equal createdAt
      expect(entry.changedAt).toEqual(entry.createdAt);
    }

    // The Quoted transition should have a note with the quote amount
    const quotedEntry = history.find((h: any) => h.toStatus === 'Quoted');
    expect(quotedEntry).toBeTruthy();
    expect(quotedEntry.note).toContain('$250.00');
    expect(quotedEntry.quoteAmountCents).toBe(25000);

    // The Closed transition should have a note with the close reason
    const closedEntry = history.find((h: any) => h.toStatus === 'Closed');
    expect(closedEntry).toBeTruthy();
    expect(closedEntry.note).toContain('Budget exceeded');
    expect(closedEntry.closeReason).toBe('Budget exceeded');
  });

  it('returns empty note for transitions without quote or close reason', async () => {
    const { agent: userAg } = await registerAndLogin(
      'histowner2', 'HistPass1234!', 'History Owner 2'
    );
    const { agent: staffAg } = await registerAndLogin(
      'histstaff2', 'StaffPass1234!', 'History Staff 2', ['creator']
    );

    // Create lead
    let csrf = await getCsrf(userAg);
    const createRes = await userAg
      .post('/api/v1/leads')
      .set('x-csrf-token', csrf)
      .set('idempotency-key', 'hist-test-2')
      .send(validLeadPayload);
    expect(createRes.status).toBe(201);
    const leadId = createRes.body.data._id;

    // Transition: New -> In Discussion (no quote, no reason)
    csrf = await getCsrf(staffAg);
    await staffAg
      .put(`/api/v1/leads/${leadId}/status`)
      .set('x-csrf-token', csrf)
      .send({ status: 'In Discussion' });

    const histRes = await userAg
      .get(`/api/v1/leads/${leadId}/history`);
    expect(histRes.status).toBe(200);

    // The In Discussion entry should not have a note
    const inDiscEntry = histRes.body.data.find((h: any) => h.toStatus === 'In Discussion');
    expect(inDiscEntry).toBeTruthy();
    expect(inDiscEntry.note).toBeFalsy();
  });
});
