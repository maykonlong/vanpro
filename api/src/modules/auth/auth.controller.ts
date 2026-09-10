import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
// Os tipos vinham do pacote `@simplewebauthn/types`, descontinuado; a partir da
// v13 o proprio `server` os reexporta.

import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors, AppError } from '../../lib/errors';
import { logger, pseudonymize } from '../../lib/logger';
import { env } from '../../config/env';
import { validate, strongPassword, emailField, uuidParam } from '../../http/validate';
import { authenticate } from '../../http/middlewares/authenticate';
import { issueCsrfToken } from '../../security/csrf';
import { authLimiter, publicWriteLimiter } from '../../security/rate-limit';
import {
  issueSession,
  refreshSession,
  revokeFamily,
  revokeAllUserSessions,
  clearSessionCookies,
  vinculosAtivos,
  switchCompany,
  papelNaEmpresa,
} from './session.service';
import {
  hashPassword,
  verifyPassword,
  dummyCompare,
  isPasswordExpired,
  generateRecoveryCodes,
  serializeRecoveryHashes,
  parseRecoveryHashes,
  consumeRecoveryCode,
} from './password.service';

/**
 * GUARDA: rota-publica-intencional
 *
 * Identidade, nao recurso de empresa: login, refresh e recuperacao
 * precisam responder antes de existir sessao. As rotas que exigem sessao usam
 * `authenticate` individualmente, e /sessions filtra pelo proprio usuario.
 */

/**
 * Autenticacao.
 *
 * Duas obsessoes governam este arquivo:
 *
 *   1. Nao entregar a lista de e-mails cadastrados. Login, recuperacao de senha
 *      e desafio de 2FA respondem igual para conta que existe e conta que nao
 *      existe — mesma mensagem, mesmo status e mesmo tempo de resposta.
 *   2. Token nao passa pelo corpo. Access e refresh vivem em cookie httpOnly;
 *      o que volta no JSON e o CSRF, que precisa mesmo ser lido pelo front.
 */

const router = Router();

const LOCK_THRESHOLD = 5;
const LOCK_MAX_MINUTES = 60;
const RESET_TOKEN_TTL_MINUTES = 15;
const CHALLENGE_TTL_SECONDS = 5 * 60;

const CHALLENGE_AUDIENCE = 'vanpro-2fa';
const WEBAUTHN_AUDIENCE = 'vanpro-webauthn';

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

function publicUser(u: PublicUser) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

/**
 * Token de passagem entre duas etapas do login (2FA, WebAuthn).
 * Audience propria: sem isso, um desafio de 2FA seria aceito como access token
 * por `verifyAccessToken` e o segundo fator viraria decoracao.
 */
function signStepToken(payload: Record<string, unknown>, audience: string): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: CHALLENGE_TTL_SECONDS,
    issuer: 'vanpro-api',
    audience,
    algorithm: 'HS256',
  });
}

function verifyStepToken(token: string, audience: string, purpose: string): jwt.JwtPayload {
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'vanpro-api',
      audience,
      algorithms: ['HS256'],
    });
    if (typeof claims === 'string' || claims.purpose !== purpose) {
      throw new Error('propósito divergente');
    }
    return claims;
  } catch {
    throw Errors.unauthorized('Desafio expirado ou inválido. Faça login novamente.');
  }
}

/**
 * Bloqueio progressivo. A partir da 5a falha o tempo dobra a cada tentativa,
 * com teto de 1 hora: forca bruta fica inviavel sem transformar erro de digitacao
 * em conta permanentemente inacessivel.
 */
function lockWindowMinutes(failedCount: number): number | null {
  if (failedCount < LOCK_THRESHOLD) return null;
  return Math.min(2 ** (failedCount - LOCK_THRESHOLD), LOCK_MAX_MINUTES);
}

async function registerFailedAttempt(userId: string, email: string, ip: string | null): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  const minutes = lockWindowMinutes(updated.failedLoginCount);
  if (minutes !== null) {
    const lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil } });
    await audit({
      action: 'AUTH_LOCKED',
      description: `Conta bloqueada por ${minutes} min após ${updated.failedLoginCount} tentativas. Sujeito ${pseudonymize(email)}.`,
      userId,
      ipAddress: ip,
    });
  }

  await audit({
    action: 'AUTH_LOGIN_FAILED',
    description: `Senha incorreta. Sujeito ${pseudonymize(email)}. Falhas acumuladas: ${updated.failedLoginCount}.`,
    userId,
    ipAddress: ip,
  });
}

const AUDIENCIA_ESCOLHA = 'vanpro-escolha-empresa';

/**
 * Zera o contador e devolve a sessao pronta. Usado pelo login, pelo 2FA e pela
 * passkey.
 *
 * Antes de emitir, resolve QUAL empresa. A regra existe porque a mesma pessoa
 * pode ter vinculo ativo em mais de uma frota — o motorista freelancer que o
 * produto promete. A versao anterior lia `User.tenantId`, um escalar, e por
 * isso o segundo vinculo nunca era alcancavel.
 *
 *   nenhum vinculo  -> so entra se for SUPER_ADMIN (opera a plataforma)
 *   um vinculo      -> entra direto nele
 *   mais de um      -> NAO emite sessao: devolve a lista e um token de escolha
 *                      de 5 minutos. Escolher primeiro evita o susto de cair
 *                      na frota errada e agir nela sem perceber.
 */
async function completeLogin(
  req: Parameters<typeof issueSession>[0],
  res: Parameters<typeof issueSession>[1],
  user: PublicUser & { tenantId: string | null },
  via: string,
) {
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  const vinculos = await vinculosAtivos(user.id);

  if (user.role === 'SUPER_ADMIN' && vinculos.length === 0) {
    await issueSession(req, res, { id: user.id, role: user.role, companyId: null });
    await audit({
      action: 'AUTH_LOGIN_SUCCESS',
      description: `Login de plataforma via ${via}.`,
      userId: user.id,
      companyId: null,
      ipAddress: req.ip ?? null,
    });
    return { user: publicUser(user), csrfToken: issueCsrfToken(res) };
  }

  if (vinculos.length === 0) {
    throw Errors.forbidden('Você não tem vínculo ativo com nenhuma empresa. Fale com o responsável pela frota.');
  }

  if (vinculos.length > 1) {
    await audit({
      action: 'AUTH_LOGIN_SUCCESS',
      description: `Credencial conferida via ${via}. Aguardando escolha entre ${vinculos.length} empresas.`,
      userId: user.id,
      companyId: null,
      ipAddress: req.ip ?? null,
    });
    return {
      requiresCompanySelection: true as const,
      // Nunca o id cru do usuario: token assinado e curto, como no 2FA.
      selectionToken: signStepToken({ purpose: 'empresa', sub: user.id }, AUDIENCIA_ESCOLHA),
      companies: vinculos,
      // Sugestao, nao decisao: a ultima frota usada aparece pre-selecionada.
      suggestedCompanyId: vinculos.some((v) => v.companyId === user.tenantId) ? user.tenantId : null,
    };
  }

  const unico = vinculos[0]!;
  await issueSession(req, res, { id: user.id, role: unico.role, companyId: unico.companyId });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: unico.companyId } });

  await audit({
    action: 'AUTH_LOGIN_SUCCESS',
    description: `Login concluído via ${via} na empresa ${unico.companyName}.`,
    userId: user.id,
    companyId: unico.companyId,
    ipAddress: req.ip ?? null,
  });

  return { user: publicUser(user), csrfToken: issueCsrfToken(res), company: unico };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: emailField,
  // Sem `strongPassword` aqui: a politica se aplica a quem CADASTRA senha. No
  // login, rejeitar por forca revelaria que a senha existente e fraca.
  password: z.string().min(1, 'Informe a senha').max(128),
});

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.valid.body as z.infer<typeof loginSchema>;
  const ip = req.ip ?? null;

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Compare descartavel: iguala o tempo de resposta ao de uma conta real.
    await dummyCompare(password);
    await audit({
      action: 'AUTH_LOGIN_FAILED',
      description: `Tentativa em e-mail não cadastrado. Sujeito ${pseudonymize(email)}.`,
      ipAddress: ip,
    });
    throw Errors.invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw Errors.accountLocked(user.lockedUntil);
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    await registerFailedAttempt(user.id, email, ip);
    throw Errors.invalidCredentials();
  }

  if (!user.isActive) throw Errors.forbidden('Este acesso foi desativado.');

  // Expiracao so depois de a senha bater: cobrar antes responderia diferente
  // para conta existente com senha vencida e entregaria a existencia de graca.
  if (isPasswordExpired(user.passwordUpdatedAt, user.role)) {
    throw Errors.passwordExpired();
  }

  if (user.isTwoFactorEnabled) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    // `challengeId` no lugar do userId: devolver o id cru transformaria o login
    // num oraculo de enumeracao para quem so quer saber quem existe.
    const challengeId = signStepToken({ purpose: '2fa', sub: user.id }, CHALLENGE_AUDIENCE);
    return res.json({ requires2FA: true, challengeId });
  }

  return res.json(await completeLogin(req, res, user, 'senha'));
});

// ---------------------------------------------------------------------------
// 2FA — segunda etapa do login
// ---------------------------------------------------------------------------

const twoFactorLoginSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().trim().min(6, 'Código inválido').max(16),
});

router.post('/2fa/login', authLimiter, validate({ body: twoFactorLoginSchema }), async (req, res) => {
  const { challengeId, code } = req.valid.body as z.infer<typeof twoFactorLoginSchema>;
  const claims = verifyStepToken(challengeId, CHALLENGE_AUDIENCE, '2fa');

  const user = await prisma.user.findUnique({ where: { id: String(claims.sub) } });
  if (!user || !user.isActive || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
    throw Errors.unauthorized('Desafio expirado ou inválido. Faça login novamente.');
  }

  const totpOk = authenticator.verify({ token: code.replace(/\s/g, ''), secret: user.twoFactorSecret });

  if (!totpOk) {
    const stored = parseRecoveryHashes(user.twoFactorRecoveryCodes);
    const { ok, remaining } = await consumeRecoveryCode(code, stored);
    if (!ok) {
      await registerFailedAttempt(user.id, user.email, req.ip ?? null);
      throw Errors.invalidCredentials();
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorRecoveryCodes: serializeRecoveryHashes(remaining) },
    });
    logger.info({ userId: user.id, restantes: remaining.length }, 'código de recuperação 2FA consumido');
    return res.json(await completeLogin(req, res, user, 'código de recuperação'));
  }

  return res.json(await completeLogin(req, res, user, '2FA'));
});

// ---------------------------------------------------------------------------
// Empresa ativa
// ---------------------------------------------------------------------------

/**
 * Conclui o login de quem tem vinculo com mais de uma frota.
 *
 * A credencial ja foi conferida; o que falta e dizer em qual empresa entrar. O
 * `selectionToken` prova isso sem expor o id do usuario e sem manter sessao
 * aberta durante a escolha.
 */
router.post(
  '/select-company',
  authLimiter,
  validate({
    body: z.object({
      selectionToken: z.string().min(10),
      companyId: z.string().uuid('empresa inválida'),
    }),
  }),
  async (req, res) => {
    const { selectionToken, companyId } = req.valid.body as { selectionToken: string; companyId: string };
    const claims = verifyStepToken(selectionToken, AUDIENCIA_ESCOLHA, 'empresa');

    const user = await prisma.user.findUnique({
      where: { id: String(claims.sub) },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw Errors.unauthorized('Sessão inválida. Entre novamente.');

    const papel = await papelNaEmpresa(user.id, companyId, user.role);
    // Mesma mensagem para empresa inexistente e empresa sem vinculo: distinguir
    // as duas transformaria esta rota num verificador de quais frotas existem.
    if (!papel) throw Errors.forbidden('Você não tem vínculo ativo com esta empresa.');

    await issueSession(req, res, { id: user.id, role: papel, companyId });
    await prisma.user.update({ where: { id: user.id }, data: { tenantId: companyId } });

    await audit({
      action: 'AUTH_LOGIN_SUCCESS',
      description: `Empresa escolhida no login. Papel nela: ${papel}.`,
      userId: user.id,
      companyId,
      ipAddress: req.ip ?? null,
    });

    res.json({ user: publicUser(user), csrfToken: issueCsrfToken(res) });
  },
);

/** Empresas em que a pessoa pode entrar. Usada pelo seletor do cabecalho. */
router.get('/companies', authenticate, async (req, res) => {
  res.json({ items: await vinculosAtivos(req.auth!.userId), currentCompanyId: req.auth!.tenantId });
});

/**
 * Troca a frota ativa sem novo login.
 *
 * Isto e o que faz o motorista freelancer existir de verdade: de manha ele
 * opera a frota A, a tarde a B, e o papel dele pode ser diferente em cada uma.
 */
router.post(
  '/switch-company',
  authenticate,
  validate({ body: z.object({ companyId: z.string().uuid('empresa inválida') }) }),
  async (req, res) => {
    const { companyId } = req.valid.body as { companyId: string };
    const auth = req.auth!;

    if (companyId === auth.tenantId) {
      return res.json({ csrfToken: issueCsrfToken(res), companyId });
    }

    const sessao = await prisma.session.findUnique({
      where: { id: auth.sessionId },
      select: { familyId: true },
    });

    await switchCompany(req, res, auth.userId, auth.role, companyId, sessao?.familyId ?? null);

    await audit({
      action: 'AUTH_LOGIN_SUCCESS',
      description: `Troca de empresa ativa para ${companyId}.`,
      userId: auth.userId,
      companyId,
      ipAddress: req.ip ?? null,
    });

    res.json({ csrfToken: issueCsrfToken(res), companyId });
  },
);

// ---------------------------------------------------------------------------
// Sessao
// ---------------------------------------------------------------------------

router.post('/refresh', authLimiter, async (req, res) => {
  const { sessionId } = await refreshSession(req, res);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (!session) throw Errors.unauthorized('Sessão inválida.');

  res.json({ user: publicUser(session.user), csrfToken: issueCsrfToken(res) });
});

router.post('/logout', authenticate, async (req, res) => {
  const auth = req.auth!;
  const session = await prisma.session.findUnique({
    where: { id: auth.sessionId },
    select: { familyId: true },
  });

  // Revoga a familia inteira, nao so a sessao atual: sair no celular precisa
  // invalidar tambem o refresh que ja foi rotacionado a partir dele.
  if (session) await revokeFamily(session.familyId);
  clearSessionCookies(res);

  await audit({
    action: 'AUTH_LOGOUT',
    description: 'Sessão encerrada pelo próprio usuário.',
    userId: auth.userId,
    ipAddress: req.ip ?? null,
  });

  res.status(204).send();
});

router.get('/me', authenticate, async (req, res) => {
  const auth = req.auth!;

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw Errors.unauthorized('Sessão inválida.');

  // Empresa e papel saem de `auth`, que leu a SESSAO e o vinculo. Ler
  // `User.tenantId` aqui devolveria a frota errada para quem trabalha em duas.
  const company = auth.tenantId
    ? await prisma.company.findUnique({
        where: { id: auth.tenantId },
        select: { id: true, name: true, tenantStatus: true, trialEndsAt: true },
      })
    : null;

  const empresas = await vinculosAtivos(auth.userId);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: auth.role,
    tenantId: auth.tenantId,
    permissions: auth.permissions,
    contractStatus: auth.contractStatus,
    company,
    // O front so mostra o seletor de frota quando ha mais de uma.
    companies: empresas,
  });
});

// ---------------------------------------------------------------------------
// Dispositivos conectados
// ---------------------------------------------------------------------------

router.get('/sessions', authenticate, async (req, res) => {
  const auth = req.auth!;
  const sessions = await prisma.session.findMany({
    where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ipAddress: true, createdAt: true, expiresAt: true },
  });

  res.json({
    items: sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.id === auth.sessionId,
    })),
  });
});

router.delete('/sessions/:id', authenticate, validate({ params: uuidParam() }), async (req, res) => {
  const auth = req.auth!;
  const id = req.valid.params.id as string;

  const session = await prisma.session.findUnique({
    where: { id },
    select: { id: true, userId: true, familyId: true },
  });

  // `notFound` e nao `forbidden` para sessao de outra pessoa: confirmar que o
  // id existe ja seria informacao a mais.
  if (!session || session.userId !== auth.userId) throw Errors.notFound('Sessão');

  await revokeFamily(session.familyId);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Recuperacao de senha
// ---------------------------------------------------------------------------

const FORGOT_MESSAGE =
  'Se este e-mail estiver cadastrado, enviaremos as instruções de redefinição em instantes.';

router.post(
  '/forgot-password',
  publicWriteLimiter,
  validate({ body: z.object({ email: emailField }) }),
  async (req, res) => {
    const { email } = req.valid.body as { email: string };
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });

    let devLink: string | undefined;

    if (user && user.isActive) {
      const token = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          // Só o hash vai para o banco: dump de tabela nao pode virar um molho
          // de links de redefinicao validos.
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
        },
      });

      const link = `${env.FRONTEND_URL}/redefinir-senha?token=${token}`;

      // Nao ha provedor de e-mail configurado. Dizer "enviado" seria mock em
      // producao: o usuario esperaria uma mensagem que nunca chega.
      logger.info(
        { userId: user.id, link: env.APP_ENV === 'local' ? link : '[oculto]' },
        '[SEM PROVEDOR DE E-MAIL] link de redefinição gerado e NAO enviado',
      );

      if (env.APP_ENV === 'local') devLink = link;
    }

    // Mesma resposta com ou sem conta: e a unica forma de a rota nao virar um
    // verificador de e-mails cadastrados.
    res.json({ message: FORGOT_MESSAGE, ...(devLink ? { devLink } : {}) });
  },
);

const resetSchema = z.object({
  token: z.string().min(20, 'Token inválido').max(200),
  newPassword: strongPassword,
});

router.post('/reset-password', publicWriteLimiter, validate({ body: resetSchema }), async (req, res) => {
  const { token, newPassword } = req.valid.body as z.infer<typeof resetSchema>;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError(400, 'RESET_TOKEN_INVALID', 'Link de redefinição inválido ou expirado. Peça um novo.');
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: {
      password: await hashPassword(newPassword),
      passwordUpdatedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  // Trocar senha derruba tudo: se a troca foi por suspeita de invasao, deixar a
  // sessao do invasor viva anularia o motivo da troca.
  await revokeAllUserSessions(record.userId);
  clearSessionCookies(res);

  await audit({
    action: 'AUTH_PASSWORD_RESET',
    description: 'Senha redefinida por link de recuperação. Todas as sessões foram revogadas.',
    userId: record.userId,
    ipAddress: req.ip ?? null,
  });

  res.json({ message: 'Senha redefinida. Entre com a nova senha.' });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual').max(128),
  newPassword: strongPassword,
});

router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    const auth = req.auth!;
    const { currentPassword, newPassword } = req.valid.body as z.infer<typeof changePasswordSchema>;

    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw Errors.unauthorized('Sessão inválida.');

    if (!(await verifyPassword(currentPassword, user.password))) {
      throw Errors.senhaAtualIncorreta();
    }
    if (await verifyPassword(newPassword, user.password)) {
      throw Errors.conflict('A nova senha precisa ser diferente da atual.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(newPassword),
        passwordUpdatedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    // Revoga tudo e reemite: quem trocou a senha continua logado neste
    // dispositivo, os demais precisam entrar de novo.
    await revokeAllUserSessions(user.id);
    // Reemite na MESMA empresa em que a pessoa estava: trocar a senha nao pode
    // jogar um freelancer para a outra frota sem ele perceber.
    const papelAtual = await papelNaEmpresa(user.id, req.auth?.tenantId ?? null, user.role);
    await issueSession(req, res, {
      id: user.id,
      role: papelAtual ?? user.role,
      companyId: req.auth?.tenantId ?? null,
    });

    await audit({
      action: 'AUTH_PASSWORD_RESET',
      description: 'Senha alterada pelo próprio usuário. Demais sessões revogadas.',
      userId: user.id,
      companyId: user.tenantId,
      ipAddress: req.ip ?? null,
    });

    res.json({ message: 'Senha alterada.', csrfToken: issueCsrfToken(res) });
  },
);

// ---------------------------------------------------------------------------
// 2FA — cadastro
// ---------------------------------------------------------------------------

router.post('/2fa/setup', authenticate, async (req, res) => {
  const auth = req.auth!;
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, isTwoFactorEnabled: true },
  });
  if (!user) throw Errors.unauthorized('Sessão inválida.');
  if (user.isTwoFactorEnabled) throw Errors.conflict('A verificação em duas etapas já está ativa.');

  const secret = authenticator.generateSecret();

  // Fica em `pendingTwoFactorSecret` ate o usuario provar que o app dele gera o
  // codigo certo. Gravar direto no campo definitivo trancaria a conta de quem
  // fechasse a tela antes de ler o QR.
  await prisma.user.update({ where: { id: user.id }, data: { pendingTwoFactorSecret: secret } });

  const otpauth = authenticator.keyuri(user.email, env.WEBAUTHN_RP_NAME, secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  res.json({ secret, otpauth, qrCode });
});

const codeSchema = z.object({ code: z.string().trim().min(6).max(10) });

router.post('/2fa/activate', authenticate, validate({ body: codeSchema }), async (req, res) => {
  const auth = req.auth!;
  const { code } = req.valid.body as z.infer<typeof codeSchema>;

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, tenantId: true, pendingTwoFactorSecret: true },
  });
  if (!user?.pendingTwoFactorSecret) {
    throw Errors.conflict('Nenhuma configuração de 2FA pendente. Comece de novo em /2fa/setup.');
  }

  if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret: user.pendingTwoFactorSecret })) {
    throw Errors.invalidCredentials();
  }

  const { codes, hashes } = await generateRecoveryCodes();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorSecret: user.pendingTwoFactorSecret,
      pendingTwoFactorSecret: null,
      isTwoFactorEnabled: true,
      twoFactorRecoveryCodes: serializeRecoveryHashes(hashes),
    },
  });

  await audit({
    action: 'AUTH_2FA_ENABLED',
    description: 'Verificação em duas etapas ativada. 10 códigos de recuperação emitidos.',
    userId: user.id,
    companyId: user.tenantId,
    ipAddress: req.ip ?? null,
  });

  // Unica vez que os codigos aparecem em claro — o banco so guarda os hashes.
  res.json({
    recoveryCodes: codes,
    message: 'Guarde estes códigos agora. Eles não serão exibidos novamente.',
  });
});

const disableSchema = z.object({
  password: z.string().min(1, 'Informe a senha').max(128),
  code: z.string().trim().min(6).max(16),
});

router.post('/2fa/disable', authenticate, validate({ body: disableSchema }), async (req, res) => {
  const auth = req.auth!;
  const { password, code } = req.valid.body as z.infer<typeof disableSchema>;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) throw Errors.unauthorized('Sessão inválida.');
  if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
    throw Errors.conflict('A verificação em duas etapas não está ativa.');
  }

  // Senha E codigo: desligar o segundo fator com apenas um dos dois faria do
  // cookie roubado uma chave para remover a propria protecao.
  if (!(await verifyPassword(password, user.password))) throw Errors.senhaAtualIncorreta();

  const totpOk = authenticator.verify({ token: code.replace(/\s/g, ''), secret: user.twoFactorSecret });
  if (!totpOk) {
    const { ok } = await consumeRecoveryCode(code, parseRecoveryHashes(user.twoFactorRecoveryCodes));
    if (!ok) throw Errors.senhaAtualIncorreta('Código de verificação incorreto.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isTwoFactorEnabled: false,
      twoFactorSecret: null,
      pendingTwoFactorSecret: null,
      twoFactorRecoveryCodes: null,
    },
  });

  await audit({
    action: 'AUTH_2FA_DISABLED',
    description: 'Verificação em duas etapas desativada pelo próprio usuário.',
    userId: user.id,
    companyId: user.tenantId,
    ipAddress: req.ip ?? null,
  });

  res.json({ message: 'Verificação em duas etapas desativada.' });
});

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn)
// ---------------------------------------------------------------------------

/**
 * O corpo vindo do navegador e definido pela especificacao WebAuthn, nao por
 * nos. Validamos a casca (o que o roteador precisa para nao explodir) e
 * deixamos a validacao criptografica com a biblioteca, que e quem tem contexto
 * para isso.
 */
const webauthnResponseSchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal('public-key'),
  })
  .passthrough();

function parseTransports(stored: string): AuthenticatorTransportFuture[] {
  return stored
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean) as AuthenticatorTransportFuture[];
}

router.post('/webauthn/register/options', authenticate, async (req, res) => {
  const auth = req.auth!;
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw Errors.unauthorized('Sessão inválida.');

  const existing = await prisma.authenticator.findMany({
    where: { userId: user.id },
    select: { credentialID: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new Uint8Array(Buffer.from(user.id, 'utf8')),
    attestationType: 'none',
    excludeCredentials: existing.map((a) => ({
      id: isoBase64URL.fromBuffer(new Uint8Array(a.credentialID)),
      transports: parseTransports(a.transports),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: options.challenge } });

  res.json(options);
});

router.post(
  '/webauthn/register/verify',
  authenticate,
  validate({ body: webauthnResponseSchema }),
  async (req, res) => {
    const auth = req.auth!;
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, tenantId: true, currentChallenge: true },
    });
    if (!user?.currentChallenge) {
      throw Errors.conflict('Nenhum registro de passkey em andamento. Peça as opções de novo.');
    }

    const response = req.valid.body as unknown as RegistrationResponseJSON;

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
    });

    // Desafio e de uso unico, independente do resultado.
    await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: null } });

    if (!verification.verified || !verification.registrationInfo) {
      throw Errors.unauthorized('Não foi possível validar esta passkey.');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await prisma.authenticator.create({
      data: {
        userId: user.id,
        credentialID: Buffer.from(isoBase64URL.toBuffer(credential.id)),
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        credentialDeviceType,
        credentialBackedUp,
        transports: (credential.transports ?? []).join(','),
      },
    });

    await audit({
      action: 'AUTH_PASSKEY_ADDED',
      description: `Passkey registrada (${credentialDeviceType}).`,
      userId: user.id,
      companyId: user.tenantId,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ verified: true });
  },
);

router.post('/webauthn/login/options', authLimiter, async (_req, res) => {
  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    userVerification: 'preferred',
  });

  // Sem `allowCredentials` e sem gravar o desafio por usuario: pedir o e-mail
  // antes de saber quem e transformaria esta rota em consulta de cadastro. O
  // desafio volta assinado e o cliente o devolve na verificacao.
  const challengeId = signStepToken(
    { purpose: 'webauthn-login', challenge: options.challenge },
    WEBAUTHN_AUDIENCE,
  );

  res.json({ options, challengeId });
});

const webauthnLoginSchema = z.object({
  challengeId: z.string().min(1),
  response: webauthnResponseSchema,
});

router.post(
  '/webauthn/login/verify',
  authLimiter,
  validate({ body: webauthnLoginSchema }),
  async (req, res) => {
    const body = req.valid.body as { challengeId: string; response: unknown };
    const claims = verifyStepToken(body.challengeId, WEBAUTHN_AUDIENCE, 'webauthn-login');
    const expectedChallenge = String(claims.challenge ?? '');

    const response = body.response as AuthenticationResponseJSON;

    const stored = await prisma.authenticator.findUnique({
      where: { credentialID: Buffer.from(isoBase64URL.toBuffer(response.id)) },
      include: { user: true },
    });
    if (!stored || !stored.user.isActive) throw Errors.invalidCredentials();

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
      credential: {
        id: isoBase64URL.fromBuffer(new Uint8Array(stored.credentialID)),
        publicKey: new Uint8Array(stored.credentialPublicKey),
        counter: Number(stored.counter),
        transports: parseTransports(stored.transports),
      },
    });

    if (!verification.verified) throw Errors.invalidCredentials();

    // Contador crescente e a defesa contra replay de assinatura clonada.
    await prisma.authenticator.update({
      where: { id: stored.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter) },
    });

    res.json(await completeLogin(req, res, stored.user, 'passkey'));
  },
);

export default router;
