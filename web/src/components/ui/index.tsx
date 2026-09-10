import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

import type { Money } from '../../lib/types';

/* ==========================================================================
   Sistema de componentes do VanPro.

   Regras que valem para tudo aqui:
   - Alvo de toque nunca abaixo de 44×44. O motorista usa isto de pé, com a van
     ligada, com uma mão só.
   - Nada de cor sozinha carregando significado: sempre há texto ou ícone junto.
   - Todo estado de foco é visível, todo botão só-ícone tem `aria-label`.
   - `brand` (âmbar) é identidade e ação principal — nunca informa estado.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Botão
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'lg';

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-on-brand font-semibold shadow-raised hover:bg-brand-400 active:bg-brand-600 active:text-white',
  secondary:
    'bg-ink-900 text-ink-50 border border-ink-700 font-medium hover:bg-ink-800 active:bg-ink-700',
  // Vermelho preenchido é EXCLUSIVO de ação irreversível. Prejuízo em dinheiro
  // usa `loss` (tijolo) e nunca aparece dentro de um botão.
  danger: 'bg-danger-strong text-on-danger font-semibold hover:brightness-110 active:brightness-95',
  ghost: 'bg-transparent text-ink-200 border border-transparent hover:bg-ink-800',
};

const SIZE_CLASS: Record<Size, string> = {
  md: 'min-h-[44px] px-4 py-2.5 text-sm rounded-xl',
  // `lg` existe para a tela do motorista: alvo grande, texto grande, uma mão só.
  lg: 'min-h-[56px] px-5 py-3 text-base rounded-2xl',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Ocupa a largura toda — o padrão no celular. */
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  block,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 transition-[background-color,filter,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none ${
        SIZE_CLASS[size]
      } ${VARIANT_CLASS[variant]} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading ? (
        <>
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          <span>Aguarde…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Botão só-ícone. O `label` é obrigatório: vira `aria-label` e `title`. */
export function IconButton({
  label,
  children,
  className = '',
  type = 'button',
  ...rest
}: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Campos de formulário
// ---------------------------------------------------------------------------

interface FieldWrapperProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/**
 * Toda etiqueta é associada ao controle pelo `id`, e o erro é anunciado por
 * `aria-describedby` + `role="alert"`. Sem isso o leitor de tela lê o campo
 * mas não lê o motivo pelo qual ele está vermelho.
 */
export function Field({ label, error, hint, required, children }: FieldWrapperProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-200">
        {label}
        {required ? (
          <span className="text-brand-600" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (obrigatório)</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-xs text-ink-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-bad-400">
          <AlertTriangle aria-hidden="true" size={14} className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'min-h-[44px] w-full rounded-xl border bg-ink-900 px-3 py-2.5 text-sm text-ink-50 transition-colors placeholder:text-ink-600 hover:border-ink-600 disabled:cursor-not-allowed disabled:opacity-60';

function controlClass(invalid: boolean): string {
  return `${CONTROL_CLASS} ${invalid ? 'border-bad-500 bg-danger-soft' : 'border-ink-700'}`;
}

export function TextInput({
  label,
  error,
  hint,
  required,
  className = '',
  ...rest
}: { label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${controlClass(invalid)} ${className}`}
        />
      )}
    </Field>
  );
}

export function SelectInput({
  label,
  error,
  hint,
  required,
  children,
  className = '',
  ...rest
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          {...rest}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${controlClass(invalid)} ${className}`}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export function TextArea({
  label,
  error,
  hint,
  required,
  className = '',
  ...rest
}: { label: string; error?: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          {...rest}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${controlClass(invalid)} min-h-[104px] ${className}`}
        />
      )}
    </Field>
  );
}

/**
 * Filtro em botões, não em `<select>`.
 *
 * No celular um `<select>` abre a roleta nativa e custa três toques; aqui é um
 * toque só, com o estado atual visível sem abrir nada. Implementado como
 * `radiogroup` para que o teclado e o leitor de tela entendam a escolha única.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; text: string; count?: number }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex flex-wrap gap-1.5 rounded-2xl bg-ink-800 p-1.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`min-h-[40px] flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-ink-900 font-semibold text-ink-50 shadow-raised'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {option.text}
            {typeof option.count === 'number' ? (
              <span className="tnum ml-1.5 text-xs text-ink-400">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contêineres
// ---------------------------------------------------------------------------

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag
      className={`rounded-card border border-ink-700 bg-ink-900 p-4 shadow-raised sm:p-5 ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Título de seção dentro de um cartão, com hierarquia coerente. */
export function SectionTitle({
  children,
  icon,
  hint,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
          {icon ? (
            <span aria-hidden="true" className="text-brand-600">
              {icon}
            </span>
          ) : null}
          {children}
        </h2>
        {hint ? <p className="mt-1 text-sm text-ink-400">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink-50 sm:text-[1.75rem]">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// A resposta: um número grande e sozinho
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'gain' | 'loss' | 'brand';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-50',
  good: 'text-good-400',
  bad: 'text-bad-400',
  warn: 'text-warn-400',
  gain: 'text-gain',
  loss: 'text-loss',
  brand: 'text-brand-600',
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-ink-800 text-ink-200 border-ink-700',
  good: 'bg-good-soft text-good-400 border-good-400/40',
  bad: 'bg-danger-soft text-bad-400 border-bad-500/40',
  warn: 'bg-warn-soft text-warn-400 border-warn-400/40',
  gain: 'bg-gain-soft text-gain border-gain/40',
  loss: 'bg-loss-soft text-loss border-loss/40',
  brand: 'bg-brand-soft text-brand-600 border-brand-500/40',
};

/**
 * O bloco que responde à pergunta do usuário.
 *
 * Um número grande sozinho comunica mais que seis cartões iguais: a pergunta
 * vem em cima em texto pequeno, a resposta vem embaixo em corpo grande, e a
 * explicação vem depois. É o oposto de uma tabela crua.
 */
export function Answer({
  question,
  value,
  tone = 'neutral',
  detail,
  footer,
  className = '',
}: {
  question: string;
  value: ReactNode;
  tone?: Tone;
  detail?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <p className="text-sm font-medium text-ink-400">{question}</p>
      <p
        className={`tnum mt-1.5 text-[2rem] font-semibold leading-tight sm:text-[2.5rem] ${TONE_TEXT[tone]}`}
      >
        {value}
      </p>
      {detail ? <p className="mt-1.5 text-sm text-ink-400">{detail}</p> : null}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </Card>
  );
}

/** Número de apoio: menor que a resposta, mas ainda legível de longe. */
export function Stat({
  label: text,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{text}</p>
      <p className={`tnum mt-1 text-xl font-semibold ${TONE_TEXT[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Dinheiro na tela.
 *
 * Exibe SEMPRE o `formatted` que veio da API; a decisão de cor usa `cents`,
 * que é inteiro. Nenhuma aritmética de reais em ponto flutuante passa por aqui.
 */
export function MoneyText({
  value,
  signed,
  className = '',
}: {
  value: Money;
  /** Colore por sinal: entrada em verde, falta em tijolo. */
  signed?: boolean;
  className?: string;
}) {
  const tone: Tone = !signed ? 'neutral' : value.cents < 0 ? 'loss' : 'gain';
  return <span className={`tnum ${TONE_TEXT[tone]} ${className}`}>{value.formatted}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Estados: carregando, vazio, erro, sucesso
// ---------------------------------------------------------------------------

/** Esqueleto, não spinner: preserva o layout e não pisca a tela inteira. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-ink-800 ${className}`} aria-hidden="true" />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[76px] w-full" />
      ))}
      <span className="sr-only">Carregando conteúdo…</span>
    </div>
  );
}

/** Esqueleto do bloco de resposta, para o painel não pular quando o dado chega. */
export function SkeletonAnswer() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card border border-ink-700 bg-ink-900 p-4 sm:p-5"
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-10 w-56" />
      <Skeleton className="mt-3 h-4 w-64" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

/**
 * Tela vazia nunca fica só "sem registros": diz o que aconteceu e qual é o
 * próximo passo. Vazio sem orientação é um beco sem saída.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-ink-700 bg-ink-900 px-6 py-12 text-center">
      {icon ? (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand-600"
        >
          {icon}
        </div>
      ) : null}
      <h2 className="text-base font-semibold text-ink-50">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-ink-400">{description}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-bad-500/45 bg-danger-soft p-4"
    >
      <p className="flex items-start gap-2 text-sm font-medium text-bad-400">
        <AlertTriangle aria-hidden="true" size={18} className="mt-px shrink-0" />
        {message}
      </p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-bad-500/45 bg-danger-soft px-3 py-2.5 text-sm font-medium text-bad-400"
    >
      <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

export function SuccessNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl border border-good-400/45 bg-good-soft px-3 py-2.5 text-sm font-medium text-good-400"
    >
      <CheckCircle2 aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

/** Aviso de contexto — nem erro nem sucesso: "leia isto antes de agir". */
export function Callout({
  tone = 'warn',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-card border px-4 py-3 text-sm ${TONE_CHIP[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo com foco preso dentro dele e devolvido ao sair.
 *
 * Sem a prisão de foco, `Tab` sai do diálogo e vai passeando pela página de
 * trás — que continua visível mas inerte. Quem enxerga não percebe; quem
 * navega por teclado ou leitor de tela fica perdido sem saber onde está.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // O primeiro campo é o destino natural; sem nada focável, o próprio diálogo.
    const target = ref.current?.querySelector<HTMLElement>(FOCUSABLE) ?? ref.current;
    target?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-ink-700 bg-ink-900 p-5 shadow-float sm:max-w-lg sm:rounded-card"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-ink-50">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-ink-400">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Fechar" onClick={onClose} className="-mr-1 -mt-1 shrink-0">
            <X aria-hidden="true" size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Toda ação destrutiva passa por aqui — nunca por um `confirm()` do navegador.
 *
 * A `message` deve NOMEAR o que será afetado ("Excluir o aluno Marina Alves?"),
 * porque quem confirma precisa reconhecer o item, não só o verbo.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm leading-relaxed text-ink-200">{message}</p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Paginação
// ---------------------------------------------------------------------------

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav
      aria-label="Paginação"
      className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-ink-700 bg-ink-900 p-2"
    >
      <Button variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Anterior
      </Button>
      <p className="tnum text-center text-xs text-ink-400" aria-live="polite">
        Página {page} de {Math.max(totalPages, 1)}
        <span className="hidden sm:inline"> · {total} registro(s)</span>
      </p>
      <Button variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Próxima
      </Button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

/**
 * Abas com semântica de `tablist`: setas do teclado navegam, `aria-selected`
 * diz qual está ativa, e o painel é ligado à aba por `aria-labelledby`.
 */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: T;
  tabs: ReadonlyArray<{ value: T; text: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.value === value);
    if (index < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? index + 1 : index - 1;
      onChange(tabs[(next + tabs.length) % tabs.length].value);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-ink-700 px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`aba-${tab.value}`}
            aria-selected={active}
            aria-controls={`painel-${tab.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
              active
                ? 'border-brand-500 font-semibold text-ink-50'
                : 'border-transparent text-ink-400 hover:text-ink-200'
            }`}
          >
            {tab.icon ? <span aria-hidden="true">{tab.icon}</span> : null}
            {tab.text}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`painel-${value}`} aria-labelledby={`aba-${value}`} tabIndex={-1}>
      {children}
    </div>
  );
}
