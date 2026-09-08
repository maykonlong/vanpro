import winston from 'winston';
import 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';

const isDev = process.env.NODE_ENV !== 'production';

// Configuração do formato geral (com ofuscamento simples de LGPD)
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json() // Arquivos sempre salvam em JSON estruturado
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `[${timestamp}] ${level}: ${message} ${stack || ''}`;
  })
);

// 1. Logger Base do Sistema
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.DailyRotateFile({
      dirname: path.join(__dirname, '../../logs/system'),
      filename: 'system-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '7d', // Auto-Purge de 7 Dias
      level: 'info'
    })
  ]
});

if (isDev) {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// 2. Logger Isolado por Tenant (Cliente B2B)
// Garante que uma empresa tenha seus próprios arquivos de log separados.
export const getTenantLogger = (tenantId: string) => {
  const tenantDir = path.join(__dirname, `../../logs/tenants/${tenantId}`);
  
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }

  const tenantLogger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
      new winston.transports.DailyRotateFile({
        dirname: tenantDir,
        filename: 'audit-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '7d', // Auto-Purge de 7 Dias
      })
    ]
  });

  if (isDev) {
    tenantLogger.add(new winston.transports.Console({
      format: consoleFormat
    }));
  }

  return tenantLogger;
};
