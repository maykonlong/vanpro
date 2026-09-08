import { prisma } from '../prisma';
import { logger } from '../utils/logger';

interface AuditLogPayload {
  userId: string;
  companyId?: string;
  action: string;
  description: string;
  ipAddress?: string;
}

/**
 * Cria um registro permanente no Banco de Dados.
 * Ideal para rastrear falhas, fraudes ou ações que podem gerar disputas jurídicas.
 */
export const createAuditLog = async (payload: AuditLogPayload) => {
  try {
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        companyId: payload.companyId,
        action: payload.action,
        description: payload.description,
        ipAddress: payload.ipAddress
      }
    });
    
    // Além de salvar no banco de dados, também loga via Pino para centralização de logs (ex: DataDog/ELK)
    logger.info(`[AUDIT] Action: ${payload.action} | User: ${payload.userId} | IP: ${payload.ipAddress || 'unknown'}`);
  } catch (error) {
    // Se o audit log falhar, NUNCA travar a execução principal, apenas registrar no Sentry/Pino
    logger.error(`❌ Falha Crítica ao gravar Audit Log: ${(error as Error).message}`);
  }
};
