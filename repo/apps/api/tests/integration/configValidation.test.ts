describe('validateProductionSecrets', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('throws in production mode when JWT_SECRET is a default dev value', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-64-chars-long-for-security';
    process.env.CSRF_SECRET = 'strong-production-csrf-secret-value';
    process.env.FIELD_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    process.env.FILE_ENCRYPTION_KEY = 'f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1';

    // Re-import to pick up new env
    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).toThrow(/insecure secrets/);
    expect(() => validateProductionSecrets()).toThrow(/JWT_SECRET/);
  });

  it('throws in production mode when CSRF_SECRET is a default dev value', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'strong-production-jwt-secret-that-is-at-least-64-characters-long-for-real';
    process.env.CSRF_SECRET = 'dev-csrf-secret-change-in-production';
    process.env.FIELD_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    process.env.FILE_ENCRYPTION_KEY = 'f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1';

    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).toThrow(/insecure secrets/);
    expect(() => validateProductionSecrets()).toThrow(/CSRF_SECRET/);
  });

  it('throws in production mode when FIELD_ENCRYPTION_KEY is a default dev value', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'strong-production-jwt-secret-that-is-at-least-64-characters-long-for-real';
    process.env.CSRF_SECRET = 'strong-production-csrf-secret-value';
    process.env.FIELD_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789';
    process.env.FILE_ENCRYPTION_KEY = 'f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1';

    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).toThrow(/insecure secrets/);
    expect(() => validateProductionSecrets()).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('throws in production mode when FILE_ENCRYPTION_KEY is a default dev value', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'strong-production-jwt-secret-that-is-at-least-64-characters-long-for-real';
    process.env.CSRF_SECRET = 'strong-production-csrf-secret-value';
    process.env.FIELD_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    process.env.FILE_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210';

    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).toThrow(/insecure secrets/);
    expect(() => validateProductionSecrets()).toThrow(/FILE_ENCRYPTION_KEY/);
  });

  it('does not throw in production mode when all secrets are strong', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'strong-production-jwt-secret-that-is-at-least-64-characters-long-for-real';
    process.env.CSRF_SECRET = 'strong-production-csrf-secret-value';
    process.env.FIELD_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    process.env.FILE_ENCRYPTION_KEY = 'f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1';

    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).not.toThrow();
  });

  it('does not throw in development mode even with default secrets', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-64-chars-long-for-security';
    process.env.CSRF_SECRET = 'dev-csrf-secret-change-in-production';
    process.env.FIELD_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789';
    process.env.FILE_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210';

    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).not.toThrow();
  });

  it('does not throw in test mode even with default secrets', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-64-chars-long-for-security';

    jest.resetModules();
    const { validateProductionSecrets } = await import('../../src/config/index');

    expect(() => validateProductionSecrets()).not.toThrow();
  });
});
