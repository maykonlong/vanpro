import crypto from 'node:crypto';
import { prisma } from './prisma';
import { runUnscoped, getContext } from './request-context';
import { logger } from './logger';

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
      const prev = await prisma.auditLog.findFirst({
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

      await prisma.auditLog.create({
        data: {
          // createdAt explicito: o hash e calculado sobre ele, e deixar o default
          // do banco preencher faria a verificacao comparar timestamps diferentes.
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
  } catch (err) {
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
      orderBy: { createdAt: 'asc' },
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
