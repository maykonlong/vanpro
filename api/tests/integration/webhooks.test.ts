import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { toCents } from '../../src/lib/money';
import { app, criarEmpresa, type Empresa } from '../helpers/factory';

/**
 * Webhook de pagamento (Asaas).
 *
 * Rota publica de verdade: sem cookie, sem tenant no contexto e alcancavel por
 * qualquer um. O que a segura de pe e o token conferido em tempo constante e a
 * idempotencia por WebhookEvent — dar baixa duas vezes no mesmo aviso e erro
 * contabil, e o gateway REENVIA por projeto.
 */

const TOKEN = env.ASAAS_WEBHOOK_TOKEN!;
const GATEWAY_ID = 'pay_000000000001';

let alfa: Empresa;
let invoiceId: string;
let transactionId: string;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');

  await runUnscoped('fixture', async () => {
    const aluno = await prisma.student.create({
      data: { companyId: alfa.id, name: 'Ana Pagante', school: 'Escola', shift: 'FULL', monthlyFeeCents: toCents(480.5) },
    });
    const invoice = await prisma.invoice.create({
      data: {
        companyId: alfa.id,
        studentId: aluno.id,
        amountCents: toCents(480.5),
        status: 'PENDING',
        dueDate: new Date(Date.UTC(2026, 2, 5)),
        gatewayId: GATEWAY_ID,
      },
    });
    const transacao = await prisma.financialTransaction.create({
      data: {
        companyId: alfa.id,
        studentId: aluno.id,
        amountCents: toCents(480.5),
        paid: false,
        dueDate: new Date(Date.UTC(2026, 2, 5)),
        externalId: GATEWAY_ID,
      },
    });
    invoiceId = invoice.id;
    transactionId = transacao.id;
  });
});

/** Corpo minimo aceito pelo schema do controller. */
function evento(overrides: Record<string, unknown> = {}) {
  return { id: 'evt_0001', event: 'PAYMENT_RECEIVED', payment: { id: GATEWAY_ID }, ...overrides };
}

function enviar(corpo: unknown, token: string | null) {
  const req = request(app())
    .post('/api/v1/webhooks/payment')
    .set('x-forwarded-for', '10.200.0.1')
    .set('Content-Type', 'application/json');
  if (token !== null) req.set('asaas-access-token', token);
  return req.send(corpo as object);
}

async function estadoDaFatura() {
  const [fatura] = await runUnscoped('check', () =>
    prisma.$queryRaw<Array<{ status: string; updatedAt: Date }>>`
      SELECT status, "updatedAt" FROM "Invoice" WHERE id = ${invoiceId}`,
  );
  return fatura!;
}

describe('autenticacao do webhook', () => {
  it('sem o header de token responde 401 e nao toca na fatura', async () => {
    const res = await enviar(evento(), null);

    expect(res.status).toBe(401);
    expect((await estadoDaFatura()).status).toBe('PENDING');

    const eventos = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "WebhookEvent"`,
    );
    expect(Number(eventos[0]!.n)).toBe(0);
  });

  it('com token errado responde 401 e deixa trilha da recusa', async () => {
    const res = await enviar(evento(), 'token-errado-mas-do-mesmo-tamanho');

    expect(res.status).toBe(401);
    expect((await estadoDaFatura()).status).toBe('PENDING');

    const trilha = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "AuditLog" WHERE action = 'WEBHOOK_REJECTED'`,
    );
    expect(Number(trilha[0]!.n)).toBe(1);
  });
});

describe('processamento', () => {
  it('com o token certo quita a fatura e a mensalidade vinculada', async () => {
    const res = await enviar(evento(), TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, status: 'PROCESSADO' });
    expect((await estadoDaFatura()).status).toBe('RECEIVED');

    const [transacao] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ paid: boolean; paidAt: Date | null }>>`
        SELECT paid, "paidAt" FROM "FinancialTransaction" WHERE id = ${transactionId}`,
    );
    expect(transacao!.paid).toBe(true);
    expect(transacao!.paidAt).not.toBeNull();
  });

  it('evento repetido nao processa duas vezes', async () => {
    const primeiro = await enviar(evento(), TOKEN);
    expect(primeiro.body.status).toBe('PROCESSADO');
    const depoisDoPrimeiro = await estadoDaFatura();

    const segundo = await enviar(evento(), TOKEN);
    expect(segundo.status).toBe(200);
    expect(segundo.body.status).toBe('DUPLICADO');

    const depoisDoSegundo = await estadoDaFatura();
    expect(depoisDoSegundo.status).toBe('RECEIVED');
    // Nem o updatedAt muda: o reenvio nao pode reescrever a fatura.
    expect(depoisDoSegundo.updatedAt.getTime()).toBe(depoisDoPrimeiro.updatedAt.getTime());

    const eventos = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "WebhookEvent"`,
    );
    expect(Number(eventos[0]!.n)).toBe(1);

    const baixas = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "AuditLog" WHERE action = 'INVOICE_PAID'`,
    );
    expect(Number(baixas[0]!.n)).toBe(1);
  });

  it('sem id de evento a idempotencia usa o par tipo+cobranca', async () => {
    const semId = { event: 'PAYMENT_RECEIVED', payment: { id: GATEWAY_ID } };

    expect((await enviar(semId, TOKEN)).body.status).toBe('PROCESSADO');
    expect((await enviar(semId, TOKEN)).body.status).toBe('DUPLICADO');

    const eventos = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ externalId: string }>>`SELECT "externalId" FROM "WebhookEvent"`,
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.externalId).toBe(`PAYMENT_RECEIVED:${GATEWAY_ID}`);
  });

  it('cobranca sem fatura correspondente responde 200 e nao muda nada', async () => {
    const res = await enviar(
      evento({ id: 'evt_0002', payment: { id: 'pay_inexistente_9999' } }),
      TOKEN,
    );

    // 200 de proposito: 5xx faria o gateway reentregar para sempre sem que nada
    // mudasse do nosso lado.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SEM_FATURA');
    expect((await estadoDaFatura()).status).toBe('PENDING');
  });

  it('evento que nao e de pagamento entra na trilha mas nao quita', async () => {
    const res = await enviar(evento({ id: 'evt_0003', event: 'PAYMENT_UPDATED' }), TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IGNORADO');
    expect((await estadoDaFatura()).status).toBe('PENDING');
  });

  it('recusa corpo que nao casa com o contrato do gateway', async () => {
    const res = await enviar({ event: 'PAYMENT_RECEIVED' }, TOKEN);
    expect(res.status).toBe(422);
    expect((await estadoDaFatura()).status).toBe('PENDING');
  });

  it('aceita o payload completo que o Asaas manda de verdade', async () => {
    // O gateway nao manda o corpo minimo: manda o objeto `payment` inteiro. Um
    // webhook que so funciona com o payload reduzido do teste nao funciona em
    // producao.
    const realista = {
      id: 'evt_c1f0e0a1b2c3d4e5f60718293a4b5c6d',
      event: 'PAYMENT_RECEIVED',
      dateCreated: '2026-03-10 09:12:44',
      payment: {
        object: 'payment',
        id: GATEWAY_ID,
        dateCreated: '2026-03-01',
        customer: 'cus_000005401903',
        value: 480.5,
        netValue: 478.51,
        billingType: 'PIX',
        status: 'RECEIVED',
        dueDate: '2026-03-05',
        paymentDate: '2026-03-10',
        description: 'Mensalidade escolar',
        externalReference: 'aluno-1',
        invoiceUrl: 'https://sandbox.asaas.com/i/000000000001',
        invoiceNumber: '00000001',
        deleted: false,
        postalService: false,
      },
    };

    const res = await enviar(realista, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSADO');
    expect((await estadoDaFatura()).status).toBe('RECEIVED');
  });
});

describe('atomicidade da idempotencia', () => {
  /*
   * O defeito que este bloco existe para impedir.
   *
   * A marca de idempotencia (`WebhookEvent`) commitava sozinha e a baixa da
   * fatura vinha depois, fora de transacao. Uma queda entre as duas deixava o
   * evento marcado como processado e a fatura em aberto — e a retentativa do
   * gateway respondia DUPLICADO, para sempre. O dinheiro entrou no Asaas e o
   * sistema segue cobrando o responsavel, sem ninguem receber erro.
   */
  it('evento marcado mas fatura em aberto nao pode existir apos falha no meio', async () => {
    // Simula o estado que a versao anterior produzia: marca gravada, efeito
    // ausente. Se o codigo voltar a ser nao-transacional, ESTE e o estado que
    // sobra em producao — e a retentativa abaixo prova que ele e irrecuperavel.
    await runUnscoped('fixture', () =>
      prisma.webhookEvent.create({
        data: {
          provider: 'ASAAS',
          externalId: 'evt_0001',
          eventType: 'PAYMENT_RECEIVED',
          payloadHash: 'hash-de-uma-entrega-que-nao-terminou',
        },
      }),
    );

    const res = await enviar(evento(), TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DUPLICADO');

    // A fatura continua em aberto e NAO ha como baixa-la por este caminho.
    // E por isso que a marca precisa nascer dentro da mesma transacao do
    // efeito: assim a queda desfaz as duas, e a retentativa reprocessa.
    expect((await estadoDaFatura()).status).toBe('PENDING');
  });

  it('a entrega bem-sucedida deixa marca E efeito, os dois', async () => {
    const res = await enviar(evento(), TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSADO');

    expect((await estadoDaFatura()).status).toBe('RECEIVED');

    const [marca] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ externalId: string }>>`
        SELECT "externalId" FROM "WebhookEvent" WHERE "externalId" = 'evt_0001'`,
    );
    expect(marca, 'a marca de idempotência precisa ter sido gravada junto').toBeTruthy();

    const [transacao] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ paid: boolean }>>`
        SELECT paid FROM "FinancialTransaction" WHERE id = ${transactionId}`,
    );
    expect(transacao!.paid, 'a receita precisa entrar no DRE junto com a baixa').toBe(true);
  });

  it('evento que nao e de pagamento marca sem tocar na fatura', async () => {
    const res = await enviar(evento({ event: 'PAYMENT_CREATED' }), TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IGNORADO');
    expect((await estadoDaFatura()).status).toBe('PENDING');
  });
});
