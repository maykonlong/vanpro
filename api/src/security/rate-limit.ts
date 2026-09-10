import rateLimit, { type Options, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { redis, redisHealthy } from '../lib/redis';
import { logger } from '../lib/logger';
import { env } from '../config/env';
// Importado pelo efeito colateral da declaracao global de `req.auth`.
import '../http/middlewares/authenticate';

/**
 * Rate limit DISTRIBUIDO.
 *
 * Contador em memoria conta por processo: com 4 replicas, um limite de 5/15min
 * vira 20/15min sem ninguem perceber. Por isso o store e Redis.
 *
 * E `fail-open` de proposito. A alternativa a "limite frouxo enquanto o Redis
 * esta fora" seria "todo mundo bloqueado" — um limitador que falha fechado
 * transforma a queda de uma dependencia auxiliar em apagao do produto inteiro.
 *
 * "Fail-open" precisa valer nos DOIS momentos, e nao so no papel:
 *
 *   no boot     — a primeira versao deste arquivo montava o RedisStore no
 *                 import, antes de o Redis conectar. O construtor do store
 *                 dispara um comando na hora, o comando estourava, e a API
 *                 inteira morria no boot por causa do limitador. O contrario
 *                 exato do que "fail-open" promete.
 *   em execucao — erro do store vira `next()` com aviso no log, nunca 500.
 */

function makeStore(prefix: string): Store | undefined {
  // Em teste o store e memoria: a suite nao deve depender de infraestrutura
  // externa para exercitar regra de negocio.
  if (env.NODE_ENV === 'test') return undefined;

  try {
    return new RedisStore({
      prefix: `rl:${prefix}:`,
      // Erro do Redis precisa virar promise rejeitada, e nao excecao sincrona:
      // `redis.call` com `enableOfflineQueue: false` LANCA na hora quando a
      // conexao nao esta pronta, e o construtor do RedisStore ja dispara um
      // comando. Sem este try/catch, o boot inteiro morria.
      sendCommand: (...args: string[]) => {
        try {
          return redis.call(...(args as [string, ...string[]])) as Promise<never>;
        } catch (err) {
          return Promise.reject(err) as Promise<never>;
        }
      },
    });
  } catch (err) {
    logger.warn({ err, prefix }, 'rate limit caiu para contagem em memória');
    return undefined;
  }
}

/**
 * O store do Redis so e criado quando a conexao ja esta pronta, e apenas uma
 * vez. Antes disso a contagem e em memoria — frouxa entre replicas por alguns
 * segundos no boot, o que e infinitamente melhor que a API nao subir.
 */
function lazyStore(prefix: string) {
  let store: Store | undefined;
  let tentado = false;
  return () => {
    if (!tentado && redisHealthy()) {
      tentado = true;
      store = makeStore(prefix);
      if (store) logger.info({ prefix }, 'rate limit usando Redis');
    }
    return store;
  };
}

/**
 * Chave do limite. Preferimos o usuario autenticado ao IP: NAT de escola e de
 * operadora poe centenas de pais atras do mesmo endereco, e limitar por IP
 * puniria todos por causa de um.
 */
function keyGenerator(req: Request): string {
  const userId = req.auth?.userId;
  if (userId) return `u:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

function build(prefix: string, opts: Partial<Options>): RequestHandler {
  const obterStore = lazyStore(prefix);
  const emMemoria = criarLimiter(prefix, opts, undefined);
  let comRedis: RequestHandler | null = null;

  return (req: Request, res: Response, next: NextFunction) => {
    const store = obterStore();
    if (store && !comRedis) comRedis = criarLimiter(prefix, opts, store);
    const limiter = comRedis ?? emMemoria;

    limiter(req, res, (err?: unknown) => {
      if (!err) return next();
      logger.warn({ err, prefix, path: req.path }, 'store do rate limit falhou — liberando a requisição');
      next();
    });
  };
}

function criarLimiter(prefix: string, opts: Partial<Options>, store: Store | undefined): RequestHandler {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    store,
    handler: (req, res) => {
      logger.warn({ path: req.path, chave: keyGenerator(req) }, `rate limit "${prefix}" acionado`);
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Muitas requisições em pouco tempo. Aguarde e tente novamente.',
        },
      });
    },
    ...opts,
  });
}

/** Trafego geral autenticado. */
export const globalLimiter = build('global', {
  windowMs: 15 * 60 * 1000,
  limit: 1_000,
});

/** Login, 2FA e refresh: superficie de forca bruta. */
export const authLimiter = build('auth', {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true, // quem acerta a senha nao gasta cota
  /**
   * Requisicao que nem chega a apresentar credencial nao e tentativa.
   *
   * Um `POST /auth/refresh` sem cookie de refresh so pode dar 401 — nao ha o
   * que adivinhar ali. Contando essas, qualquer trafego anonimo drenava a cota
   * de forca bruta do IP e trancava o login de quem tinha a senha certa. A
   * defesa contra adivinhacao continua inteira: com cookie presente, conta.
   */
  skip: (req) => req.path.endsWith('/refresh') && !req.cookies?.refresh_token,
});

/** Cadastro publico e recuperacao de senha: superficie de abuso e enumeracao. */
export const publicWriteLimiter = build('public-write', {
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

/** Upload: caro em I/O e em disco. */
export const uploadLimiter = build('upload', {
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

/** Webhook do gateway: volume legitimo alto, mas nao ilimitado. */
export const webhookLimiter = build('webhook', {
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req: Request) => `ip:${req.ip ?? 'unknown'}`,
});
