import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { authenticate, requireRole } from '../middleware/auth';
import { getUserById, assignRole, removeRole, unlockAccount } from '../services/auth.service';
import { writeAuditLog } from '../services/audit.service';
import { sendSuccess, sendError, sendPaginated } from '../utils/response';
import { getCollection } from '../config/db';

const router = Router();

// GET /api/v1/users/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserById(req.userId!, req.userId!, req.userRoles || []);
    if (!user) {
      sendError(res, 404, 'NOT_FOUND', 'User not found');
      return;
    }
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/:id (admin only)
router.get('/:id', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserById(req.params.id, req.userId!, req.userRoles || []);
    if (!user) {
      sendError(res, 404, 'NOT_FOUND', 'User not found');
      return;
    }
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users (admin only - list users)
router.get('/', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const search = req.query.search as string | undefined;

    const col = getCollection('users');
    const query: Record<string, unknown> = { isDeleted: false };
    if (search) {
      query.username_ci = { $regex: search.toLowerCase(), $options: 'i' };
    }

    const total = await col.countDocuments(query);
    const users = await col
      .find(query, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    sendPaginated(res, users, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/:id/roles
router.post('/:id/roles', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body;
    await assignRole(req.params.id, role);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: 'administrator',
      action: 'user.assign_role',
      objectType: 'user',
      objectId: req.params.id,
      newValue: { role },
      requestId: req.requestId,
    });

    sendSuccess(res, { assigned: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/users/:id/roles — replace all roles atomically
router.put('/:id/roles', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roles } = req.body;
    if (!Array.isArray(roles)) {
      sendError(res, 422, 'VALIDATION_ERROR', 'roles must be an array');
      return;
    }
    const validRoles = ['creator', 'moderator', 'administrator'];
    for (const r of roles) {
      if (!validRoles.includes(r)) {
        sendError(res, 422, 'VALIDATION_ERROR', `Invalid role: ${r}`);
        return;
      }
    }
    const col = getCollection('users');
    const oldUser = await col.findOne({ _id: new ObjectId(req.params.id) });
    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { roles, updatedAt: new Date() }, $inc: { version: 1 } }
    );
    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: 'administrator',
      action: 'user.set_roles',
      objectType: 'user',
      objectId: req.params.id,
      oldValue: { roles: (oldUser as any)?.roles },
      newValue: { roles },
      requestId: req.requestId,
    });
    sendSuccess(res, { roles });
  } catch (err) { next(err); }
});

// DELETE /api/v1/users/:id/roles/:role
router.delete('/:id/roles/:role', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await removeRole(req.params.id, req.params.role);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: 'administrator',
      action: 'user.remove_role',
      objectType: 'user',
      objectId: req.params.id,
      oldValue: { role: req.params.role },
      requestId: req.requestId,
    });

    sendSuccess(res, { removed: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/:id/unlock
router.post('/:id/unlock', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await unlockAccount(req.params.id);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: 'administrator',
      action: 'user.unlock',
      objectType: 'user',
      objectId: req.params.id,
      requestId: req.requestId,
    });

    sendSuccess(res, { unlocked: true });
  } catch (err) {
    next(err);
  }
});

export default router;
