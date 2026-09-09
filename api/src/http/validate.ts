import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { Errors } from '../lib/errors';

/**
 * Validacao de entrada com zod na fronteira.
 *
 * O handler recebe `req.valid` ja tipado e NUNCA le `req.body` cru. Isso e o
 * que torna o mass-assignment impossivel: campo que nao esta no schema nao
 * chega no Prisma, entao ninguem promove a si mesmo mandando `"role":"OWNER"`
 * no corpo de um update de perfil.
 */

export interface ValidSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      valid: { body: any; query: any; params: any };
    }
  }
}

export function validate(schemas: ValidSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: Array<{ campo: string; erro: string }> = [];
    const out: Request['valid'] = { body: {}, query: {}, params: {} };

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse(req[key]);
      if (parsed.success) {
        out[key] = parsed.data;
      } else {
        for (const issue of parsed.error.issues) {
          issues.push({ campo: [key, ...issue.path].join('.'), erro: issue.message });
        }
      }
    }

    if (issues.length) return next(Errors.validation(issues));
    req.valid = out;
    next();
  };
}

// ---------------------------------------------------------------------------
// Blocos reutilizaveis
// ---------------------------------------------------------------------------

export const uuidParam = (name = 'id') => z.object({ [name]: z.string().uuid('identificador inválido') });

/** Paginacao obrigatoria: listagem sem teto e o DoS que o proprio cliente causa. */
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof pagination>;

export function paginate<T>(items: T[], total: number, { page, perPage }: Pagination) {
  return {
    items,
    meta: {
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      hasNext: page * perPage < total,
    },
  };
}

export function skipTake({ page, perPage }: Pagination) {
  return { skip: (page - 1) * perPage, take: perPage };
}

/** Senha forte. Comprimento pesa mais que simbolo — NIST SP 800-63B. */
export const strongPassword = z
  .string()
  .min(12, 'A senha precisa de pelo menos 12 caracteres')
  .max(128, 'A senha é longa demais')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), 'Use letras maiúsculas e minúsculas')
  .refine((v) => /\d/.test(v), 'Use pelo menos um número')
  .refine(
    (v) => !/^(senha|password|123456|qwerty|vanpro)/i.test(v),
    'Essa senha é previsível demais. Escolha outra.',
  );

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('E-mail inválido')
  .max(254);

/** CPF/CNPJ com digito verificador conferido — nao so o formato. */
export const documentField = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 11 || v.length === 14, 'Informe um CPF (11) ou CNPJ (14 dígitos)')
  .refine((v) => (v.length === 11 ? isValidCPF(v) : isValidCNPJ(v)), 'Documento inválido');

export function isValidCPF(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const d = (sum * 10) % 11;
    return d === 10 ? 0 : d;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCNPJ(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const d = sum % 11;
    return d < 2 ? 0 : 11 - d;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** Placa Mercosul (ABC1D23) ou antiga (ABC1234). */
export const plateField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[^A-Z0-9]/g, ''))
  .refine((v) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(v), 'Placa inválida');

export const shiftField = z.enum(['MORNING', 'AFTERNOON', 'FULL']);
export const roleField = z.enum(['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT']);

/** Texto livre: limite explicito evita que "observacao" vire vetor de payload. */
export const text = (max: number, label = 'campo') =>
  z.string().trim().min(1, `${label} é obrigatório`).max(max, `${label} excede ${max} caracteres`);
