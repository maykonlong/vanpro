import pino from 'pino';
import { env } from '../config/env';
import { getContext } from './request-context';

/**
 * Campos que NUNCA saem em log. A lista existe porque log de aplicacao vaza
 * mais dado pessoal que endpoint mal feito: fica em disco, vai pro agregador,
 * e ninguem revisa retencao. LGPD Art. 46.
 *
 * `censor` substitui em vez de remover: some o valor, fica o rastro de que
 * o campo existia - util em investigacao, inutil para quem roubou o arquivo.
 */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'ownerPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'resetToken',
  'twoFactorSecret',
  'secret',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'email',
  'cpf',
  'document',
  'phone',
  'address',
  'studentName',
  'dateOfBirth',
  '*.password',
  '*.token',
  '*.email',
  '*.document',
  '*.address',
  'body.password',
  'body.email',
  'body.document',
];

const PRETTY = { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } as const;

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'vanpro-api', env: env.APP_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    // Correlaciona linha de log com a request sem o chamador precisar lembrar.
    log: (obj) => {
      const ctx = getContext();
      if (!ctx) return obj;
      return { ...obj, requestId: ctx.requestId, tenantId: ctx.tenantId ?? undefined };
    },
  },
  // Saida colorida e conforto de desenvolvimento, nao requisito. Se o pacote
  // nao estiver instalado, cai para JSON em vez de derrubar o processo: um
  // enfeite de log nunca deve impedir a aplicacao de subir.
  transport: env.NODE_ENV === 'development' && temPinoPretty() ? PRETTY : undefined,
});

function temPinoPretty(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Identificador estavel e nao reversivel para correlacionar sem guardar o dado.
 * Ex.: saber que 40 tentativas de login vieram do mesmo e-mail, sem gravar o e-mail.
 */
export function pseudonymize(value: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto.createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 16);
}
