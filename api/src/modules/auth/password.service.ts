import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Senhas e codigos de recuperacao.
 *
 * Custo 12 e a faixa em que o hash ainda cabe no orcamento de latencia de um
 * login (~250ms em hardware atual) e ja torna forca bruta offline cara. Custo
 * menor economiza milissegundos que o atacante agradece.
 */

const BCRYPT_COST = 12;

/**
 * Hash fixo usado quando o e-mail nao existe.
 *
 * Sem ele, "usuario inexistente" responde em ~1ms e "senha errada" em ~250ms:
 * a mensagem e identica, mas o cronometro entrega a lista de e-mails validos.
 * O valor e constante de proposito — gerar um hash novo a cada chamada custaria
 * o dobro do tempo de um login real e viraria outro sinal mensuravel.
 */
const DUMMY_HASH = '$2a$12$qeNmkf0fQiJvGLloczfP5.DKgMdFkGAlmQvljnY86gvog.C3aRZWy';

/** Dias ate a senha expirar. Alinhado ao que o controller cobra no login. */
export const PASSWORD_MAX_AGE_DAYS = 90;

const RECOVERY_CODE_COUNT = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Queima o mesmo tempo de um compare real. Chamar sempre que o usuario nao existir. */
export async function dummyCompare(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

export function isPasswordExpired(passwordUpdatedAt: Date, now = new Date()): boolean {
  const ageMs = now.getTime() - passwordUpdatedAt.getTime();
  return ageMs > PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export interface RecoveryCodeSet {
  /** Mostrados ao usuario UMA unica vez. Nunca persistidos em claro. */
  codes: string[];
  /** Hashes bcrypt, na mesma ordem. E isso que vai para o banco. */
  hashes: string[];
}

function randomCode(): string {
  // 5 bytes -> 8 caracteres base32-ish. Agrupado em dois blocos para ser
  // transcrito a mao sem erro.
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export async function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): Promise<RecoveryCodeSet> {
  const codes = Array.from({ length: count }, randomCode);
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, BCRYPT_COST)));
  return { codes, hashes };
}

/** Serializa/desserializa os hashes na coluna `twoFactorRecoveryCodes`. */
export function serializeRecoveryHashes(hashes: string[]): string {
  return JSON.stringify(hashes);
}

export function parseRecoveryHashes(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // Coluna corrompida nao pode virar "nenhum codigo confere" silencioso nem
    // travar o login por excecao: devolve lista vazia e o chamador rejeita.
    return [];
  }
}

/**
 * Confere o codigo contra a lista e devolve a lista SEM o codigo usado.
 * Codigo de recuperacao e de uso unico — devolver a lista intacta seria
 * transformar dez chaves descartaveis em dez chaves permanentes.
 */
export async function consumeRecoveryCode(
  code: string,
  hashes: string[],
): Promise<{ ok: boolean; remaining: string[] }> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      return { ok: true, remaining: hashes.filter((_, idx) => idx !== i) };
    }
  }
  return { ok: false, remaining: hashes };
}
