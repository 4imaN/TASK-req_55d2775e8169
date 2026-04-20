import { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/session.service';
import { sendError } from '../utils/response';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
      userRoles?: string[];
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.session_token;
  if (!token) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
    return;
  }

  validateSession(token)
    .then((result) => {
      if (!result) {
        sendError(res, 401, 'UNAUTHENTICATED', 'Session expired or invalid');
        return;
      }
      req.userId = result.userId;
      req.sessionId = result.sessionId;
      req.userRoles = result.roles;
      next();
    })
    .catch((err) => {
      sendError(res, 401, 'UNAUTHENTICATED', 'Authentication failed');
    });
}

// Role check middleware factory
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userId || !req.userRoles) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
      return;
    }

    // Administrator inherits all staff capabilities
    const effectiveRoles = req.userRoles.includes('administrator')
      ? ['administrator', 'creator', 'moderator']
      : req.userRoles;

    const hasRole = allowedRoles.some((role) => effectiveRoles.includes(role));
    if (!hasRole) {
      sendError(res, 403, 'FORBIDDEN', 'Insufficient permissions');
      return;
    }

    next();
  };
}

// Check if user has any staff role
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId || !req.userRoles) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
    return;
  }

  const staffRoles = ['creator', 'moderator', 'administrator'];
  const isStaff = req.userRoles.some((r) => staffRoles.includes(r));
  if (!isStaff) {
    sendError(res, 403, 'FORBIDDEN', 'Staff access required');
    return;
  }

  next();
}

// Helper to check role in service layer
export function hasRole(userRoles: string[], role: string): boolean {
  if (userRoles.includes('administrator')) return true;
  return userRoles.includes(role);
}

export function isAdmin(userRoles: string[]): boolean {
  return userRoles.includes('administrator');
}

// Optional auth: validates session if present but never rejects — anonymous callers pass through
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.session_token;
  if (!token) {
    next();
    return;
  }

  validateSession(token)
    .then((result) => {
      if (result) {
        req.userId = result.userId;
        req.sessionId = result.sessionId;
        req.userRoles = result.roles;
      }
      next();
    })
    .catch(() => {
      // Swallow errors; treat as anonymous
      next();
    });
}
