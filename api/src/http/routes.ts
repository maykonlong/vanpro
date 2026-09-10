import { Router, type RequestHandler } from 'express';

import healthRouter from './health';
import versionRouter from './version';
import { authenticate } from './middlewares/authenticate';
import { webhookLimiter } from '../security/rate-limit';

import authRouter from '../modules/auth/auth.controller';
import registerRouter from '../modules/tenancy/register.controller';
import platformRouter from '../modules/tenancy/platform.controller';
import companyRouter, { publicRouter as companyPublicRouter } from '../modules/tenancy/company.controller';
import webhooksRouter from '../modules/webhooks/webhooks.controller';

import studentsRouter from '../modules/students/students.controller';
import vehiclesRouter from '../modules/vehicles/vehicles.controller';
import driversRouter from '../modules/drivers/drivers.controller';
import timecardsRouter from '../modules/timecards/timecards.controller';
import financialRouter from '../modules/financial/financial.controller';
import chartersRouter from '../modules/charters/charters.controller';
import crmRouter from '../modules/crm/crm.controller';
import aiRouter from '../modules/ai/ai.controller';
import privacyRouter from '../modules/privacy/privacy.controller';
import uploadsRouter from '../modules/uploads/uploads.controller';

/**
 * PONTO UNICO de montagem de rotas.
 *
 * A fronteira publico/privado e uma linha so — a propriedade `publico` da
 * tabela abaixo — e nenhum prefixo aparece dos dois lados. Isso e regra de
 * seguranca com historia: na versao anterior o router de alunos era montado uma
 * vez sem `authMiddleware` e outra com ele. O Express casa o PRIMEIRO, entao a
 * API de criancas — nome, escola, endereco e foto — respondia sem autenticacao
 * nenhuma.
 *
 * A tabela e DADO, e nao uma sequencia de `router.use()`, por tres motivos:
 * o guarda 15 do CI consegue detectar prefixo repetido; a documentacao OpenAPI
 * consegue saber onde cada router foi montado (o Express 5 nao expoe isso em
 * runtime); e a fronteira fica legivel de uma vez so, em vez de espalhada.
 */
export interface Montagem {
  prefixo: string;
  router: Router;
  /** `true` responde sem sessao. Quem e publico esta declarado, nunca implicito. */
  publico: boolean;
  /** Middlewares extras aplicados antes do router. */
  antes?: RequestHandler[];
  descricao: string;
}

export const MONTAGENS: readonly Montagem[] = [
  // --- publicas -----------------------------------------------------------
  { prefixo: '/health', router: healthRouter, publico: true, descricao: 'Sondas de saude e integracoes ligadas' },
  {
    // Prefixo proprio, e nao dentro de /health: o carimbo diz exatamente qual
    // codigo esta respondendo, o que ajuda a operacao e ajuda igualmente quem
    // esta sondando. Fica na rede interna, negado no nginx como as metricas.
    prefixo: '/interno',
    router: versionRouter,
    publico: true,
    descricao: 'Carimbo de versao e conteudo da imagem (rede interna)',
  },
  {
    prefixo: '/auth',
    router: authRouter,
    publico: true,
    // O proprio router decide o que exige sessao (/me, /logout, /2fa/setup) e
    // aplica os limitadores de forca bruta rota a rota.
    descricao: 'Sessao, 2FA, passkeys e senha',
  },
  { prefixo: '/register', router: registerRouter, publico: true, descricao: 'Cadastro self-service da empresa' },
  {
    prefixo: '',
    router: companyPublicRouter,
    publico: true,
    descricao: 'Aceite de convite — quem recebe o link ainda nao tem conta',
  },
  {
    prefixo: '/webhooks',
    router: webhooksRouter,
    publico: true,
    antes: [webhookLimiter],
    descricao: 'Gateway de pagamento; autenticado por HMAC, nao por cookie',
  },

  // --- exigem sessao ------------------------------------------------------
  { prefixo: '/company', router: companyRouter, publico: false, descricao: 'Empresa, plano e equipe' },
  {
    prefixo: '/platform',
    router: platformRouter,
    publico: false,
    descricao: 'Console da plataforma — assinatura das frotas (SUPER_ADMIN)',
  },
  { prefixo: '/students', router: studentsRouter, publico: false, descricao: 'Alunos' },
  { prefixo: '/vehicles', router: vehiclesRouter, publico: false, descricao: 'Veiculos' },
  { prefixo: '/drivers', router: driversRouter, publico: false, descricao: 'Motoristas e holerite' },
  { prefixo: '/timecards', router: timecardsRouter, publico: false, descricao: 'Ponto e batidas' },
  { prefixo: '/financial', router: financialRouter, publico: false, descricao: 'DRE, mensalidades, despesas e faturas' },
  { prefixo: '/charters', router: chartersRouter, publico: false, descricao: 'Fretamentos' },
  { prefixo: '/crm', router: crmRouter, publico: false, descricao: 'Notas, incidentes e chat' },
  { prefixo: '/ai', router: aiRouter, publico: false, descricao: 'Campanhas e publicacoes' },
  { prefixo: '/privacy', router: privacyRouter, publico: false, descricao: 'Direitos do titular (LGPD)' },
  { prefixo: '/uploads', router: uploadsRouter, publico: false, descricao: 'Arquivos por empresa' },
];

export function buildRouter(): Router {
  const router = Router();

  for (const m of MONTAGENS.filter((x) => x.publico)) {
    router.use(m.prefixo || '/', ...(m.antes ?? []), m.router);
  }

  // Fronteira. Nada abaixo desta linha responde sem sessao valida.
  router.use(authenticate);

  for (const m of MONTAGENS.filter((x) => !x.publico)) {
    router.use(m.prefixo || '/', ...(m.antes ?? []), m.router);
  }

  return router;
}
