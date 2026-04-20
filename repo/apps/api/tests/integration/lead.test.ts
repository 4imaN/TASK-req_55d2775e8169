import request from 'supertest';
import path from 'path';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestApp, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

// ── Helpers ────────────────────────────────────────────────────────────────────

function createAgent() {
  return request.agent(app);
}

async function getCsrf(agent?: ReturnType<typeof request.agent>): Promise<string | { token: string; csrfCookies: string[] }> {
  if (agent) {
    const res = await agent.get('/api/v1/auth/csrf');
    return res.body.data.csrfToken as string;
  }
  const res = await request(app).get('/api/v1/auth/csrf');
  return {
    token: res.body.data.csrfToken as string,
    csrfCookies: (res.headers['set-cookie'] as unknown as string[]) || [],
  };
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ cookies: string[]; csrfToken: string; userId: string }> {
  const agent = createAgent();
  const csrf1 = await getCsrf(agent) as string;
  const regRes = await agent
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

  const csrf2 = await getCsrf(agent) as string;
  const loginRes = await agent
    .post('/api/v1/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ username, password });

  expect(loginRes.status).toBe(200);
  const cookies = loginRes.headers['set-cookie'] as unknown as string[];
  const csrfToken = loginRes.body.data.csrfToken as string;

  return { cookies, csrfToken, userId };
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

// ── Setup / teardown ───────────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Lead API', () => {
  describe('POST /api/v1/leads - create lead', () => {
    it('creates a lead with all required fields', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'leaduser1', 'LeadPass1234!', 'Lead User 1'
      );

      const res = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-create-1')
        .send(validLeadPayload);

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.type).toBe('group_study');
      expect(res.body.data.status).toBe('New');
      expect(res.body.data.budgetCapCents).toBe(50000);
    });

    it('rejects missing required fields', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'leaduser2', 'LeadPass1234!', 'Lead User 2'
      );

      // Missing requirements
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-missing-1')
        .send({ type: 'group_study', budgetCapCents: 1000 });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });

    it('rejects invalid lead type', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'leaduser3', 'LeadPass1234!', 'Lead User 3'
      );

      const res = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-invalid-type')
        .send({ ...validLeadPayload, type: 'invalid_type' });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });

    it('requires idempotency-key header', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'leaduser4', 'LeadPass1234!', 'Lead User 4'
      );

      const res = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        // No idempotency-key header
        .send(validLeadPayload);

      expect(res.status).toBe(422);
    });

    it('returns same lead for duplicate idempotency key', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'leaduser5', 'LeadPass1234!', 'Lead User 5'
      );

      const res1 = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-dedup-key')
        .send(validLeadPayload);
      expect(res1.status).toBe(201);
      const id1 = res1.body.data._id;

      const res2 = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-dedup-key')
        .send(validLeadPayload);
      expect(res2.status).toBe(201);
      expect(res2.body.data._id).toBe(id1);
    });
  });

  describe('PUT /api/v1/leads/:id/status - status transitions', () => {
    it('progresses through valid transitions: New -> In Discussion -> Quoted -> Confirmed -> Closed', async () => {
      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'leadowner', 'LeadPass1234!', 'Lead Owner'
      );
      const { cookies: staffCookies, csrfToken: staffCsrf, userId: staffId } = await registerAndLogin(
        'staffuser', 'StaffPass1234!', 'Staff User', ['creator']
      );

      // Create lead as user
      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .set('idempotency-key', 'lead-transition-1')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // New -> In Discussion
      const res2 = await request(app)
        .put(`/api/v1/leads/${leadId}/status`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ status: 'In Discussion' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('In Discussion');

      // In Discussion -> Quoted
      const res3 = await request(app)
        .put(`/api/v1/leads/${leadId}/status`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ status: 'Quoted', quoteAmountCents: 25000 });
      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe('Quoted');

      // Quoted -> Confirmed
      const res4 = await request(app)
        .put(`/api/v1/leads/${leadId}/status`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ status: 'Confirmed', quoteAmountCents: 25000 });
      expect(res4.status).toBe(200);
      expect(res4.body.data.status).toBe('Confirmed');

      // Confirmed -> Closed
      const res5 = await request(app)
        .put(`/api/v1/leads/${leadId}/status`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ status: 'Closed', closeReason: 'Contract signed' });
      expect(res5.status).toBe(200);
      expect(res5.body.data.status).toBe('Closed');
    });

    it('rejects invalid status transition', async () => {
      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'leadowner2', 'LeadPass1234!', 'Lead Owner 2'
      );
      const { cookies: staffCookies, csrfToken: staffCsrf } = await registerAndLogin(
        'staffuser2', 'StaffPass1234!', 'Staff User 2', ['creator']
      );

      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .set('idempotency-key', 'lead-bad-transition')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // New -> Confirmed is an invalid jump
      const res = await request(app)
        .put(`/api/v1/leads/${leadId}/status`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ status: 'Confirmed', quoteAmountCents: 10000 });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /api/v1/leads/:id/notes - staff notes', () => {
    it('hides internal staff notes from regular users', async () => {
      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'leadnoteowner', 'LeadPass1234!', 'Lead Note Owner'
      );
      const { cookies: staffCookies, csrfToken: staffCsrf } = await registerAndLogin(
        'staffnoteuser', 'StaffPass1234!', 'Staff Note User', ['creator']
      );

      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .set('idempotency-key', 'lead-notes-1')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // Staff adds internal note
      const noteRes = await request(app)
        .post(`/api/v1/leads/${leadId}/notes`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ content: 'Internal staff note: budget may be flexible.' });
      expect(noteRes.status).toBe(200);

      // Regular user fetches lead — should not see internal notes
      const leadRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Cookie', userCookies);
      expect(leadRes.status).toBe(200);
      const notes = leadRes.body.data.notes as any[];
      const internalNotes = notes.filter((n: any) => n.isInternal === true);
      expect(internalNotes).toHaveLength(0);

      // Staff fetches lead — should see internal notes
      const staffLeadRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Cookie', staffCookies);
      expect(staffLeadRes.status).toBe(200);
      const staffNotes = staffLeadRes.body.data.notes as any[];
      // Staff sees all notes (isInternal may be true for internal ones)
      expect(staffNotes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/v1/leads/:id/attachments - attachment upload', () => {
    it('uploads an attachment and can list it', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'attachuser', 'AttachPass1234!', 'Attach User'
      );

      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-attach-1')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // Upload a small PDF-like text file (will fail magic-bytes check in strict mode)
      // Use a valid small PNG to avoid MIME rejection
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixels
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth, color type, etc.
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]);

      const uploadRes = await request(app)
        .post(`/api/v1/leads/${leadId}/attachments`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .attach('file', pngBuffer, { filename: 'test.png', contentType: 'image/png' });

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.ok).toBe(true);

      // List attachments - must show the uploaded file
      const listRes = await request(app)
        .get(`/api/v1/leads/${leadId}/attachments`)
        .set('Cookie', cookies);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].mimeType).toBe('image/png');
      expect(listRes.body.data[0].sha256Hash).toBeDefined();
    });
  });

  describe('GET /api/v1/leads - list leads', () => {
    it('returns own leads for regular user', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'leadlist1', 'LeadPass1234!', 'Lead List User 1'
      );

      // Create two leads for this user
      await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-list-1a')
        .send(validLeadPayload);

      await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-list-1b')
        .send({ ...validLeadPayload, requirements: 'Need a second quiet meeting room with AV equipment.' });

      const listRes = await request(app)
        .get('/api/v1/leads')
        .set('Cookie', cookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
      // Regular user sees only their own leads
      for (const lead of listRes.body.data) {
        expect(lead.requesterUserId).toBe(userId);
      }
    });

    it('returns all leads for staff', async () => {
      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'leadlist2', 'LeadPass1234!', 'Lead List User 2'
      );
      const { cookies: staffCookies } = await registerAndLogin(
        'leadliststaff1', 'StaffPass1234!', 'Lead List Staff 1', ['creator']
      );

      // Create a lead as regular user
      await request(app)
        .post('/api/v1/leads')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .set('idempotency-key', 'lead-list-staff-1')
        .send(validLeadPayload);

      const listRes = await request(app)
        .get('/api/v1/leads')
        .set('Cookie', staffCookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/leads/:id/notes - fetch notes', () => {
    it('returns notes for staff', async () => {
      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'leadnotes1', 'LeadPass1234!', 'Lead Notes User 1'
      );
      const { cookies: staffCookies, csrfToken: staffCsrf } = await registerAndLogin(
        'leadnotesstaff1', 'StaffPass1234!', 'Lead Notes Staff 1', ['creator']
      );

      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .set('idempotency-key', 'lead-notes-get-1')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // Staff adds a note
      const noteRes = await request(app)
        .post(`/api/v1/leads/${leadId}/notes`)
        .set('Cookie', staffCookies)
        .set('x-csrf-token', staffCsrf)
        .send({ content: 'Staff note: customer is flexible on budget.' });
      expect(noteRes.status).toBe(200);

      // Staff fetches notes directly
      const notesRes = await request(app)
        .get(`/api/v1/leads/${leadId}/notes`)
        .set('Cookie', staffCookies);

      expect(notesRes.status).toBe(200);
      expect(notesRes.body.ok).toBe(true);
      expect(Array.isArray(notesRes.body.data)).toBe(true);
      expect(notesRes.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects non-staff with 403', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'leadnotes2', 'LeadPass1234!', 'Lead Notes User 2'
      );

      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-notes-get-2')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // Regular user tries to fetch notes directly
      const notesRes = await request(app)
        .get(`/api/v1/leads/${leadId}/notes`)
        .set('Cookie', cookies);

      expect(notesRes.status).toBe(403);
    });
  });

  describe('GET /api/v1/leads/:id/attachments/:attachmentId/download - attachment download', () => {
    it('allows lead owner to download their attachment', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'attachdl1', 'AttachPass1234!', 'Attach Download User'
      );

      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .set('idempotency-key', 'lead-attach-dl-1')
        .send(validLeadPayload);
      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;

      // Upload a PNG attachment
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]);

      const uploadRes = await request(app)
        .post(`/api/v1/leads/${leadId}/attachments`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .attach('file', pngBuffer, { filename: 'download-test.png', contentType: 'image/png' });

      expect(uploadRes.status).toBe(201);
      const attachmentId = uploadRes.body.data._id as string;

      // Download the attachment
      const dlRes = await request(app)
        .get(`/api/v1/leads/${leadId}/attachments/${attachmentId}/download`)
        .set('Cookie', cookies);

      // Expect either the file bytes (200) or a redirect (302) to a signed URL
      expect([200, 302]).toContain(dlRes.status);
    });
  });
});
