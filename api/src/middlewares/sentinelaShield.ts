import { Request, Response, NextFunction } from 'express';
import { createAuditLog } from '../services/auditLogger';
import { logger } from '../utils/logger';

/**
 * SENTINELA SHIELD (WAF Local)
 * Middleware de Defesa Ativa inspirado no auditor de segurança "Sentinela".
 * Bloqueia padrões conhecidos de SQL Injection, NoSQL Injection e Cross-Site Scripting (XSS).
 */
export const sentinelaShield = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payloadString = JSON.stringify({ body: req.body, query: req.query, params: req.params });

      // Padrões agressivos baseados nos relatórios do Sentinela
      const sqlInjectionPatterns = /(\%27)|(\')|(\-\-)|(\%23)|(#)/i; // Aspas simples, traços de comentário
      const noSqlInjectionPatterns = /\$where|\$ne|\$gt|\$lt/i; // Operadores MongoDB
      const xssPatterns = /(<script.*?>.*?<\/script>)|(<.*?on\w+?=.*?>)/i; // Tags script e event handlers (onload, onerror)

      const isSqli = sqlInjectionPatterns.test(payloadString);
      const isNoSqli = noSqlInjectionPatterns.test(payloadString);
      const isXss = xssPatterns.test(payloadString);

      if (isSqli || isNoSqli || isXss) {
        const attackType = isSqli ? 'SQL_INJECTION' : isNoSqli ? 'NOSQL_INJECTION' : 'XSS';
        
        logger.warn(`🛡️ SENTINELA SHIELD BLOQUEOU ATAQUE: ${attackType} do IP ${req.ip}`);

        // O req.user pode não existir ainda dependendo de onde o middleware for injetado, 
        // mas tentamos registrar quem tentou hackear se já estiver logado.
        const userId = (req as any).user?.id || 'UNAUTHENTICATED_ATTACKER';
        const companyId = (req as any).user?.companyId || null;

        await createAuditLog({
          userId,
          companyId,
          action: `SECURITY_BREACH_ATTEMPT_${attackType}`,
          description: `Tentativa de ataque bloqueada pelo Sentinela WAF na rota ${req.originalUrl}. Payload: ${payloadString.substring(0, 100)}`,
          ipAddress: req.ip
        });

        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'Padrão suspeito detectado pela Firewall Sentinela. O incidente foi registrado.' 
        });
      }

      next();
    } catch (error) {
      logger.error(`Erro no Sentinela Shield: ${(error as Error).message}`);
      next(); // Em caso de falha no firewall, permite passar ou lança 500 dependendo do rigor
    }
  };
};
