import { Prisma, PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';
import { env } from '../config/env';
import { getContext } from './request-context';

/**
 * Modelos cujo dado pertence a UMA empresa. Toda query neles e reescrita para
 * incluir o companyId do contexto - o isolamento nao depende de o controller
 * lembrar de filtrar, porque foi exatamente esse esquecimento que vazou o DRE
 * entre empresas na versao anterior.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Vehicle',
  'Driver',
  'Student',
  'Timecard',
  'Punch',
  'FinancialTransaction',
  'Invoice',
  'Expense',
  'Note',
  'IncidentAlert',
  'TeamMessage',
  'Charter',
  'AICampaign',
  'AIPost',
  'UserCompany',
  'AuditLog',
  'Upload',
]);

/** Operacoes cujo `where` deve receber o filtro de tenant. */
const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
/**
 * Escritas cujo `where` e um `WhereInput` comum: aceita `AND`, como as leituras.
 */
const WRITE_MANY_OPS = new Set(['updateMany', 'deleteMany']);

/**
 * Escritas cujo `where` e um `WhereUniqueInput`: o campo unico precisa estar na
 * RAIZ. Embrulhar em `AND` tira o `id` da raiz e o Prisma recusa a query
 * inteira com `PrismaClientValidationError` — que o handler global traduz em
 * 500. Na pratica isso quebrou TODA atualizacao e exclusao do sistema: o
 * produto criava e lia, mas nao alterava nada.
 */
const WRITE_UNIQUE_OPS = new Set(['update', 'delete']);

/** Todas as operacoes que recebem `WhereUniqueInput` e precisam do merge plano. */
const UNIQUE_WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  ...WRITE_UNIQUE_OPS,
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING';
  constructor(model: string, operation: string) {
    super(
      `Query em ${model}.${operation} sem tenant no contexto. ` +
        `Isso é um bug de programação: use runUnscoped() explicitamente se a intenção ` +
        `for cruzar empresas (cron/seed/super-admin).`,
    );
  }
}

/**
 * Forma frouxa dos argumentos dentro da extensao.
 *
 * O Prisma tipa `args` como a uniao de todas as operacoes do modelo, e nenhuma
 * propriedade concreta (`data`, `where`, `create`) existe nessa uniao. Manipular
 * args genericamente exige esse afrouxamento — mantido em UM lugar, nomeado, em
 * vez de virar `as any` espalhado.
 */
type LooseArgs = {
  data?: Record<string, unknown> | Record<string, unknown>[];
  where?: Record<string, unknown>;
  create?: Record<string, unknown>;
  [k: string]: unknown;
};

export class CrossTenantWriteError extends Error {
  readonly code = 'CROSS_TENANT_WRITE';
  constructor(model: string, informado: string, esperado: string) {
    super(
      `Tentativa de gravar em ${model} com companyId ${informado} enquanto o contexto é ${esperado}. ` +
        `Escrita bloqueada.`,
    );
  }
}

function mergeWhere(args: unknown, tenantId: string): LooseArgs {
  const next = { ...((args ?? {}) as LooseArgs) };
  next.where = next.where ? { AND: [next.where, { companyId: tenantId }] } : { companyId: tenantId };
  return next;
}

/**
 * Guard multi-tenant. Fail-closed: sem tenant no contexto e sem runUnscoped(),
 * a query nao roda. "Nao sei de quem e esse dado" nunca vira "entao mostra tudo".
 */
const tenantGuard = Prisma.defineExtension({
  name: 'vanpro-tenant-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_SCOPED_MODELS.has(model)) return query(args);

        const ctx = getContext();
        if (ctx?.unscoped) return query(args);

        const tenantId = ctx?.tenantId ?? null;
        if (!tenantId) throw new TenantContextMissingError(model, operation);

        // `WhereUniqueInput` exige o campo unico no NIVEL RAIZ. O merge aqui e
        // plano, apoiado no extendedWhereUnique (GA no Prisma 5+): filtro
        // adicional e permitido ao lado do unico, e um id de outra empresa
        // simplesmente nao casa — vira P2025 (404), nao vazamento.
        if (UNIQUE_WHERE_OPS.has(operation)) {
          const next = { ...((args ?? {}) as LooseArgs) };
          next.where = { ...(next.where ?? {}), companyId: tenantId };
          return query(next);
        }

        if (READ_OPS.has(operation) || WRITE_MANY_OPS.has(operation)) {
          return query(mergeWhere(args, tenantId));
        }

        if (CREATE_OPS.has(operation)) {
          // Na escrita o guard VALIDA em vez de so injetar.
          //
          // Injetar em silencio faria `companyId` informado pelo controller ser
          // sobrescrito sem aviso — e um controller que passa a empresa errada
          // (por bug ou por dado vindo do cliente) continuaria parecendo certo.
          // Aqui, divergencia e erro alto; ausencia e preenchida.
          const assign = (d: Record<string, unknown>) => {
            const informado = d.companyId;
            if (informado !== undefined && informado !== tenantId) {
              throw new CrossTenantWriteError(model, String(informado), tenantId);
            }
            return { ...d, companyId: tenantId };
          };

          // A extensao recebe a uniao de TODOS os args possiveis do modelo, entao
          // `data` nao existe no tipo estatico. Este e o unico ponto do projeto
          // que manipula args de forma generica; por isso o afrouxamento fica
          // aqui, atras de um tipo local nomeado, e nao espalhado nos modulos.
          const next = { ...(args ?? {}) } as LooseArgs;
          next.data = Array.isArray(next.data)
            ? next.data.map(assign)
            : assign((next.data as Record<string, unknown>) ?? {});
          return query(next);
        }

        if (operation === 'upsert') {
          const next = mergeWhere(args, tenantId);
          next.create = { ...(next.create ?? {}), companyId: tenantId };
          return query(next);
        }

        return query(args);
      },
    },
  },
});

/**
 * Soft delete: `deletedAt` nao nulo some das leituras por padrao.
 * Quem precisa do historico (auditoria trabalhista, LGPD) usa `includeDeleted`.
 */
const SOFT_DELETE_MODELS = new Set(['Vehicle', 'Student']);

const softDelete = Prisma.defineExtension({
  name: 'vanpro-soft-delete',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        if (!READ_OPS.has(operation) && operation !== 'findUnique') return query(args);

        const a = { ...((args ?? {}) as LooseArgs) };
        if (a.where?.includeDeleted) {
          delete a.where.includeDeleted;
          return query(a);
        }
        // findUnique de novo precisa do merge plano (ver comentario no guard).
        a.where =
          operation === 'findUnique'
            ? { ...(a.where ?? {}), deletedAt: null }
            : a.where
              ? { AND: [a.where, { deletedAt: null }] }
              : { deletedAt: null };
        return query(a);
      },
    },
  },
});

function build() {
  const base = new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

  return base
    .$extends(
      fieldEncryptionExtension({
        encryptionKey: env.PRISMA_FIELD_ENCRYPTION_KEY,
        // Chaves aposentadas continuam decifrando o que foi gravado com elas.
        // O prefixo de cada valor no banco carrega a impressao digital da chave
        // que o cifrou, entao a escolha e por registro — nao ha tentativa e erro.
        decryptionKeys: env.PRISMA_FIELD_DECRYPTION_KEYS?.split(',').map((k) => k.trim()),
      }),
    )
    .$extends(softDelete)
    .$extends(tenantGuard);
}

declare global {
  // eslint-disable-next-line no-var
  var __vanproPrisma: ReturnType<typeof build> | undefined;
}

export const prisma = globalThis.__vanproPrisma ?? build();
if (env.NODE_ENV !== 'production') globalThis.__vanproPrisma = prisma;

export type AppPrisma = typeof prisma;
