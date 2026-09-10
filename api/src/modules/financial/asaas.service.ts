import { env, features } from '../../config/env';
import { tenantId } from '../../lib/tenant';
import { prisma } from '../../lib/prisma';
import { Errors, AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { currentTenantId } from '../../lib/request-context';
import { fromCents } from '../../lib/money';
import { exigirModoSeguro } from './trava-cobranca';

/**
 * Integracao com o Asaas (cobranca Pix).
 *
 * Duas regras carregam este arquivo inteiro:
 *
 *  1. Sem credencial a feature RESPONDE 503, nunca simula. A versao anterior
 *     gravava `companyId: 'mock-company'` com um `gatewayId` inventado quando a
 *     chave faltava — fatura falsa no banco de producao, conciliacao impossivel.
 *  2. Nada de identificador fixo. O cliente no gateway e resolvido pelo
 *     documento do responsavel real do aluno; o `companyId` sai do contexto de
 *     tenant ou do proprio Student carregado, jamais de um literal.
 */

/**
 * Primeira coisa que este modulo faz, e de proposito.
 *
 * Ausencia de credencial ja tinha resposta (503 FEATURE_DISABLED). O terceiro
 * estado — credencial apontando para o endpoint de PRODUCAO num ambiente que
 * nao e producao — nao tinha nenhuma, e e justamente o que cobra uma pessoa de
 * verdade a partir da maquina de um desenvolvedor. Lanca no import: subir e so
 * avisar seria descobrir o erro pelo extrato do cliente.
 */
const modoCobranca = exigirModoSeguro();
if (modoCobranca) {
  logger.info(
    { modo: modoCobranca.modo, dinheiroReal: modoCobranca.real },
    'trava de cobranca liberou o modulo financeiro',
  );
}

const TIMEOUT_MS = 10_000;

interface AsaasCustomer {
  id: string;
}

interface AsaasCustomerList {
  data?: AsaasCustomer[];
}

interface AsaasPayment {
  id: string;
  status?: string;
  value?: number;
  dueDate?: string;
  invoiceUrl?: string;
  billingType?: string;
}

export interface CreatePixChargeInput {
  studentId: string;
  amountCents: number;
  dueDate: Date;
  /**
   * CPF/CNPJ de quem paga. Vem da requisicao porque o modelo Student/User nao
   * guarda documento do responsavel — e o Asaas exige um para abrir cliente.
   * Inventar um numero aqui seria a mesma classe de defeito do cliente fixo.
   */
  payerDocument: string;
  /** Usado apenas quando o aluno ainda nao tem responsavel com nome cadastrado. */
  payerName?: string;
}

/**
 * Chamada HTTP unica ao gateway.
 * Timeout explicito: sem ele uma indisponibilidade do Asaas segura o worker do
 * Express ate o timeout do SO e derruba a API inteira junto.
 */
async function asaasFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const apiKey = env.ASAAS_API_KEY;
  if (!apiKey) throw Errors.featureDisabled('Asaas');

  let response: Response;
  try {
    response = await fetch(`${env.ASAAS_API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error({ err, path }, 'falha de rede ao falar com o Asaas');
    throw gatewayError();
  }

  const text = await response.text();

  if (!response.ok) {
    // O corpo do gateway pode trazer dado do pagador: fica no log, nunca na
    // resposta ao cliente.
    logger.error({ status: response.status, path, body: text }, 'Asaas respondeu erro');
    throw gatewayError();
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    logger.error({ err, path }, 'Asaas respondeu corpo que não é JSON');
    throw gatewayError();
  }
}

function gatewayError(): AppError {
  return new AppError(
    502,
    'GATEWAY_ERROR',
    'O gateway de pagamento não respondeu. Nenhuma cobrança foi criada — tente novamente em instantes.',
    undefined,
    'error',
  );
}

/** Asaas espera data pura (YYYY-MM-DD), nao timestamp. */
function toAsaasDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Encontra o cliente pelo documento e, so se nao existir, cria.
 * Buscar antes evita duplicar cadastro a cada mensalidade do mesmo responsavel.
 */
async function resolveCustomer(input: {
  name: string;
  document: string;
  email: string | null;
}): Promise<string> {
  const found = (await asaasFetch(
    `/customers?cpfCnpj=${encodeURIComponent(input.document)}&limit=1`,
  )) as AsaasCustomerList;

  const existing = found.data?.[0]?.id;
  if (existing) return existing;

  const created = (await asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      cpfCnpj: input.document,
      ...(input.email ? { email: input.email } : {}),
    }),
  })) as AsaasCustomer;

  if (!created.id) {
    logger.error({}, 'Asaas criou cliente sem devolver id');
    throw gatewayError();
  }
  return created.id;
}

export const AsaasService = {
  /**
   * Cria a cobranca Pix e persiste o par Invoice + FinancialTransaction.
   *
   * A transacao financeira nasce junto e com `externalId = gatewayId`: e por
   * esse campo que o webhook encontra o que dar baixa. Sem ela, o pagamento
   * confirmado atualizaria a fatura e o DRE continuaria sem a receita.
   */
  async createPixCharge(input: CreatePixChargeInput) {
    if (!features.billing) throw Errors.featureDisabled('Asaas');

    // O guard de tenant filtra por companyId; o aluno de outra empresa
    // simplesmente nao existe nesta consulta.
    const student = await prisma.student.findFirst({
      where: { id: input.studentId },
      select: {
        id: true,
        companyId: true,
        name: true,
        parent: { select: { name: true, email: true } },
      },
    });
    if (!student) throw Errors.notFound('Aluno');

    const payerName = student.parent?.name ?? input.payerName;
    if (!payerName) {
      throw Errors.conflict(
        'Este aluno não tem responsável vinculado. Vincule o responsável ou informe o nome do pagador antes de gerar a cobrança.',
      );
    }

    const customerId = await resolveCustomer({
      name: payerName,
      document: input.payerDocument,
      email: student.parent?.email ?? null,
    });

    const payment = (await asaasFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId,
        billingType: 'PIX',
        // Interno e centavo inteiro; o gateway fala em reais.
        value: fromCents(input.amountCents),
        dueDate: toAsaasDate(input.dueDate),
        description: `Mensalidade escolar - aluno ${student.id}`,
        externalReference: student.id,
      }),
    })) as AsaasPayment;

    if (!payment.id) {
      logger.error({}, 'Asaas criou cobrança sem devolver id');
      throw gatewayError();
    }

    logger.info(
      { companyId: currentTenantId() ?? student.companyId, gatewayId: payment.id },
      'cobrança Pix criada no Asaas',
    );

    // companyId nao aparece aqui de proposito: o guard do Prisma injeta o do
    // contexto — o mesmo que ja limitou a leitura do aluno acima.
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          companyId: tenantId(),
          studentId: student.id,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          status: 'PENDING',
          gatewayId: payment.id,
          paymentUrl: payment.invoiceUrl ?? null,
        },
      });

      await tx.financialTransaction.create({
        data: {
          companyId: tenantId(),
          studentId: student.id,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          paid: false,
          externalId: payment.id,
        },
      });

      return invoice;
    });
  },

  /** Consulta o estado atual da cobranca no gateway (conciliacao manual). */
  async getCharge(gatewayId: string) {
    if (!features.billing) throw Errors.featureDisabled('Asaas');

    const payment = (await asaasFetch(
      `/payments/${encodeURIComponent(gatewayId)}`,
    )) as AsaasPayment;

    return {
      gatewayId: payment.id,
      status: payment.status ?? 'UNKNOWN',
      billingType: payment.billingType ?? null,
      valueCents: typeof payment.value === 'number' ? Math.round(payment.value * 100) : null,
      dueDate: payment.dueDate ?? null,
      paymentUrl: payment.invoiceUrl ?? null,
    };
  },
};
