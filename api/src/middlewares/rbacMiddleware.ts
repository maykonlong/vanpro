import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Middleware para checagem estrita de Roles (RBAC)
 * Garante que apenas papéis autorizados possam acessar a rota.
 * 
 * Ex: router.post('/', requireRole(['OWNER', 'SUPER_ADMIN']), createVehicle)
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // O req.user é populado no middleware de autenticação (verifySession/JWT)
      const user = (req as any).user;

      if (!user) {
        logger.warn(`Tentativa de acesso sem usuário na rota ${req.originalUrl}`);
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      }

      if (!allowedRoles.includes(user.role)) {
        logger.warn(`Acesso negado (RBAC): ${user.email} (Role: ${user.role}) tentou acessar ${req.originalUrl}`);
        return res.status(403).json({ error: 'Você não tem permissão para realizar esta ação.' });
      }

      // Verificação de Contrato (Fase 17 - Histórico / Grace Period)
      // Supondo que req.user traga contractStatus ('ACTIVE', 'ARCHIVED', 'SUSPENDED') no token
      if (user.contractStatus === 'ARCHIVED' || user.contractStatus === 'SUSPENDED') {
        const isReadOnlyRequest = req.method === 'GET';
        
        if (!isReadOnlyRequest) {
          logger.warn(`Modo Somente Leitura (Grace Period): O usuário ${user.email} tentou realizar uma ação de escrita (${req.method}) mas está ${user.contractStatus}.`);
          return res.status(403).json({ 
            error: 'Modo Arquivo Ativo. Você só tem permissão para visualizar dados históricos. Modificações estão bloqueadas pela nova empresa.' 
          });
        }
      }

      next();
    } catch (error) {
      logger.error(`Erro no middleware RBAC: ${(error as Error).message}`);
      res.status(500).json({ error: 'Erro interno de permissão.' });
    }
  };
};
