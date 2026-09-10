import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { runWithContext } from '../../lib/request-context';
import { logger } from '../../lib/logger';
import { registrarRequisicao } from '../../lib/metrics';

/**
 * Abre o contexto da requisicao (AsyncLocalStorage) o mais cedo possivel.
 *
 * Tudo que roda dentro dela — inclusive o guard multi-tenant do Prisma e o
 * logger — le daqui. Fora dessa janela, o guard falha fechado, que e
 * exatamente o comportamento desejado para codigo que esqueceu de abrir
 * contexto.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const headerId = req.get('x-request-id');
  // Id vindo do cliente e util para correlacionar, mas nao pode ser confiado
  // como texto livre: limitamos formato e tamanho antes de propagar pro log.
  const requestId =
    headerId && /^[A-Za-z0-9_-]{8,64}$/.test(headerId) ? headerId : crypto.randomUUID();

  res.setHeader('x-request-id', requestId);

  runWithContext({ tenantId: null, userId: null, role: null, requestId, unscoped: false }, () => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      // O PADRAO da rota, nunca o caminho concreto: `/students/<uuid>` criaria
      // uma serie temporal por aluno e transformaria /metrics num indice de
      // quem existe no sistema.
      registrarRequisicao(req.method, req.route?.path ?? req.path, res.statusCode, ms);
      logger.info(
        {
          method: req.method,
          path: req.route?.path ?? req.path,
          status: res.statusCode,
          durationMs: Math.round(ms),
        },
        'request',
      );
    });
    next();
  });
};
