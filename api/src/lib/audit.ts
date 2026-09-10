import crypto from 'node:crypto';
import { prisma } from './prisma';
import { runUnscoped, getContext } from './request-context';
import { logger } from './logger';
import { registrarFalhaDeAuditoria } from './metrics';

/**
 * Trilha de auditoria append-only encadeada por hash.
 *
 * Cada registro carrega o hash do anterior da mesma empresa. Editar ou apagar
 * uma linha no meio quebra a cadeia e `verifyChain()` aponta onde - que e a
 * diferenca entre um log que prova alguma coisa e um log que so consola.
 */

export type AuditAction =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_LOGOUT'
  | 'AUTH_LOCKED'
  | 'AUTH_REFRESH_REUSE_DETECTED'
  | 'AUTH_2FA_ENABLED'
  | 'AUTH_2FA_DISABLED'
  | 'AUTH_PASSWORD_RESET'
  | 'AUTH_PASSKEY_ADDED'
  | 'USER_INVITED'
  | 'USER_ROLE_CHANGED'
  | 'COMPANY_STATUS_CHANGED'
  | 'USER_ARCHIVED'
  | 'FILE_UPLOADED'
  | 'FILE_DELETED'
  | 'DRIVER_CREATED'
  | 'DRIVER_UPDATED'
  | 'DRIVER_ARCHIVED'
  | 'STUDENT_CREATED'
  | 'STUDENT_UPDATED'
  | 'STUDENT_DELETED'
  | 'VEHICLE_CREATED'
  | 'VEHICLE_UPDATED'
  | 'VEHICLE_DELETED'
  | 'EXPENSE_CREATED'
  | 'EXPENSE_DELETED'
  | 'INVOICE_CREATED'
  | 'INVOICE_PAID'
  | 'CHARTER_CREATED'
  | 'CHARTER_UPDATED'
  | 'CHARTER_ASSIGNED'
  | 'CHARTER_STATUS_CHANGED'
  | 'CHARTER_DELETED'
  | 'NOTE_CREATED'
  | 'NOTE_DELETED'
  | 'INCIDENT_BROADCAST'
  | 'TEAM_MESSAGE_SENT'
  | 'AI_CAMPAIGN_CREATED'
  | 'AI_CAMPAIGN_UPDATED'
  | 'AI_POST_APPROVED'
  | 'AI_POST_REJECTED'
  | 'AI_POST_PUBLISHED'
  | 'TIMECARD_PUNCH'
  | 'LGPD_DATA_EXPORT'
  | 'LGPD_CONSENT_UPDATE'
  | 'LGPD_FORGET_REQUEST'
  | 'LGPD_FORGET_EXECUTED'
  | 'SECURITY_SHIELD_BLOCK'
  | 'SECURITY_TENANT_VIOLATION'
  | 'WEBHOOK_RECEIVED'
  | 'WEBHOOK_REJECTED';

interface AuditInput {
  action: AuditAction;
  description: string;
  companyId?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Chave de 64 bits para o advisory lock, derivada da empresa.
 *
 * O Postgres so aceita inteiro; usamos os 63 bits altos do SHA-256 do id para
 * caber em `bigint` com sinal. Colisao entre empresas apenas as faria esperar
 * uma pela outra — degradacao de desempenho, nunca cadeia trocada.
 */
function travaDaEmpresa(companyId: string | null): bigint {
  const digest = crypto.createHash('sha256').update(companyId ?? 'PLATAFORMA').digest();
  return digest.readBigUInt64BE(0) & 0x7fff_ffff_ffff_ffffn;
}

function computeHash(input: {
  prevHash: string | null;
  action: string;
  description: string;
  companyId: string | null;
  userId: string | null;
  at: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      [input.prevHash ?? 'GENESIS', input.action, input.description, input.companyId ?? '-', input.userId ?? '-', input.at].join(
        '|',
      ),
    )
    .digest('hex');
}

/**
 * Grava o evento. NUNCA lanca: auditoria que derruba a operacao principal vira
 * o primeiro `try/catch` vazio que alguem adiciona sob pressao. Falha aqui vira
 * log de erro alto, e a operacao segue.
 */
export async function audit(input: AuditInput): Promise<void> {
  const ctx = getContext();
  const companyId = input.companyId ?? ctx?.tenantId ?? null;
  const userId = input.userId ?? ctx?.userId ?? null;

  try {
    await runUnscoped('audit-chain', async () => {
      await prisma.$transaction(async (tx) => {
        /**
         * Trava de escrita por empresa, dentro da transacao.
         *
         * Ler o ultimo hash e depois gravar sao dois passos, e sem esta trava
         * duas acoes auditadas simultaneas da MESMA empresa liam o mesmo
         * `prevHash` e criavam dois elos apontando para o mesmo antecessor. A
         * cadeia bifurcava, e `verifyChain()` passava a acusar rompimento para
         * sempre — a trilha deixava de servir como prova exatamente quando o
         * sistema estava sendo mais usado. Foi observado aqui com dois
         * `GET /privacy/export` em paralelo.
         *
         * `pg_advisory_xact_lock` serializa apenas os concorrentes da mesma
         * empresa e e liberado no fim da transacao, inclusive se ela abortar.
         * A chave e o hash da empresa; `null` (acao de plataforma) tem chave
         * propria e nao disputa com ninguem.
         */
        const chave = travaDaEmpresa(companyId);
        // Nao le nem escreve tabela nenhuma: pede ao Postgres uma trava
        // consultiva cuja chave e derivada do proprio companyId. Nao ha
        // superficie para cruzar empresas, e o Prisma nao expoe advisory lock
        // pela API tipada.
        //
        // `$executeRaw`, e nao `$queryRaw`: a funcao devolve `void`, e o
        // `$queryRaw` tenta desserializar a coluna e falha com P2010. Como
        // `audit()` engole excecao para nunca derrubar a operacao principal, o
        // efeito foi a trilha parar de gravar EM SILENCIO — o mesmo erro que
        // este arquivo existe para impedir.
        // GUARDA: sql-cru-auditado — trava consultiva por empresa, sem tabela.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chave}::bigint)`;

        const prev = await tx.auditLog.findFirst({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          select: { hash: true },
        });

        const at = new Date().toISOString();
        const hash = computeHash({
          prevHash: prev?.hash ?? null,
          action: input.action,
          description: input.description,
          companyId,
          userId,
          at,
        });

        await tx.auditLog.create({
          data: {
            // createdAt explicito: o hash e calculado sobre ele, e deixar o
            // default do banco preencher faria a verificacao comparar
            // timestamps diferentes.
            createdAt: new Date(at),
            companyId,
            userId,
            action: input.action,
            description: input.description,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
            prevHash: prev?.hash ?? null,
            hash,
          },
        });
      });
    });
  } catch (err) {
    // Contabilizado alem de logado: `audit()` nunca lanca, de proposito, para
    // nao derrubar a operacao principal. O preco disso e que a falha e muda —
    // e foi assim que uma trava mal escrita parou a trilha inteira sem ninguem
    // notar. Esta metrica deve ficar em ZERO; qualquer valor acima merece
    // alerta, porque significa que o sistema perdeu a capacidade de provar o
    // que aconteceu.
    registrarFalhaDeAuditoria();
    logger.error({ err, action: input.action }, 'falha ao gravar audit log');
  }
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt?: { id: string; createdAt: Date };
}

/** Reexecuta a cadeia da empresa e diz onde ela quebrou, se quebrou. */
export async function verifyChain(companyId: string | null): Promise<ChainVerification> {
  return runUnscoped('audit-verify', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { companyId },
      // `id` como desempate: duas linhas no mesmo milissegundo teriam ordem
      // indefinida, e a verificacao acusaria rompimento conforme o humor do
      // planejador de consultas.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    let prevHash: string | null = null;
    for (const row of rows) {
      const expected = computeHash({
        prevHash,
        action: row.action,
        description: row.description,
        companyId: row.companyId,
        userId: row.userId,
        at: row.createdAt.toISOString(),
      });
      if (row.prevHash !== prevHash || row.hash !== expected) {
        return { ok: false, checked: rows.length, brokenAt: { id: row.id, createdAt: row.createdAt } };
      }
      prevHash = row.hash;
    }
    return { ok: true, checked: rows.length };
  });
}
