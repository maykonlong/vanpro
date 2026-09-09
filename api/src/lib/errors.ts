/**
 * Erros de aplicacao com codigo estavel.
 *
 * A mensagem que vai pro cliente e SEMPRE a de `publicMessage` - detalhe tecnico
 * (stack, SQL, nome de coluna) fica no log. Vazar o erro interno na resposta e
 * como publicar o mapa do sistema para quem esta sondando.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly details?: unknown,
    readonly logLevel: 'warn' | 'error' = 'warn',
  ) {
    super(publicMessage);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Não autenticado.') => new AppError(401, 'UNAUTHENTICATED', msg),
  invalidCredentials: () =>
    // Mesma mensagem para usuario inexistente e senha errada: a diferenca entre
    // as duas e uma lista de e-mails validos entregue de graca.
    new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.'),
  forbidden: (msg = 'Você não tem permissão para esta ação.') =>
    new AppError(403, 'FORBIDDEN', msg),
  notFound: (what = 'Recurso') => new AppError(404, 'NOT_FOUND', `${what} não encontrado.`),
  conflict: (msg: string) => new AppError(409, 'CONFLICT', msg),
  validation: (details: unknown) =>
    new AppError(422, 'VALIDATION_ERROR', 'Dados inválidos.', details),
  rateLimited: (msg = 'Muitas requisições. Tente novamente em instantes.') =>
    new AppError(429, 'RATE_LIMITED', msg),
  accountLocked: (until: Date) =>
    new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Conta temporariamente bloqueada por tentativas de acesso. Libera em ${until.toLocaleString('pt-BR')}.`,
    ),
  passwordExpired: () =>
    new AppError(403, 'PASSWORD_EXPIRED', 'Sua senha expirou. Redefina para continuar.'),
  twoFactorRequired: () => new AppError(401, 'TWO_FACTOR_REQUIRED', 'Código de 2 fatores exigido.'),
  suspended: (companyName: string) =>
    new AppError(
      402,
      'ACCOUNT_SUSPENDED',
      `A conta da empresa "${companyName}" está suspensa. Regularize o plano para voltar a operar.`,
    ),
  featureDisabled: (feature: string) =>
    new AppError(
      503,
      'FEATURE_DISABLED',
      `A integração "${feature}" não está configurada neste ambiente. ` +
        `Configure as credenciais para habilitar - o sistema não simula a operação.`,
    ),
  planLimit: (what: string, limit: number) =>
    new AppError(
      402,
      'PLAN_LIMIT_REACHED',
      `Seu plano permite até ${limit} ${what}. Faça upgrade para cadastrar mais.`,
    ),
  internal: (detail?: unknown) =>
    new AppError(500, 'INTERNAL_ERROR', 'Erro interno. A equipe foi notificada.', detail, 'error'),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
