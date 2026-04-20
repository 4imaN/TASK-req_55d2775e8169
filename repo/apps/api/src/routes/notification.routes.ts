import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { authenticate } from '../middleware/auth';
import { getCollection } from '../config/db';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';

const router = Router();

// GET /api/v1/notifications
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const unreadOnly = req.query.unreadOnly === 'true';

    const col = getCollection('notifications');
    const query: Record<string, unknown> = { userId: req.userId! };
    if (unreadOnly) query.readAt = null;

    const total = await col.countDocuments(query);
    const notifications = await col
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    sendPaginated(res, notifications, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const col = getCollection('notifications');
    const count = await col.countDocuments({ userId: req.userId!, readAt: null });
    sendSuccess(res, { count });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/notifications/:id/read
router.put('/:id/read', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const col = getCollection('notifications');
    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), userId: req.userId! },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      sendError(res, 404, 'NOT_FOUND', 'Notification not found');
      return;
    }

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/notifications/read-all
router.put('/read-all', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const col = getCollection('notifications');
    await col.updateMany(
      { userId: req.userId!, readAt: null },
      { $set: { readAt: new Date() } }
    );
    sendSuccess(res, { marked: true });
  } catch (err) {
    next(err);
  }
});

export default router;

// Helper to create notifications from services
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  referenceType?: string,
  referenceId?: string,
  dueAt?: Date
): Promise<void> {
  const col = getCollection('notifications');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  await col.insertOne({
    userId,
    type,
    title,
    message,
    referenceType,
    referenceId,
    readAt: null,
    dueAt: dueAt || undefined,
    expiresAt,
    createdAt: new Date(),
  } as any);
}
