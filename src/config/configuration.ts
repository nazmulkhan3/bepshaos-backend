export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  cors: {
    origins: process.env.CORS_ORIGINS,
  },
  rateLimit: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expiresInSeconds: parseInt(process.env.OTP_EXPIRES_IN_SECONDS || '300', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
  },
  email: {
    provider: process.env.EMAIL_PROVIDER || 'console',
    devExposeOtp: process.env.DEV_EXPOSE_OTP === 'true',
    from: process.env.EMAIL_FROM,
    fromName: process.env.EMAIL_FROM_NAME,
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
    },
  },
});
