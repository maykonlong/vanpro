import type { Money } from './types';

/**
 * Exibicao de dinheiro.
 *
 * A API ja manda `formatted`; esta funcao existe so para o caso de um total
 * calculado no cliente. E a soma e feita em CENTAVOS — `0.1 + 0.2 !== 0.3` em
 * ponto flutuante, e conciliacao que erra um centavo perde a confianca inteira.
 */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function sumCents(values: Array<Money | number>): number {
  return values.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : v.cents), 0);
}

/** Converte "1.234,56" ou "1234.56" digitado pelo usuario em centavos. */
export function parseBrlToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[R$\s]/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** `YYYY-MM-DD` no fuso local, para preencher `<input type="date">`. */
export function toDateInput(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentMonth(): string {
  return toDateInput(new Date()).slice(0, 7);
}

export function firstDayOfMonth(): string {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function today(): string {
  return toDateInput(new Date());
}

export function formatDocument(digits: string): string {
  const v = digits.replace(/\D/g, '');
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return digits;
}

const SHIFT_LABEL: Record<string, string> = {
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  FULL: 'Integral',
};

const STUDENT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Aguardando',
  BOARDED: 'Embarcado',
  DELIVERED: 'Entregue',
  ABSENT: 'Ausente',
};

const VEHICLE_STATUS_LABEL: Record<string, string> = {
  IDLE: 'Disponível',
  ON_ROUTE: 'Em rota',
  MAINTENANCE: 'Manutenção',
};

const CHARTER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Agendado',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
};

const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  FUEL: 'Combustível',
  MAINTENANCE: 'Manutenção',
  PAYROLL: 'Folha de pagamento',
  TAXES: 'Impostos',
  OTHER: 'Outros',
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Administrador da plataforma',
  OWNER: 'Proprietário',
  MANAGER: 'Gestor',
  DRIVER: 'Motorista',
  ASSISTANT: 'Monitor',
  PARENT: 'Responsável',
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Em aberto',
  RECEIVED: 'Paga',
  OVERDUE: 'Vencida',
  CANCELED: 'Cancelada',
};

const SEVERITY_LABEL: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

/** Assinatura da empresa (`tenantStatus`): TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELED. */
const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  TRIAL: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento atrasado',
  SUSPENDED: 'Suspensa',
  CANCELED: 'Cancelada',
};

/** Vinculo de pessoa com a empresa: INVITED, ACTIVE, SUSPENDED, ARCHIVED. */
const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  INVITED: 'Convidado',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  ARCHIVED: 'Arquivado',
};

const AI_POST_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  APPROVED: 'Aprovado',
  PUBLISHED: 'Publicado',
  REJECTED: 'Recusado',
};

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  EMAIL: 'E-mail',
};

/** Pedido de eliminacao LGPD: NONE, PENDING_APPROVAL, DELETED. */
const DELETE_REQUEST_LABEL: Record<string, string> = {
  NONE: 'Sem pedido',
  PENDING_APPROVAL: 'Aguardando aprovação',
  DELETED: 'Eliminado',
};

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Efetivo',
  FREELANCE: 'Freelance',
};

const PUNCH_LABEL: Record<string, string> = {
  CLOCK_IN: 'Entrada',
  BREAK_START: 'Início da pausa',
  BREAK_END: 'Fim da pausa',
  CLOCK_OUT: 'Saída',
};

function lookup(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}

export const label = {
  shift: (v?: string | null) => lookup(SHIFT_LABEL, v),
  studentStatus: (v?: string | null) => lookup(STUDENT_STATUS_LABEL, v),
  vehicleStatus: (v?: string | null) => lookup(VEHICLE_STATUS_LABEL, v),
  charterStatus: (v?: string | null) => lookup(CHARTER_STATUS_LABEL, v),
  expenseCategory: (v?: string | null) => lookup(EXPENSE_CATEGORY_LABEL, v),
  role: (v?: string | null) => lookup(ROLE_LABEL, v),
  invoiceStatus: (v?: string | null) => lookup(INVOICE_STATUS_LABEL, v),
  severity: (v?: string | null) => lookup(SEVERITY_LABEL, v),
  punch: (v?: string | null) => lookup(PUNCH_LABEL, v),
  subscriptionStatus: (v?: string | null) => lookup(SUBSCRIPTION_STATUS_LABEL, v),
  membershipStatus: (v?: string | null) => lookup(MEMBERSHIP_STATUS_LABEL, v),
  aiPostStatus: (v?: string | null) => lookup(AI_POST_STATUS_LABEL, v),
  channel: (v?: string | null) => lookup(CHANNEL_LABEL, v),
  deleteRequest: (v?: string | null) => lookup(DELETE_REQUEST_LABEL, v),
  contractType: (v?: string | null) => lookup(CONTRACT_TYPE_LABEL, v),
};
