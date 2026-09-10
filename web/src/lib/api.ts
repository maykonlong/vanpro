/**
 * Cliente unico de API.
 *
 * Nenhum `fetch` solto existe no resto do app: sessao (cookie httpOnly), CSRF,
 * renovacao de token e normalizacao do envelope de erro moram todos aqui. Um
 * `fetch` avulso em qualquer tela seria uma chamada sem CSRF e sem refresh — e
 * o bug so apareceria 15 minutos depois do login, quando o access expira.
 */

export const API_BASE = '/api/v1';

export interface ApiErrorDetail {
  campo: string;
  erro: string;
}

/** Envelope estavel da API: `{ error: { code, message, details?, requestId } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorDetail[],
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Erros de validacao mapeados por campo, para destacar o input certo. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) {
      // A API prefixa com a secao (`body.email`); a tela conhece so `email`.
      const campo = d.campo.replace(/^(body|query|params)\./, '');
      if (!out[campo]) out[campo] = d.erro;
    }
    return out;
  }
}

export type ApiEvent = 'unauthenticated' | 'suspended';

const listeners = new Set<(event: ApiEvent) => void>();

/** Avisos globais de sessao. O AuthProvider escuta e redireciona. */
export function onApiEvent(fn: (event: ApiEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(event: ApiEvent): void {
  for (const fn of listeners) fn(event);
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

/**
 * Guardado em memoria de proposito. `localStorage`/`sessionStorage` sobrevivem
 * a aba e sao legiveis por qualquer script injetado — o mesmo motivo pelo qual
 * o token de sessao vive em cookie httpOnly e nunca chega ao JavaScript.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** O cookie `csrf_token` e legivel de proposito (double-submit assinado). */
function readCsrfCookie(): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='));
  return match ? decodeURIComponent(match.slice('csrf_token='.length)) : null;
}

export function getCsrfToken(): string | null {
  return csrfToken ?? readCsrfCookie();
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Corpo ja pronto (upload): nao serializa nem define Content-Type. */
  formData?: FormData;
  /** Resposta binaria (exportacao LGPD). */
  raw?: boolean;
}

const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const envelope = (payload as { error?: Record<string, unknown> } | null)?.error;
  if (envelope && typeof envelope.message === 'string') {
    return new ApiError(
      response.status,
      typeof envelope.code === 'string' ? envelope.code : 'UNKNOWN',
      envelope.message,
      Array.isArray(envelope.details) ? (envelope.details as ApiErrorDetail[]) : undefined,
      typeof envelope.requestId === 'string' ? envelope.requestId : undefined,
    );
  }
  // Resposta sem envelope (proxy fora do ar, 502 do nginx): mensagem honesta em
  // vez de "undefined". Fingir que o servidor respondeu algo seria pior.
  return new ApiError(
    response.status,
    'NETWORK_ERROR',
    `Não foi possível falar com o servidor (HTTP ${response.status}). Tente novamente.`,
  );
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (MUTATIONS.has(method)) {
    const token = getCsrfToken();
    if (token) headers['x-csrf-token'] = token;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  return fetch(buildUrl(path, options.query), {
    method,
    headers,
    body,
    // Cookie httpOnly e o unico portador da sessao — sem isto, nada autentica.
    credentials: 'include',
    signal: options.signal,
  });
}

/**
 * Renovacao concorrente compartilhada: cinco widgets carregando ao mesmo tempo
 * disparariam cinco refresh, e o segundo derrubaria a familia de sessao
 * rotacionada pelo primeiro (deteccao de replay) — logout no meio do uso.
 */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const response = await send('/auth/refresh', { method: 'POST' });
        if (!response.ok) return false;
        const data = (await response.json()) as { csrfToken?: string };
        if (data.csrfToken) setCsrfToken(data.csrfToken);
        return true;
      } catch {
        return false;
      } finally {
        // Libera na proxima volta do event loop para que chamadas em fila
        // reaproveitem este resultado em vez de abrirem outro refresh.
        setTimeout(() => {
          refreshing = null;
        }, 0);
      }
    })();
  }
  return refreshing;
}

// `/auth/select-company` entra aqui porque nesse ponto ainda NAO existe cookie
// de sessao: renovar seria pedir refresh de uma sessao que nunca nasceu.
const NO_RETRY = [
  '/auth/refresh',
  '/auth/login',
  '/auth/2fa/login',
  '/auth/select-company',
  '/auth/logout',
];

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, options);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Verifique a internet.');
  }

  // Uma unica renovacao por chamada: se o refresh tambem falhar, a sessao
  // acabou de verdade e insistir so adia a tela de login.
  if (response.status === 401 && !NO_RETRY.some((p) => path.startsWith(p))) {
    const renewed = await refreshSession();
    if (renewed) response = await send(path, options);
  }

  if (!response.ok) {
    const error = await parseError(response);
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) {
      setCsrfToken(null);
      notify('unauthenticated');
    }
    if (error.code === 'ACCOUNT_SUSPENDED') notify('suspended');
    throw error;
  }

  if (options.raw) return (await response.blob()) as unknown as T;
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T,>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T,>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: 'POST', body, query }),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T,>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
  blob: (path: string, query?: Query) => request<Blob>(path, { method: 'GET', query, raw: true }),
};

/** Mensagem pronta para a tela, ja em portugues, venha o erro de onde vier. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Algo deu errado. Tente novamente.';
}
