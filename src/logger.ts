import winston from 'winston'

const { combine, timestamp, colorize, errors, printf } = winston.format

const isProduction = process.env.NODE_ENV === 'production'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    ...(isProduction ? [] : [colorize({ all: true })]),
    printf(({ level, message, timestamp, stack }) =>
      stack
        ? `${timestamp} ${level}: ${message}\n${stack}`
        : `${timestamp} ${level}: ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
})
