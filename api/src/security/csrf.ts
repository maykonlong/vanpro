import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { env } from '../config/env';

/**
 * CSRF por double-submit assinado.
 *
 * A sessao vive em cookie httpOnly — o que e certo contra XSS, mas
 * automaticamente reintroduz CSRF: o navegador anexa o cookie mesmo num POST
 * disparado por outro site. `SameSite=Strict` cobre a maioria dos casos, e
 * ainda assim nao e defesa suficiente sozinha (subdominio comprometido,
 * navegador antigo, redirecionamento de gateway).
 *
 * Aqui: cookie legivel por JS com um token assinado por HMAC + o mesmo valor
 * repetido no header `x-csrf-token`. Site atacante consegue disparar a
 * requisicao com cookie, mas nao consegue LER o cookie para copiar no header.
 */

const COOKIE_NAME = 'csrf_token';
const HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sign(value: string): string {
  return crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(value).digest('base64url');
}

export function issueCsrfToken(res: Response): string {
  const raw = crypto.randomBytes(32).toString('base64url');
  const token = `${raw}.${sign(raw)}`;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: false, // precisa ser legivel pelo front para reenviar no header
    secure: env.APP_ENV !== 'local',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
}

function valid(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const [raw, sig] = token.split('.');
  if (!raw || !sig) return false;
  const expected = sign(raw);
  // Comparacao em tempo constante: `===` em segredo vaza posicao do primeiro
  // byte errado para quem consegue medir.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Cookies cuja mera presenca faz o navegador autenticar sozinho a requisicao. */
const AMBIENT_CREDENTIALS = ['access_token', 'refresh_token'];

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  // CSRF so existe quando o navegador anexa credencial sozinho. Requisicao sem
  // NENHUM cookie de sessao nao tem o que ser sequestrado — e exigir token nela
  // quebraria justamente login, cadastro e webhook, que sao os primeiros
  // contatos do cliente com a API e ainda nao receberam cookie algum.
  //
  // `/refresh` continua protegido: ele viaja com o refresh_token.
  const temCredencialAmbiente = AMBIENT_CREDENTIALS.some((c) => Boolean(req.cookies?.[c]));
  if (!temCredencialAmbiente) return next();

  const cookieToken = req.cookies?.[COOKIE_NAME];
  const headerToken = req.get(HEADER_NAME);

  if (!cookieToken || !headerToken) {
    return next(
      new AppError(403, 'CSRF_TOKEN_MISSING', 'Token de segurança ausente. Recarregue a página e tente de novo.'),
    );
  }

  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!matches || !valid(cookieToken)) {
    return next(
      new AppError(403, 'CSRF_TOKEN_INVALID', 'Token de segurança inválido. Recarregue a página e tente de novo.'),
    );
  }

  next();
}

export const csrf = { COOKIE_NAME, HEADER_NAME, issueCsrfToken, csrfProtection };
