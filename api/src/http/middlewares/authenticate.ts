import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { runUnscoped, getContext } from '../../lib/request-context';
import { verifyAccessToken, cookieNames, clearSessionCookies } from '../../modules/auth/session.service';
import { Errors, AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

export interface AuthState {
  userId: string;
  role: string;
  tenantId: string | null;
  sessionId: string;
  permissions: {
    canManageFinance: boolean;
    canManageHR: boolean;
    canManageRoutes: boolean;
  };
  contractStatus: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthState;
    }
  }
}

const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

function ehLeitura(req: Request): boolean {
  return METODOS_DE_LEITURA.has(req.method);
}

/**
 * Escritas que continuam permitidas com a empresa suspensa.
 *
 * O criterio nao e "o que da menos trabalho liberar", e sim: sem esta escrita,
 * alguem fica sem protecao ou perde um direito.
 *
 *   ponto      — a jornada de quem trabalhou naquele dia e registro trabalhista.
 *                Nao registrar apaga prova a favor do empregado.
 *   check-in   — e o que diz ao responsavel que a crianca embarcou e desceu.
 *   incidente  — aviso de emergencia para as familias da rota.
 *   privacidade— direito do titular (LGPD Art. 18) nao depende de o cliente
 *                estar em dia com a mensalidade do SaaS.
 *   sessao     — trocar a propria senha e encerrar sessao seguem valendo.
 */
const ESCRITAS_ESSENCIAIS: RegExp[] = [
  /^\/api\/v1\/timecards\/punch$/,
  /^\/api\/v1\/students\/[^/]+\/checkin$/,
  /^\/api\/v1\/crm\/incidents\/broadcast$/,
  /^\/api\/v1\/privacy\//,
  /^\/api\/v1\/auth\//,
];

function ehOperacaoEssencial(req: Request): boolean {
  const caminho = req.originalUrl.split('?')[0] ?? '';
  return ESCRITAS_ESSENCIAIS.some((re) => re.test(caminho));
}

/**
 * Autenticacao.
 *
 * Alem de conferir a assinatura do JWT, confirma no banco que a SESSAO ainda
 * vive e que o VINCULO do usuario com a empresa continua ativo. Sem isso,
 * demitir alguem so teria efeito quando o access token expirasse — ate 15
 * minutos de acesso a dados da empresa depois do desligamento.
 *
 * O custo e uma consulta indexada por request. Vale o preco.
 */
export const authenticate: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.[cookieNames.ACCESS_COOKIE];
  if (!token || typeof token !== 'string') {
    return next(Errors.unauthorized('Faça login para continuar.'));
  }

  try {
    const claims = verifyAccessToken(token);

    const session = await runUnscoped('auth-session-check', () =>
      prisma.session.findUnique({
        where: { id: claims.sid },
        select: { revokedAt: true, expiresAt: true, userId: true },
      }),
    );

    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub) {
      clearSessionCookies(res);
      return next(Errors.unauthorized('Sessão encerrada. Entre novamente.'));
    }

    const user = await runUnscoped('auth-user-check', () =>
      prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, role: true, tenantId: true, isActive: true },
      }),
    );

    if (!user || !user.isActive) {
      clearSessionCookies(res);
      return next(Errors.forbidden('Este acesso foi desativado.'));
    }

    // A role vem do BANCO, nao do token. Token so prova quem e; o que a pessoa
    // pode fazer e estado atual, e promover/rebaixar precisa valer na hora.
    let permissions: AuthState['permissions'] = {
      canManageFinance: user.role === 'OWNER' || user.role === 'SUPER_ADMIN',
      canManageHR: user.role === 'OWNER' || user.role === 'SUPER_ADMIN',
      canManageRoutes: user.role === 'OWNER' || user.role === 'SUPER_ADMIN',
    };
    let contractStatus = 'ACTIVE';

    if (user.tenantId) {
      const contract = await runUnscoped('auth-contract-check', () =>
        prisma.userCompany.findFirst({
          where: { userId: user.id, companyId: user.tenantId! },
          select: {
            status: true,
            canManageFinance: true,
            canManageHR: true,
            canManageRoutes: true,
          },
        }),
      );

      if (!contract) {
        clearSessionCookies(res);
        return next(Errors.forbidden('Seu vínculo com esta empresa não está ativo.'));
      }

      contractStatus = contract.status;
      if (contract.status === 'SUSPENDED') {
        return next(Errors.forbidden('Seu acesso a esta empresa está suspenso.'));
      }

      if (user.role === 'MANAGER') {
        permissions = {
          canManageFinance: contract.canManageFinance,
          canManageHR: contract.canManageHR,
          canManageRoutes: contract.canManageRoutes,
        };
      }

      const company = await runUnscoped('auth-company-check', () =>
        prisma.company.findUnique({
          where: { id: user.tenantId! },
          select: { tenantStatus: true, name: true },
        }),
      );

      if (company?.tenantStatus === 'SUSPENDED' && user.role !== 'SUPER_ADMIN') {
        // Empresa suspensa vira SOMENTE LEITURA, e nao porta fechada.
        //
        // A versao anterior recusava toda requisicao autenticada, inclusive GET,
        // apesar de o proprio comentario prometer "leitura continua". Na pratica
        // isso significava que, no dia em que o teste do dono vencia, a mae
        // deixava de ver onde estava a van com o filho dentro, e o dono perdia
        // ate a tela que mostra a fatura que ele precisa pagar para voltar.
        //
        // Cobranca e um problema entre o VanPro e o dono da frota. Ela nao pode
        // deixar uma crianca sem acompanhamento nem apagar a jornada de quem
        // trabalhou naquele dia.
        if (!ehLeitura(req) && !ehOperacaoEssencial(req)) {
          return next(Errors.suspended(company.name));
        }
      }
    }

    req.auth = {
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
      sessionId: claims.sid,
      permissions,
      contractStatus,
    };

    // Publica o tenant no contexto: e daqui que o guard do Prisma le.
    const ctx = getContext();
    if (ctx) {
      ctx.tenantId = user.tenantId;
      ctx.userId = user.id;
      ctx.role = user.role;
    }

    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    logger.error({ err }, 'falha inesperada na autenticação');
    return next(Errors.unauthorized('Não foi possível validar sua sessão.'));
  }
};

/**
 * Autenticacao opcional: popula `req.auth` se houver sessao valida, mas nao
 * bloqueia. Usado em rotas publicas que mudam de comportamento quando ha login.
 */
export const authenticateOptional: RequestHandler = async (req, res, next) => {
  if (!req.cookies?.[cookieNames.ACCESS_COOKIE]) return next();
  authenticate(req, res, (err?: any) => (err ? next() : next()));
};

// ---------------------------------------------------------------------------
// Autorizacao
// ---------------------------------------------------------------------------

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Exige uma das roles. Toda rota autenticada passa por aqui — nao ha default aberto. */
export function requireRole(...allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(Errors.unauthorized());

    if (!allowed.includes(auth.role) && auth.role !== 'SUPER_ADMIN') {
      logger.warn({ role: auth.role, path: req.originalUrl }, 'acesso negado por role');
      return next(Errors.forbidden());
    }

    // Modo arquivo (funcionario desligado): historico continua legivel para
    // defesa em processo trabalhista, escrita para.
    if (auth.contractStatus === 'ARCHIVED' && WRITE_METHODS.has(req.method)) {
      return next(
        Errors.forbidden(
          'Seu vínculo está arquivado. Você pode consultar o histórico, mas não registrar novas alterações.',
        ),
      );
    }

    next();
  };
}

/** Feature flag granular para MANAGER. OWNER e SUPER_ADMIN passam sempre. */
export function requirePermission(flag: keyof AuthState['permissions']): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(Errors.unauthorized());
    if (auth.role === 'OWNER' || auth.role === 'SUPER_ADMIN') return next();
    if (auth.permissions[flag]) return next();

    logger.warn({ role: auth.role, flag, path: req.originalUrl }, 'acesso negado por permissão granular');
    return next(Errors.forbidden('Você não tem essa permissão administrativa nesta empresa.'));
  };
}

/**
 * Rotas de plataforma: so SUPER_ADMIN, e roda fora do escopo de tenant.
 * Explicito porque cruzar empresas nunca pode ser efeito colateral.
 */
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (req.auth?.role !== 'SUPER_ADMIN') return next(Errors.forbidden());
  const ctx = getContext();
  if (ctx) ctx.unscoped = true;
  next();
};
