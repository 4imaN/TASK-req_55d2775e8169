import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { requestIdMiddleware } from './utils/requestId';
import { csrfProtection } from './middleware/csrf';
import { errorHandler } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import zoneRoutes from './routes/zone.routes';
import roomRoutes from './routes/room.routes';
import businessHoursRoutes from './routes/businessHours.routes';
import reservationRoutes from './routes/reservation.routes';
import favoritesRoutes from './routes/favorites.routes';
import shareLinksRoutes from './routes/shareLinks.routes';
import notificationRoutes from './routes/notification.routes';
import auditRoutes from './routes/audit.routes';
import leadRoutes from './routes/lead.routes';
import reviewRoutes from './routes/review.routes';
import qaRoutes from './routes/qa.routes';
import moderationRoutes from './routes/moderation.routes';
import membershipRoutes from './routes/membership.routes';
import walletRoutes from './routes/wallet.routes';
import blacklistRoutes from './routes/blacklist.routes';
import disputeRoutes from './routes/dispute.routes';
import analyticsRoutes from './routes/analytics.routes';
import exportRoutes from './routes/export.routes';
import visionRoutes from './routes/vision.routes';
import policyRoutes from './routes/policy.routes';

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // Handled by React app
  }));

  // CORS for same-origin deployment
  let corsOrigin: string | boolean;
  if (process.env.CORS_ORIGIN) {
    corsOrigin = process.env.CORS_ORIGIN;
  } else if (process.env.NODE_ENV === 'production') {
    corsOrigin = false; // No CORS in production without explicit config — same-origin only
  } else {
    corsOrigin = 'http://localhost:3000';
  }
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
  }));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Request ID
  app.use(requestIdMiddleware);

  // Access logging (structured, no sensitive data)
  app.use(morgan(':method :url :status :response-time ms - :req[x-request-id]', {
    skip: (req) => req.url === '/api/v1/health',
  }));

  // CSRF protection for mutating requests
  app.use('/api/v1', csrfProtection);

  // Health check (no auth)
  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, service: 'studyroomops-api', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/zones', zoneRoutes);
  app.use('/api/v1/rooms', roomRoutes);
  app.use('/api/v1/business-hours', businessHoursRoutes);
  app.use('/api/v1/reservations', reservationRoutes);
  app.use('/api/v1/favorites', favoritesRoutes);
  app.use('/api/v1/share-links', shareLinksRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/leads', leadRoutes);
  app.use('/api/v1/reviews', reviewRoutes);
  app.use('/api/v1/qa-threads', qaRoutes);
  app.use('/api/v1/moderation', moderationRoutes);
  app.use('/api/v1/membership', membershipRoutes);
  app.use('/api/v1/wallet', walletRoutes);
  app.use('/api/v1/wallet/disputes', disputeRoutes);
  app.use('/api/v1/blacklist', blacklistRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/exports', exportRoutes);
  app.use('/api/v1/vision', visionRoutes);
  app.use('/api/v1/policies', policyRoutes);

  // Error handler
  app.use(errorHandler);

  return app;
}
