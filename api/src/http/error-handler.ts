import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, Errors, isAppError } from '../lib/errors';
import { TenantContextMissingError, CrossTenantWriteError } from '../lib/prisma';
import { logger } from '../lib/logger';
import { audit } from '../lib/audit';
import { getContext } from '../lib/request-context';
import { CorsOriginError } from './cors-error';
import { registrarViolacaoTenant } from '../lib/metrics';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${req.path} não existe.`));
};

/**
 * Handler unico de erro.
 *
 * Traduz erro tecnico em resposta util sem entregar o mapa do sistema: o
 * cliente recebe codigo estavel + mensagem em portugues; stack, SQL e nome de
 * constraint ficam no log. Erro 500 nunca ecoa a mensagem original.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = getContext()?.requestId;

  // Violacao de tenant e incidente de seguranca, nao "erro do usuario".
  if (err instanceof TenantContextMissingError) {
    registrarViolacaoTenant();
    logger.error({ err: err.message, path: req.originalUrl }, 'query sem contexto de tenant');
    void audit({
      action: 'SECURITY_TENANT_VIOLATION',
      description: `Consulta sem contexto de tenant em ${req.method} ${req.path}: ${err.message}`,
      ipAddress: req.ip ?? null,
    });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno. A equipe foi notificada.', requestId },
    });
  }

  if (err instanceof CrossTenantWriteError) {
    registrarViolacaoTenant();
    logger.error({ err: err.message, path: req.originalUrl }, 'tentativa de escrita cruzada entre empresas');
    void audit({
      action: 'SECURITY_TENANT_VIOLATION',
      description: `Escrita cruzada bloqueada em ${req.method} ${req.path}: ${err.message}`,
      ipAddress: req.ip ?? null,
    });
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Operação não permitida para esta empresa.', requestId },
    });
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message }));
    return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details, requestId } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: unicidade. Nao dizemos QUAL registro colidiu — em multi-tenant isso
    // confirma a existencia de dado de outra empresa.
    if (err.code === 'P2002') {
      const alvo = (err.meta as { target?: unknown } | undefined)?.target;
      logger.warn({ target: alvo, path: req.originalUrl }, 'violação de unicidade');
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'Já existe um registro com esses dados.', requestId },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Registro não encontrado.', requestId } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        error: {
          code: 'FOREIGN_KEY_CONFLICT',
          message: 'Existe outro registro dependendo deste. Remova os vínculos antes.',
          requestId,
        },
      });
    }
    logger.error({ err, code: err.code, path: req.originalUrl }, 'erro conhecido do prisma');
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.', requestId } });
  }

  if (err instanceof CorsOriginError) {
    logger.warn({ origin: err.origin, path: req.originalUrl }, 'origem recusada pelo CORS');
    return res.status(err.status).json({
      error: { code: err.code, message: err.publicMessage, requestId },
    });
  }

  if (isAppError(err)) {
    if (err.logLevel === 'error') {
      logger.error({ err, code: err.code, path: req.originalUrl }, err.publicMessage);
    } else {
      logger.warn({ code: err.code, path: req.originalUrl }, err.publicMessage);
    }
    return res.status(err.status).json({
      error: { code: err.code, message: err.publicMessage, details: err.details, requestId },
    });
  }

  // Corpo JSON malformado: o body-parser do Express marca assim.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Corpo da requisição não é um JSON válido.', requestId } });
  }

  // Multer sinaliza estouro de tamanho por um campo `code` proprio.
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Arquivo acima do limite permitido.', requestId } });
  }

  logger.error({ err, path: req.originalUrl }, 'erro não tratado');
  const fallback = Errors.internal();
  return res.status(fallback.status).json({
    error: { code: fallback.code, message: fallback.publicMessage, requestId },
  });
};
