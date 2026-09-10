import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { __jobs } from '../../src/jobs/index';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { toCents } from '../../src/lib/money';
import { criarEmpresa, criarUsuario, type Empresa, type Usuario } from '../helpers/factory';

/**
 * Rotinas agendadas.
 *
 * Cron roda sem tenant no contexto e cruza empresas por natureza — e por isso e
 * o lugar onde um filtro esquecido suspende quem esta em dia ou cobra quem nao
 * deve. Cada teste aqui monta os DOIS lados: o registro que a rotina tem de
 * pegar e o vizinho que ela nao pode encostar.
 */

const DIA = 24 * 60 * 60 * 1000;

let alfa: Empresa;
let beta: Empresa;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181', { tenantStatus: 'TRIAL' });
  beta = await criarEmpresa('Empresa Beta', '44555666000199', { tenantStatus: 'TRIAL' });
});

async function statusDa(companyId: string) {
  const [row] = await runUnscoped('check', () =>
    prisma.$queryRaw<Array<{ tenantStatus: string; suspendedAt: Date | null }>>`
      SELECT "tenantStatus", "suspendedAt" FROM "Company" WHERE id = ${companyId}`,
  );
  return row!;
}

/**
 * Fim do teste e AVISO, nao corte.
 *
 * O job suspendia a empresa quando o trial vencia. So que o produto nunca
 * emitiu a fatura do proprio plano: era corte por inadimplencia de um boleto
 * que jamais chegou ao cliente. Enquanto a cobranca recorrente do SaaS nao
 * existir, o vencimento leva a `PAST_DUE` — e suspender virou ato
 * administrativo explicito (`PATCH /platform/companies/:id/status`).
 */
describe('fim do periodo de teste', () => {
  it('marca como pendente quem venceu e nao encosta em quem ainda esta no prazo', async () => {
    await runUnscoped('fixture', async () => {
      await prisma.company.update({
        where: { id: alfa.id },
        data: { trialEndsAt: new Date(Date.now() - DIA) },
      });
      await prisma.company.update({
        where: { id: beta.id },
        data: { trialEndsAt: new Date(Date.now() + 7 * DIA) },
      });
    });

    await __jobs.marcarTrialsVencidos();

    const vencida = await statusDa(alfa.id);
    expect(vencida.tenantStatus).toBe('PAST_DUE');
    // Nao ha corte: `suspendedAt` continua vazio porque ninguem suspendeu nada.
    expect(vencida.suspendedAt).toBeNull();

    const emDia = await statusDa(beta.id);
    expect(emDia.tenantStatus).toBe('TRIAL');
    expect(emDia.suspendedAt).toBeNull();
  });

  it('nao mexe em empresa ja ATIVA, mesmo com trialEndsAt no passado', async () => {
    const paga = await criarEmpresa('Empresa Paga', '55666777000188', { tenantStatus: 'ACTIVE' });
    await runUnscoped('fixture', () =>
      prisma.company.update({ where: { id: paga.id }, data: { trialEndsAt: new Date(Date.now() - 90 * DIA) } }),
    );

    await __jobs.marcarTrialsVencidos();

    expect((await statusDa(paga.id)).tenantStatus).toBe('ACTIVE');
  });

  it('rodar duas vezes nao muda o resultado', async () => {
    await runUnscoped('fixture', () =>
      prisma.company.update({ where: { id: alfa.id }, data: { trialEndsAt: new Date(Date.now() - DIA) } }),
    );

    await __jobs.marcarTrialsVencidos();
    const primeira = await statusDa(alfa.id);

    await __jobs.marcarTrialsVencidos();
    const segunda = await statusDa(alfa.id);

    expect(primeira.tenantStatus).toBe('PAST_DUE');
    expect(segunda.tenantStatus).toBe('PAST_DUE');
    expect(segunda.suspendedAt).toBeNull();
  });
});

describe('faturas vencidas', () => {
  async function criarFatura(companyId: string, status: string, vencimento: Date) {
    return runUnscoped('fixture', async () => {
      const aluno = await prisma.student.create({
        data: { companyId, name: 'Aluno', school: 'Escola', shift: 'FULL', monthlyFeeCents: toCents(400) },
      });
      const fatura = await prisma.invoice.create({
        data: { companyId, studentId: aluno.id, amountCents: toCents(400), status, dueDate: vencimento },
      });
      return fatura.id;
    });
  }

  async function statusDaFatura(id: string) {
    const [row] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Invoice" WHERE id = ${id}`,
    );
    return row!.status;
  }

  it('marca como OVERDUE so a pendente que passou do vencimento', async () => {
    const vencida = await criarFatura(alfa.id, 'PENDING', new Date(Date.now() - DIA));
    const aVencer = await criarFatura(alfa.id, 'PENDING', new Date(Date.now() + DIA));
    const jaPaga = await criarFatura(alfa.id, 'RECEIVED', new Date(Date.now() - 30 * DIA));
    const daVizinha = await criarFatura(beta.id, 'PENDING', new Date(Date.now() - DIA));

    await __jobs.markOverdueInvoices();

    expect(await statusDaFatura(vencida)).toBe('OVERDUE');
    expect(await statusDaFatura(aVencer)).toBe('PENDING');
    // Fatura ja recebida nao volta a ser cobranca por causa da data.
    expect(await statusDaFatura(jaPaga)).toBe('RECEIVED');
    // A rotina e de plataforma e atende todas as empresas — de proposito.
    expect(await statusDaFatura(daVizinha)).toBe('OVERDUE');
  });
});

describe('purga LGPD de credenciais', () => {
  let usuario: Usuario;

  beforeEach(async () => {
    usuario = await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  });

  async function criarSessao(opts: { expiresAt: Date; revokedAt?: Date }) {
    return runUnscoped('fixture', async () => {
      const s = await prisma.session.create({
        data: {
          userId: usuario.id,
          familyId: crypto.randomUUID(),
          tokenHash: crypto.randomUUID(),
          userAgentHash: 'hash',
          expiresAt: opts.expiresAt,
          revokedAt: opts.revokedAt ?? null,
        },
      });
      return s.id;
    });
  }

  async function existe(tabela: 'Session' | 'PasswordResetToken', id: string) {
    const rows = await runUnscoped('check', () =>
      prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "${tabela}" WHERE id = $1`, id),
    );
    return rows.length === 1;
  }

  it('remove sessao expirada ha mais de 30 dias e preserva a viva', async () => {
    const antiga = await criarSessao({ expiresAt: new Date(Date.now() - 40 * DIA) });
    const revogadaHaMuito = await criarSessao({
      expiresAt: new Date(Date.now() + 7 * DIA),
      revokedAt: new Date(Date.now() - 40 * DIA),
    });
    // Expirada, mas dentro da janela de 30 dias: ainda serve de prova de acesso.
    const recente = await criarSessao({ expiresAt: new Date(Date.now() - 2 * DIA) });
    const viva = await criarSessao({ expiresAt: new Date(Date.now() + 7 * DIA) });

    await __jobs.purgeExpiredCredentials();

    expect(await existe('Session', antiga)).toBe(false);
    expect(await existe('Session', revogadaHaMuito)).toBe(false);
    expect(await existe('Session', recente)).toBe(true);
    expect(await existe('Session', viva)).toBe(true);
  });

  it('remove token de recuperacao usado ou vencido ha mais de 30 dias', async () => {
    const ids = await runUnscoped('fixture', async () => {
      const vencido = await prisma.passwordResetToken.create({
        data: { userId: usuario.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() - 40 * DIA) },
      });
      const usado = await prisma.passwordResetToken.create({
        data: {
          userId: usuario.id,
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + DIA),
          usedAt: new Date(Date.now() - 40 * DIA),
        },
      });
      const valido = await prisma.passwordResetToken.create({
        data: { userId: usuario.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + DIA) },
      });
      return { vencido: vencido.id, usado: usado.id, valido: valido.id };
    });

    await __jobs.purgeExpiredCredentials();

    expect(await existe('PasswordResetToken', ids.vencido)).toBe(false);
    expect(await existe('PasswordResetToken', ids.usado)).toBe(false);
    expect(await existe('PasswordResetToken', ids.valido)).toBe(true);
  });

  it('a purga deixa registro na trilha de auditoria', async () => {
    await criarSessao({ expiresAt: new Date(Date.now() - 40 * DIA) });

    await __jobs.purgeExpiredCredentials();

    const trilha = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ description: string }>>`
        SELECT description FROM "AuditLog" WHERE action = 'LGPD_FORGET_EXECUTED' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(trilha).toHaveLength(1);
    expect(trilha[0]!.description).toContain('Purga automática');
  });

  it('sem nada a purgar a rotina nao inventa evento de auditoria', async () => {
    await criarSessao({ expiresAt: new Date(Date.now() + 7 * DIA) });

    await __jobs.purgeExpiredCredentials();

    const trilha = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM "AuditLog" WHERE action = 'LGPD_FORGET_EXECUTED'`,
    );
    expect(Number(trilha[0]!.n)).toBe(0);
  });
});

describe('minimizacao de IP na trilha', () => {
  /*
   * Retencao de dado pessoal sem prazo e o achado que este job fecha. A trilha
   * precisa do IP para responder "de onde partiu", entao a saida nao e apagar:
   * e reduzir a rede depois de 12 meses, preservando a linha e a cadeia.
   */
  async function gravarTrilha(ip: string, idadeEmDias: number): Promise<string> {
    return runUnscoped('fixture', async () => {
      const criado = await prisma.auditLog.create({
        data: {
          companyId: alfa.id,
          action: 'AUTH_LOGIN_SUCCESS',
          description: 'entrada para o teste de minimizacao',
          ipAddress: ip,
          hash: `h-${ip}-${idadeEmDias}`,
          prevHash: null,
        },
      });
      // `createdAt` tem default; empurrar para tras exige SQL cru.
      const quando = new Date(Date.now() - idadeEmDias * DIA);
      await prisma.$executeRaw`UPDATE "AuditLog" SET "createdAt" = ${quando} WHERE id = ${criado.id}`;
      return criado.id;
    });
  }

  async function ipDe(id: string): Promise<string | null> {
    const [linha] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ ipAddress: string | null }>>`
        SELECT "ipAddress" FROM "AuditLog" WHERE id = ${id}`,
    );
    return linha?.ipAddress ?? null;
  }

  it('IPv4 com mais de 12 meses vira a rede /24; o recente fica intacto', async () => {
    const velho = await gravarTrilha('200.147.35.149', 400);
    const novo = await gravarTrilha('200.147.35.150', 10);

    await __jobs.minimizarIpsAntigos();

    expect(await ipDe(velho)).toBe('200.147.35.0/24');
    // O recente continua identificando: a investigacao de um incidente de
    // ontem precisa dele inteiro.
    expect(await ipDe(novo)).toBe('200.147.35.150');
  });

  it('IPv6 antigo vira /48', async () => {
    const velho = await gravarTrilha('2804:14d:baa0:8f5a:1:2:3:4', 400);
    await __jobs.minimizarIpsAntigos();
    expect(await ipDe(velho)).toBe('2804:14d:baa0::/48');
  });

  it('rodar duas vezes nao trunca o que ja foi truncado', async () => {
    const velho = await gravarTrilha('10.20.30.40', 400);

    await __jobs.minimizarIpsAntigos();
    const primeira = await ipDe(velho);
    await __jobs.minimizarIpsAntigos();

    expect(primeira).toBe('10.20.30.0/24');
    // Sem o filtro `NOT LIKE '%/%'`, a segunda passada produziria
    // "10.20.30.0/24" -> "10.20.0.0/24" e assim por diante, apagando por
    // erosao o que deveria ter sido preservado.
    expect(await ipDe(velho)).toBe(primeira);
  });

  it('linha sem IP nao e tocada', async () => {
    const semIp = await runUnscoped('fixture', () =>
      prisma.auditLog.create({
        data: {
          companyId: alfa.id,
          action: 'AUTH_LOGOUT',
          description: 'sem ip',
          ipAddress: null,
          hash: 'h-sem-ip',
          prevHash: null,
        },
      }),
    );
    await runUnscoped('fixture', () =>
      prisma.$executeRaw`UPDATE "AuditLog" SET "createdAt" = ${new Date(Date.now() - 400 * DIA)} WHERE id = ${semIp.id}`,
    );

    await __jobs.minimizarIpsAntigos();
    expect(await ipDe(semIp.id)).toBeNull();
  });
});
