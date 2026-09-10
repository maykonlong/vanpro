import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma';
import { runUnscoped } from '../lib/request-context';
import { logger } from '../lib/logger';
import { audit } from '../lib/audit';
import { umaRodadaPorVez } from '../lib/uma-rodada-por-vez';

/**
 * Rotinas agendadas.
 *
 * Todas rodam em `runUnscoped` porque cruzam empresas por natureza — e por isso
 * mesmo cada uma filtra explicitamente o que precisa. Cron que roda sem escopo
 * e sem filtro e o caminho mais curto para uma cobranca ir para o cliente errado.
 *
 * Idempotencia e requisito, nao detalhe: o processo pode reiniciar no meio, e a
 * mesma janela pode ser processada duas vezes.
 */

const tasks: ScheduledTask[] = [];

const TZ = 'America/Sao_Paulo';

/**
 * Trial vencido vira PAST_DUE — e NAO SUSPENDED.
 *
 * A versao anterior cortava a operacao da frota no fim do periodo de teste. O
 * problema nao era o corte em si: e que o produto nunca emitiu fatura do
 * proprio plano. `SubscriptionPlan.priceCents` e `SaaSSubscription` existem,
 * mas cobranca recorrente do SaaS nao foi construida — entao a suspensao
 * automatica punia inadimplencia de um boleto que jamais chegou ao cliente.
 *
 * A decisao aqui e explicita: enquanto a cobranca for feita por fora, o fim do
 * teste e AVISO, nao corte. `PAST_DUE` deixa a frota trabalhando e acende o
 * aviso na tela. Cortar o acesso (`SUSPENDED`) passa a ser ato administrativo
 * da plataforma, com responsavel e registro em trilha — ver
 * `PATCH /platform/companies/:id/status`.
 *
 * Roda de hora em hora para nao depender de meia-noite exata.
 */
async function marcarTrialsVencidos(): Promise<void> {
  const now = new Date();
  const result = await runUnscoped('cron-trial', () =>
    prisma.company.updateMany({
      where: { tenantStatus: 'TRIAL', trialEndsAt: { lt: now } },
      data: { tenantStatus: 'PAST_DUE' },
    }),
  );
  if (result.count > 0) {
    logger.info({ count: result.count }, 'empresas marcadas como pendentes de pagamento (fim do teste)');
  }
}

/**
 * Mensalidade do mes, para todo aluno ativo de toda frota.
 *
 * Antes disto, alguem tinha de lancar aluno por aluno, mes a mes. Numa frota de
 * quarenta criancas isso e quarenta lancamentos manuais em fevereiro, quarenta
 * em marco — e o que acontece de verdade e que em algum mes ninguem lanca, a
 * cobranca nao sai, e o dono descobre quando falta dinheiro. O produto prometia
 * controlar mensalidade e entregava uma planilha com botao.
 *
 * IDEMPOTENTE POR CONSTRUCAO, e nao por consulta. A unica
 * `(studentId, competencia)` faz a segunda tentativa falhar no banco em vez de
 * duplicar: "consultar antes de inserir" perde a corrida entre duas execucoes
 * simultaneas — e o efeito de perder essa corrida e o responsavel recebendo dois
 * boletos do mesmo mes.
 *
 * Roda TODO DIA de proposito, e nao so no dia 1. Aluno matriculado no meio do
 * mes precisa da mensalidade dele; e uma execucao que falhou ontem se corrige
 * hoje sozinha, em vez de esperar trinta dias.
 */
async function gerarMensalidadesDoMes(): Promise<void> {
  const agora = new Date();
  const competencia = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;

  const empresas = await runUnscoped('cron-mensalidades', () =>
    prisma.company.findMany({
      // `CANCELED` fica de fora: relacao encerrada nao gera cobranca nova.
      // As demais entram, inclusive `SUSPENDED` — a suspensao e entre o VanPro e
      // o dono da frota; a mensalidade e entre a frota e o responsavel, e deixar
      // de gerar seria fazer a frota perder receita por causa da conta do
      // fornecedor dela.
      where: { tenantStatus: { not: 'CANCELED' } },
      select: { id: true, name: true, billingDay: true },
    }),
  );

  let criadas = 0;
  let jaExistiam = 0;

  for (const empresa of empresas) {
    const alunos = await runUnscoped('cron-mensalidades', () =>
      prisma.student.findMany({
        where: { companyId: empresa.id, deletedAt: null, monthlyFeeCents: { gt: 0 } },
        select: { id: true, monthlyFeeCents: true },
      }),
    );

    for (const aluno of alunos) {
      try {
        await runUnscoped('cron-mensalidades', () =>
          prisma.financialTransaction.create({
            data: {
              companyId: empresa.id,
              studentId: aluno.id,
              amountCents: aluno.monthlyFeeCents,
              dueDate: vencimentoDoMes(agora, empresa.billingDay),
              competencia,
              paid: false,
            },
          }),
        );
        criadas += 1;
      } catch (err) {
        // Colisao na unica: a mensalidade deste aluno neste mes ja existe. E o
        // caminho NORMAL a partir da segunda execucao do dia — nao e erro, e a
        // idempotencia funcionando.
        if ((err as { code?: string }).code === 'P2002') {
          jaExistiam += 1;
          continue;
        }
        throw err;
      }
    }
  }

  if (criadas > 0) {
    logger.info({ competencia, criadas, jaExistiam }, 'mensalidades do mês geradas');
    await audit({
      action: 'INVOICE_CREATED',
      description: `Geração automática da competência ${competencia}: ${criadas} mensalidade(s) criada(s).`,
      companyId: null,
    });
  }
}

/**
 * Data de vencimento no mes corrente.
 *
 * Dia 31 em fevereiro nao existe: cai no ultimo dia do mes. `new Date(ano, mes,
 * 0)` devolve o ultimo dia do mes anterior — usado aqui para descobrir quantos
 * dias o mes tem sem tabela de meses nem regra de ano bissexto escrita a mao.
 */
function vencimentoDoMes(referencia: Date, dia: number): Date {
  const ano = referencia.getUTCFullYear();
  const mes = referencia.getUTCMonth();
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDia), 12, 0, 0));
}

/** Fatura vencida e nao paga vira OVERDUE. */
async function markOverdueInvoices(): Promise<void> {
  const now = new Date();
  const result = await runUnscoped('cron-overdue', () =>
    prisma.invoice.updateMany({
      where: { status: 'PENDING', dueDate: { lt: now } },
      data: { status: 'OVERDUE' },
    }),
  );
  if (result.count > 0) logger.info({ count: result.count }, 'faturas marcadas como vencidas');
}

/**
 * Purga de dados LGPD.
 *
 * Remove em definitivo sessoes expiradas e tokens de recuperacao usados/vencidos.
 * NAO apaga aluno automaticamente: exclusao de titular passa por aprovacao
 * humana no fluxo de privacidade, porque obrigacao fiscal pode impedir.
 */
async function purgeExpiredCredentials(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [sessions, resets] = await runUnscoped('cron-lgpd-purge', async () => {
    const s = await prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    const r = await prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
    });
    return [s.count, r.count] as const;
  });

  if (sessions + resets > 0) {
    logger.info({ sessions, resets }, 'purga LGPD de credenciais expiradas');
    await audit({
      action: 'LGPD_FORGET_EXECUTED',
      description: `Purga automática: ${sessions} sessões e ${resets} tokens de recuperação expirados removidos.`,
      companyId: null,
    });
  }
}

/**
 * Minimizacao do IP na trilha de auditoria, depois de 12 meses.
 *
 * A trilha precisa do IP para responder "de onde partiu isso?" — e apagar cedo
 * demais destroi a propria finalidade que justifica guarda-lo. Guardar para
 * sempre, por outro lado, e retencao sem prazo de dado pessoal, que e o achado
 * que este job fecha.
 *
 * A saida e truncar, nao apagar: a rede (`/24` em IPv4, `/48` em IPv6) ainda
 * distingue "veio da escola" de "veio de outro pais", que e o que uma
 * investigacao tardia usa, e deixa de identificar o assinante.
 *
 * `AuditLog.ipAddress` NAO entra no hash da cadeia (`computeHash` usa acao,
 * descricao, empresa, usuario e data) — por isso este UPDATE nao rompe a
 * verificacao. Se um dia o IP entrar no hash, esta rotina precisa mudar junto,
 * e e para isso que este paragrafo existe.
 */
async function minimizarIpsAntigos(): Promise<void> {
  const corte = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const afetados = await runUnscoped('cron-lgpd-ip', async () => {
    // GUARDA: sql-cru-auditado — trunca IP na propria coluna, sem ler nem cruzar dado de empresa; o unico filtro e a data.
    const n = await prisma.$executeRaw`
      UPDATE "AuditLog"
         SET "ipAddress" = CASE
               WHEN "ipAddress" LIKE '%:%'
                 THEN split_part("ipAddress", ':', 1) || ':' || split_part("ipAddress", ':', 2) || ':' || split_part("ipAddress", ':', 3) || '::/48'
               ELSE split_part("ipAddress", '.', 1) || '.' || split_part("ipAddress", '.', 2) || '.' || split_part("ipAddress", '.', 3) || '.0/24'
             END
       WHERE "createdAt" < ${corte}
         AND "ipAddress" IS NOT NULL
         AND "ipAddress" NOT LIKE '%/%'`;
    return n;
  });

  if (afetados > 0) {
    logger.info({ afetados }, 'IPs da trilha com mais de 12 meses reduzidos a rede');
    await audit({
      action: 'LGPD_FORGET_EXECUTED',
      description: `Minimização automática: ${afetados} endereços IP com mais de 12 meses truncados para a rede.`,
      companyId: null,
    });
  }
}

/** Executa protegendo o agendador: excecao dentro do job nao pode matar o processo. */
function guarded(name: string, fn: () => Promise<unknown>) {
  return () => {
    void fn().catch((err) => logger.error({ err, job: name }, 'job falhou'));
  };
}

/**
 * As versoes que o agendador realmente chama.
 *
 * `guarded` impede que a excecao mate o processo, mas nao impede SOBREPOSICAO:
 * o node-cron dispara no horario, tenha a rodada anterior terminado ou nao. Uma
 * purga LGPD que passe das 24h numa base grande poe dois `deleteMany` da mesma
 * janela disputando as mesmas linhas.
 *
 * As travas ficam no escopo do modulo, e nao dentro de `startJobs`: criadas la,
 * um `startJobs` chamado duas vezes sem `stopJobs` produziria duas travas
 * independentes — ou seja, nenhuma trava.
 */
const exclusivos = {
  trials: umaRodadaPorVez(marcarTrialsVencidos),
  overdue: umaRodadaPorVez(markOverdueInvoices),
  lgpdPurge: umaRodadaPorVez(purgeExpiredCredentials),
  lgpdIp: umaRodadaPorVez(minimizarIpsAntigos),
  mensalidades: umaRodadaPorVez(gerarMensalidadesDoMes),
} as const;

export function startJobs(): void {
  tasks.push(cron.schedule('7 * * * *', guarded('trials', exclusivos.trials), { timezone: TZ }));
  tasks.push(cron.schedule('17 3 * * *', guarded('overdue', exclusivos.overdue), { timezone: TZ }));
  tasks.push(cron.schedule('37 4 * * *', guarded('lgpd-purge', exclusivos.lgpdPurge), { timezone: TZ }));
  // Semanal, e nao diario: a janela e de 12 meses, entao rodar todo dia so
  // varre a mesma tabela sem nada para fazer.
  tasks.push(cron.schedule('47 4 * * 0', guarded('lgpd-ip', exclusivos.lgpdIp), { timezone: TZ }));
  // 5h27: depois da virada do dia e antes de qualquer pessoa abrir o sistema.
  // Todo dia, nao so no dia 1 — ver o comentario da funcao.
  tasks.push(cron.schedule('27 5 * * *', guarded('mensalidades', exclusivos.mensalidades), { timezone: TZ }));
  logger.info({ jobs: tasks.length }, 'rotinas agendadas ativas');
}

export function stopJobs(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}

/** Exportado para os testes exercitarem a regra sem esperar o relogio. */
export const __jobs = {
  marcarTrialsVencidos,
  markOverdueInvoices,
  purgeExpiredCredentials,
  minimizarIpsAntigos,
  gerarMensalidadesDoMes,
};

/** As mesmas rotinas com a trava de reentrancia — o que o agendador chama. */
export const __jobsExclusivos = exclusivos;
