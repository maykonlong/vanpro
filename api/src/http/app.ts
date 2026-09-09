import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';

import { env, origemPermitida } from '../config/env';
import { requestContext } from './middlewares/context';
import { sentinela } from '../security/sentinela';
import { csrfProtection } from '../security/csrf';
import { globalLimiter } from '../security/rate-limit';
import { errorHandler, notFoundHandler } from './error-handler';
import { buildRouter } from './routes';
import { CorsOriginError } from './cors-error';
import { construirSpec } from './openapi';

/**
 * Montagem da aplicacao.
 *
 * A ORDEM aqui e regra de seguranca, nao estilo. Na versao anterior o router de
 * alunos era montado uma vez sem autenticacao e outra com — e como o Express
 * casa o primeiro, a API de criancas ficou publica. Por isso agora existe UM
 * unico ponto de montagem de rotas (`buildRouter`) e nenhuma rota e registrada
 * fora dele.
 */
export function createApp(): Express {
  const app = express();

  // Atras de nginx/ALB: sem isso `req.ip` e o do proxy e o rate limit vira global.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestContext);
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", env.FRONTEND_URL],
          // A API so serve JSON e o Swagger. Sem script inline arbitrario.
          scriptSrc: ["'self'"],
          // Sem `unsafe-inline`: a API responde JSON, nao HTML com estilo.
          // O Swagger, que precisa de estilo inline, tem CSP proprio abaixo e
          // so existe fora de producao — afrouxar o global por causa dele
          // enfraqueceria toda a superficie por uma pagina de documentacao.
          styleSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      hsts: env.APP_ENV === 'local' ? false : { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );

  // Permissions-Policy: nega explicitamente o que a API nao usa. Header que
  // auditoria externa procura e que quase ninguem envia.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), interest-cohort=()',
    );
    next();
  });

  app.use(
    cors({
      origin: (origin, cb) => {
        // Requisicao sem Origin (curl, health check, app nativo) passa; navegador
        // so passa se a origem estiver na lista.
        if (!origin || origemPermitida(origin)) return cb(null, true);
        cb(new CorsOriginError(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-csrf-token', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );

  // O webhook precisa do corpo CRU para conferir a assinatura HMAC: JSON
  // reserializado muda bytes e a assinatura nunca fecha.
  app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '256kb' }));

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());

  app.use(sentinela());
  app.use(csrfProtection);
  app.use('/api/', globalLimiter);

  const apiRouter = buildRouter();

  if (env.APP_ENV !== 'production') {
    app.use(
      '/api/v1/docs',
      helmet.contentSecurityPolicy({
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // O Swagger UI injeta estilo e um bootstrap inline. O afrouxamento
          // fica preso a esta rota, que nao existe em producao.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(construirSpec()),
    );
  }

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
