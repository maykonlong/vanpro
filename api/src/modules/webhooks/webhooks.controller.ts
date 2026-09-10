import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { runUnscoped } from '../../lib/request-context';

/**
 * GUARDA: rota-publica-intencional
 *
 * Chamado pelo gateway de pagamento, que nao tem cookie de sessao.
 * A autenticacao aqui e HMAC do token do provedor, conferido em tempo
 * constante, mais idempotencia por WebhookEvent.
 */

/**
 * Webhooks de pagamento (Asaas).
 *
 * Esta rota e PUBLICA: nao tem cookie de sessao, nao tem tenant no contexto e
 * qualquer um na internet consegue chama-la. Tres coisas seguram isso de pe:
 *
 *  1. assinatura conferida em tempo constante — sem ela, um estranho quita a
 *     fatura que quiser mandando um JSON;
 *  2. idempotencia por `WebhookEvent` — o gateway reenvia o mesmo evento, e
 *     dar baixa duas vezes e erro contabil;
 *  3. o tenant e resolvido a partir da fatura encontrada pelo `gatewayId`,
 *     NUNCA do corpo da requisicao. `companyId` vindo do payload seria um
 *     seletor de empresa entregue ao atacante.
 *
 * O corpo chega como Buffer (`express.raw` montado antes do `express.json`),
 * porque a assinatura e conferida sobre bytes e o hash de idempotencia tambem.
 */

const router = Router();

const PROVIDER = 'ASAAS';

/** Eventos que significam dinheiro na conta. Os demais so entram na trilha. */
const EVENTOS_DE_PAGAMENTO = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);

const payloadSchema = z.object({
  /** Id do evento no gateway; base da idempotencia quando presente. */
  id: z.string().min(1).max(200).optional(),
  event: z.string().min(1).max(120),
  payment: z.object({
    id: z.string().min(1).max(200),
    value: z.number().optional(),
    status: z.string().max(60).optional(),
  }),
});

/**
 * Comparacao em tempo constante sobre digests: `timingSafeEqual` exige buffers
 * do mesmo tamanho, e comparar os textos crus vazaria o comprimento do token
 * pelo proprio erro de tamanho.
 */
function tokenConfere(recebido: string, esperado: string): boolean {
  const a = crypto.createHash('sha256').update(recebido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

router.post('/payment', async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;
  const enviado = req.get('asaas-access-token');
  const esperado = env.ASAAS_WEBHOOK_TOKEN;

  // Token ausente na configuracao tambem reprova: "nao sei validar" nunca pode
  // virar "entao aceita".
  if (!esperado || !enviado || !tokenConfere(enviado, esperado)) {
    await audit({
      action: 'WEBHOOK_REJECTED',
      description: `Webhook ${PROVIDER} recusado: assinatura ausente ou divergente.`,
      companyId: null,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    throw Errors.unauthorized('Assinatura do webhook inválida.');
  }

  if (!raw || raw.length === 0) {
    throw Errors.validation([{ campo: 'body', erro: 'Corpo do webhook vazio.' }]);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf8'));
  } catch {
    throw Errors.validation([{ campo: 'body', erro: 'Corpo do webhook não é JSON válido.' }]);
  }

  const parsed = payloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw Errors.validation(
      parsed.error.issues.map((i) => ({ campo: `body.${i.path.join('.')}`, erro: i.message })),
    );
  }
  const evento = parsed.data;

  // Quando o gateway nao manda id de evento, a chave de idempotencia e o par
  // tipo+cobranca: reenvio do mesmo aviso continua sendo o mesmo fato.
  const externalId = evento.id ?? `${evento.event}:${evento.payment.id}`;
  const payloadHash = crypto.createHash('sha256').update(raw).digest('hex');

  await audit({
    action: 'WEBHOOK_RECEIVED',
    description: `Webhook ${PROVIDER} ${evento.event} recebido para a cobrança ${evento.payment.id}.`,
    companyId: null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });

  // Sem sessao nao ha tenant no contexto; o escopo e aberto de forma explicita
  // e, dentro dele, TODO `where` de modelo multi-tenant filtra companyId a mao.
  /*
   * A marca de idempotencia e o efeito vivem na MESMA transacao.
   *
   * Antes, `webhookEvent.create` commitava sozinho e a baixa da fatura vinha
   * depois. Entre uma coisa e outra cabe uma queda do processo, um erro do
   * banco, um deploy no meio — e o estado que sobrava era o pior possivel: o
   * evento marcado como processado e a fatura em aberto. A retentativa do
   * gateway batia na unique, respondia DUPLICADO, e aquele pagamento nunca
   * seria baixado. Ninguem receberia erro; o dinheiro entrou no Asaas e o
   * sistema segue cobrando o responsavel.
   *
   * Dentro da transacao, a queda desfaz a marca junto com o efeito e a
   * retentativa reprocessa — que e o que "idempotente" precisa significar.
   *
   * A protecao contra entrega simultanea continua inteira: a insercao na
   * unique acontece dentro da transacao, a segunda entrega espera no indice e
   * falha ao liberar.
   */
  const resultado = await runUnscoped('webhook-asaas', () =>
    prisma.$transaction(async (tx) => {
      try {
        await tx.webhookEvent.create({
          data: {
            provider: PROVIDER,
            externalId,
            eventType: evento.event,
            payloadHash,
          },
        });
      } catch {
        // Colisao na unique (provider, externalId): ja processamos este evento.
        return { status: 'DUPLICADO' as const, invoiceId: null, companyId: null };
      }

      if (!EVENTOS_DE_PAGAMENTO.has(evento.event)) {
        return { status: 'IGNORADO' as const, invoiceId: null, companyId: null };
      }

      const invoice = await tx.invoice.findFirst({
        where: { gatewayId: evento.payment.id },
        select: { id: true, companyId: true, studentId: true, amountCents: true, status: true },
      });

      if (!invoice) {
        // Cobranca de outro ambiente (sandbox/producao compartilhando token) ou
        // criada fora do sistema. Registrar e seguir: 200 evita retentativa eterna.
        logger.warn({ gatewayId: evento.payment.id }, 'webhook Asaas sem fatura correspondente');
        return { status: 'SEM_FATURA' as const, invoiceId: null, companyId: null };
      }

      if (invoice.status === 'RECEIVED') {
        return { status: 'DUPLICADO' as const, invoiceId: invoice.id, companyId: invoice.companyId };
      }

      const companyId = invoice.companyId;

      await tx.invoice.update({
        where: { id: invoice.id, companyId },
        data: { status: 'RECEIVED' },
      });

      // `updateMany` porque `externalId` e unico mas pode nao existir (fatura
      // criada antes do par transacao/cobranca); zero linhas afetadas e aceitavel.
      await tx.financialTransaction.updateMany({
        where: { externalId: evento.payment.id, companyId, paid: false },
        data: { paid: true, paidAt: new Date() },
      });

      return { status: 'PROCESSADO' as const, invoiceId: invoice.id, companyId };
    }),
  );

  /*
   * A trilha e escrita DEPOIS do commit, e nao dentro dele.
   *
   * `audit()` abre transacao propria e pede uma trava consultiva: chamado de
   * dentro da transacao do webhook, ele gravaria por um cliente diferente e
   * sobreviveria a um rollback — a trilha afirmaria "pagamento confirmado"
   * sobre uma fatura que continuou em aberto. Trilha que mente e pior que
   * trilha ausente.
   */
  if (resultado.status === 'PROCESSADO') {
    await audit({
      action: 'INVOICE_PAID',
      description: `Pagamento confirmado pelo ${PROVIDER} (cobrança ${evento.payment.id}) para a fatura ${resultado.invoiceId}.`,
      companyId: resultado.companyId,
      userId: null,
    });
  }

  // Sempre 200 depois da assinatura validada: 5xx aqui faz o gateway repetir a
  // entrega indefinidamente sem que nada mude do nosso lado.
  res.status(200).json({ received: true, status: resultado.status });
});

export default router;
