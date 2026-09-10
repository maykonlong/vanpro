import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Empresa (tenant) dona da requisicao. Nulo apenas para SUPER_ADMIN e boot. */
  tenantId: string | null;
  userId: string | null;
  role: string | null;
  requestId: string;
  /**
   * Liberacao explicita do filtro multi-tenant.
   * So e ligada em codigo de plataforma (seed, cron, painel do SUPER_ADMIN)
   * e sempre por `runUnscoped()`, nunca por dado vindo da request.
   */
  unscoped: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Executa `fn` dentro do contexto e AMARRA o resultado a ele.
 *
 * A amarração existe por causa de uma armadilha real: `PrismaPromise` e
 * preguicoso — `prisma.x.findMany()` nao dispara consulta nenhuma ate alguem
 * chamar `.then`. Num `runUnscoped('x', () => prisma.x.create(...))`, esse
 * `.then` acontece DEPOIS, ja fora da janela do AsyncLocalStorage, e o guard
 * multi-tenant via contexto vazio e recusava a query.
 *
 * Chamar `.then` aqui dentro, de forma sincrona, faz a consulta comecar dentro
 * do contexto — e a propagacao normal do ALS cuida do resto.
 */
function ehThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

function amarrar<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, () => {
    const resultado: unknown = fn();
    if (ehThenable(resultado)) {
      return new Promise((resolve, reject) => resultado.then(resolve, reject)) as T;
    }
    return resultado as T;
  });
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return amarrar(ctx, fn);
}

/**
 * Escapa do filtro de tenant para um bloco especifico.
 * Uso legitimo: cron de plataforma, seed, relatorio do SUPER_ADMIN.
 * Toda chamada aqui deve ser obvia na revisao de codigo - por isso e uma
 * funcao explicita e nao uma flag booleana passada adiante.
 */
export function runUnscoped<T>(reason: string, fn: () => T): T {
  const current = storage.getStore();
  const ctx: RequestContext = {
    tenantId: current?.tenantId ?? null,
    userId: current?.userId ?? null,
    role: current?.role ?? null,
    requestId: current?.requestId ?? `unscoped:${reason}`,
    unscoped: true,
  };
  return amarrar(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}
