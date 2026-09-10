import { z } from 'zod';

/**
 * Dinheiro trafega e e guardado em CENTAVOS INTEIROS.
 *
 * `0.1 + 0.2 !== 0.3` em ponto flutuante. Num DRE que soma centenas de
 * mensalidades por mes o erro acumula e a conciliacao nunca fecha - por isso
 * o schema usa Int e a fronteira converte. Float so aparece na formatacao final.
 */

export const MAX_CENTS = 99_999_999_99; // R$ 99.999.999,99

/** Reais (numero ou string "1234,56") -> centavos inteiros. */
export function toCents(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Valor monetário inválido');
    return Math.round(value * 100);
  }
  const normalized = value.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new RangeError(`Valor monetário inválido: ${value}`);
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Schema de entrada para valores em reais vindos do cliente.
 * Aceita `199.9`, `199,90` e `"R$ 199,90"`, devolve centavos.
 */
export const brlInput = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    try {
      const cents = toCents(typeof v === 'string' ? v.replace(/R\$\s*/i, '') : v);
      if (cents < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor não pode ser negativo' });
        return z.NEVER;
      }
      if (cents > MAX_CENTS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor acima do limite permitido' });
        return z.NEVER;
      }
      return cents;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor monetário inválido' });
      return z.NEVER;
    }
  });

/** Serializacao consistente para o front: centavos + ja formatado. */
export function money(cents: number) {
  return { cents, formatted: formatBRL(cents) };
}
