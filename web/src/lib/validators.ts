/**
 * Validacao no cliente.
 *
 * Espelha `api/src/http/validate.ts` para dar retorno imediato ao usuario — e
 * NAO substitui a do servidor: a fronteira de seguranca continua sendo o zod
 * do backend. Aqui e so cortesia de UX.
 */

export function isValidCPF(cpf: string): boolean {
  const v = cpf.replace(/\D/g, '');
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(v[i]) * (len + 1 - i);
    const d = (sum * 10) % 11;
    return d === 10 ? 0 : d;
  };
  return calc(9) === Number(v[9]) && calc(10) === Number(v[10]);
}

export function isValidCNPJ(cnpj: string): boolean {
  const v = cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(v) || /^(\d)\1{13}$/.test(v)) return false;
  const calc = (len: number) => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(v[i]) * weights[i];
    const d = sum % 11;
    return d < 2 ? 0 : 11 - d;
  };
  return calc(12) === Number(v[12]) && calc(13) === Number(v[13]);
}

/** Aceita CPF (11) ou CNPJ (14) com digito verificador conferido. */
export function documentError(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 'Informe o CPF ou CNPJ.';
  if (digits.length === 11) return isValidCPF(digits) ? null : 'CPF inválido.';
  if (digits.length === 14) return isValidCNPJ(digits) ? null : 'CNPJ inválido.';
  return 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).';
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  problems: string[];
}

/** Mesmas regras do `strongPassword` do servidor — comprimento pesa mais. */
export function passwordStrength(value: string): PasswordStrength {
  const problems: string[] = [];
  if (value.length < 12) problems.push('Pelo menos 12 caracteres');
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value)) problems.push('Maiúsculas e minúsculas');
  if (!/\d/.test(value)) problems.push('Pelo menos um número');
  if (/^(senha|password|123456|qwerty|vanpro)/i.test(value)) {
    problems.push('Não comece com palavra previsível');
  }

  const passed = 4 - Math.min(problems.length, 4);
  let score = passed as 0 | 1 | 2 | 3 | 4;
  if (problems.length === 0 && value.length >= 16) score = 4;
  else if (problems.length === 0) score = 3;

  const labels = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte'];
  return { score, label: labels[score], problems };
}

export function emailError(value: string): string | null {
  if (!value.trim()) return 'Informe o e-mail.';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : 'E-mail inválido.';
}

/** Placa Mercosul (ABC1D23) ou antiga (ABC1234). */
export function plateError(value: string): string | null {
  const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!v) return 'Informe a placa.';
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(v) ? null : 'Placa inválida.';
}

export function maskDocument(value: string): string {
  const v = value.replace(/\D/g, '').slice(0, 14);
  if (v.length <= 11) {
    return v
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return v
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
