import { DateTime } from 'luxon';

function requireEnv(key: string, defaultValue?: string): string {
  const val = process.env[key] ?? defaultValue;
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function intEnv(key: string, defaultValue: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultValue;
}

export const config = {
  mongo: {
    uri: requireEnv('MONGO_URI', 'mongodb://localhost:27017/studyroomops?replicaSet=rs0'),
    dbName: requireEnv('MONGO_DB_NAME', 'studyroomops'),
  },
  jwt: {
    secret: requireEnv('JWT_SECRET', 'dev-secret-change-in-production-must-be-at-least-64-chars-long-for-security'),
    idleExpiryMinutes: intEnv('JWT_IDLE_EXPIRY_MINUTES', 30),
    absoluteExpiryHours: intEnv('JWT_ABSOLUTE_EXPIRY_HOURS', 12),
  },
  csrf: {
    secret: requireEnv('CSRF_SECRET', 'dev-csrf-secret-change-in-production'),
  },
  encryption: {
    fieldKey: requireEnv('FIELD_ENCRYPTION_KEY', 'abcdef0123456789abcdef0123456789'),
    fileKey: requireEnv('FILE_ENCRYPTION_KEY', 'fedcba9876543210fedcba9876543210'),
  },
  site: {
    timezone: requireEnv('SITE_TIMEZONE', 'America/Los_Angeles'),
    name: requireEnv('SITE_NAME', 'StudyRoomOps'),
  },
  server: {
    port: intEnv('API_PORT', 3001),
    nodeEnv: requireEnv('NODE_ENV', 'development'),
  },
  lockout: {
    maxAttempts: intEnv('ACCOUNT_LOCKOUT_ATTEMPTS', 5),
    windowMinutes: intEnv('ACCOUNT_LOCKOUT_WINDOW_MINUTES', 15),
    durationMinutes: intEnv('ACCOUNT_LOCKOUT_DURATION_MINUTES', 30),
  },
  spam: {
    maxPostsPerHour: intEnv('SPAM_MAX_POSTS_PER_HOUR', 5),
    maxPostsPerDay: intEnv('SPAM_MAX_POSTS_PER_DAY', 20),
  },
  vision: {
    enabled: process.env.VISION_WORKER_ENABLED === 'true',
    workerUrl: requireEnv('VISION_WORKER_URL', 'http://vision-worker:5000'),
    confidenceThreshold: parseFloat(process.env.FACE_CONFIDENCE_THRESHOLD || '0.82'),
  },
  wallet: {
    dailyRiskLimitCents: intEnv('DAILY_RISK_LIMIT_CENTS', 20000),
  },
  logLevel: requireEnv('LOG_LEVEL', 'info'),
} as const;

export function validateProductionSecrets(): void {
  if (config.server.nodeEnv !== 'production') return;

  const errors: string[] = [];
  if (config.jwt.secret.includes('dev-secret')) {
    errors.push('JWT_SECRET is using a default development value');
  }
  if (config.csrf.secret.includes('dev-csrf')) {
    errors.push('CSRF_SECRET is using a default development value');
  }
  if (config.encryption.fieldKey === 'abcdef0123456789abcdef0123456789') {
    errors.push('FIELD_ENCRYPTION_KEY is using a default development value');
  }
  if (config.encryption.fileKey === 'fedcba9876543210fedcba9876543210') {
    errors.push('FILE_ENCRYPTION_KEY is using a default development value');
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`[SECURITY] ${e}. Set a strong random value in .env or environment.`);
    }
    throw new Error(
      `Refusing to start in production with insecure secrets: ${errors.join('; ')}`
    );
  }
}

export function siteNow(): DateTime {
  return DateTime.now().setZone(config.site.timezone);
}

export function toSiteTime(utc: Date): DateTime {
  return DateTime.fromJSDate(utc).setZone(config.site.timezone);
}
