import { Router, Request, Response, NextFunction } from 'express';
import { register, login, getUserById } from '../services/auth.service';
import { createSession, revokeSession } from '../services/session.service';
import { writeAuditLog } from '../services/audit.service';
import { authenticate } from '../middleware/auth';
import { setCsrfCookie } from '../middleware/csrf';
import { sendSuccess, sendError } from '../utils/response';

const router = Router();

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, displayName, phone } = req.body;
    const user = await register(username, password, displayName, phone);

    // Create session
    const { token, sessionId } = await createSession(user._id);

    // Set session cookie
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'test',
      sameSite: 'lax',
      maxAge: 12 * 3600 * 1000,
      path: '/',
    });

    // Set CSRF cookie
    const csrfToken = setCsrfCookie(res);

    await writeAuditLog({
      actorUserId: user._id,
      actorRole: 'user',
      action: 'user.register',
      objectType: 'user',
      objectId: user._id,
      newValue: { username: user.username },
      requestId: req.requestId,
    });

    sendSuccess(res, { user, csrfToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    const { user } = await login(username, password);

    // Create session
    const { token, sessionId } = await createSession(user._id);

    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'test',
      sameSite: 'lax',
      maxAge: 12 * 3600 * 1000,
      path: '/',
    });

    const csrfToken = setCsrfCookie(res);

    await writeAuditLog({
      actorUserId: user._id,
      actorRole: user.roles.length > 0 ? user.roles[0] : 'user',
      action: 'user.login',
      objectType: 'session',
      objectId: sessionId,
      requestId: req.requestId,
    });

    sendSuccess(res, { user, csrfToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.sessionId) {
      await revokeSession(req.sessionId);

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: req.userRoles?.[0] || 'user',
        action: 'user.logout',
        objectType: 'session',
        objectId: req.sessionId,
        requestId: req.requestId,
      });
    }

    res.clearCookie('session_token');
    res.clearCookie('csrf_token');
    sendSuccess(res, { message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserById(req.userId!, req.userId!, req.userRoles || []);
    if (!user) {
      sendError(res, 404, 'NOT_FOUND', 'User not found');
      return;
    }
    sendSuccess(res, { user });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/csrf
router.get('/csrf', (_req: Request, res: Response) => {
  const csrfToken = setCsrfCookie(res);
  sendSuccess(res, { csrfToken });
});

export default router;
