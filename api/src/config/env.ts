import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Contrato de ambiente. Fail-closed por design.
 *
 * Regra do projeto: ausencia de sinal NUNCA vira valor bom. Nao existe fallback
 * para segredo. Se a variavel critica nao veio, o processo nao sobe - e prefere-se
 * um boot que falha alto a um boot que sobe com `super_secret_jwt_vanpro_key_123`.
 */

// NODE_ENV controla o BUILD (otimizacao). APP_ENV controla o RIGOR.
// Separar os dois evita a escolha ruim entre "roda o artefato de producao
// localmente" e "as travas de producao valem de verdade".
const appEnv = (process.env.APP_ENV ?? 'local') as 'local' | 'staging' | 'production';
const isProd = appEnv === 'production';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Variavel opcional: string vazia conta como AUSENTE.
 *
 * Orquestrador preenche o que nao foi definido com `""` (o `${VAR:-}` do
 * docker compose, o `env` vazio do Kubernetes). Sem esta normalizacao, uma
 * integracao que o operador nem configurou entra na validacao como
 * "preenchida, porem invalida" e derruba o boot — foi exatamente o que
 * aconteceu ao subir a stack pela primeira vez.
 */
const opcional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

/** Segredo forte: >= 32 bytes de entropia representados em texto. */
const strongSecret = (name: string) =>
  z
    .string({ required_error: `${name} é obrigatória` })
    .min(32, `${name} precisa de no mínimo 32 caracteres`)
    .refine((v) => !/^(changeme|secret|password|super_secret)/i.test(v), {
      message: `${name} tem valor de exemplo/placeholder - gere um segredo real`,
    });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // --- Banco ---
    DATABASE_URL: z
      .string()
      .url()
      .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
        message: 'DATABASE_URL precisa ser PostgreSQL. SQLite não é suportado.',
      }),

    // --- Redis (rate limit distribuido + pub/sub de websocket) ---
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    // --- Sessao ---
    JWT_ACCESS_SECRET: strongSecret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: strongSecret('JWT_REFRESH_SECRET'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

    // --- Criptografia em repouso (prisma-field-encryption) ---
    PRISMA_FIELD_ENCRYPTION_KEY: z
      .string({ required_error: 'PRISMA_FIELD_ENCRYPTION_KEY é obrigatória' })
      .regex(
        /^k1\.aesgcm256\.[A-Za-z0-9_-]{43}=?$/,
        'PRISMA_FIELD_ENCRYPTION_KEY inválida. Gere com: npx prisma-field-encryption generate-key',
      ),

    // --- Front / CORS ---
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    /**
     * Origens extras aceitas pelo CORS, separadas por virgula.
     *
     * Existe porque atras de um proxy reverso o navegador manda a origem do
     * PROXY, nao a do container: subir a stack em `127.0.0.1:8080` com
     * FRONTEND_URL apontando para `localhost:8080` derrubava todo o login, e o
     * sintoma (500 no refresh) nao dizia nada sobre origem.
     */
    CORS_EXTRA_ORIGINS: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
    COOKIE_DOMAIN: opcional(z.string().min(1)),

    // --- WebAuthn ---
    WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
    WEBAUTHN_RP_NAME: z.string().min(1).default('VanPro'),
    WEBAUTHN_ORIGIN: z.string().url().default('http://localhost:5173'),

    // --- Integracoes (opcionais; ausencia DESLIGA a feature, nunca a simula) ---
    ASAAS_API_KEY: opcional(z.string().min(10)),
    ASAAS_API_URL: z.string().url().default('https://sandbox.asaas.com/api/v3'),
    ASAAS_WEBHOOK_TOKEN: opcional(z.string().min(16)),

    WHATSAPP_TOKEN: opcional(z.string().min(10)),
    WHATSAPP_PHONE_ID: opcional(z.string().min(1)),

    GOOGLE_MAPS_KEY: opcional(z.string().min(10)),

    SENTRY_DSN: opcional(z.string().url()),

    // --- Uploads ---
    UPLOAD_DIR: z.string().default('./storage/uploads'),
    UPLOAD_MAX_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),

    // --- Observabilidade ---
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // --- Jobs ---
    ENABLE_CRON: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;

    // Em producao, exigencias extras que em dev seriam atrito inutil.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET precisa ser diferente de JWT_ACCESS_SECRET',
      });
    }
    if (!env.FRONTEND_URL.startsWith('https://') && !LOCAL_ORIGIN.test(env.FRONTEND_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FRONTEND_URL'],
        message: 'Em produção FRONTEND_URL precisa ser https',
      });
    }
    if (env.WEBAUTHN_RP_ID === 'localhost') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBAUTHN_RP_ID'],
        message: 'WEBAUTHN_RP_ID não pode ser localhost em produção',
      });
    }
    if (!env.ASAAS_WEBHOOK_TOKEN && env.ASAAS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ASAAS_WEBHOOK_TOKEN'],
        message: 'Asaas ligado exige ASAAS_WEBHOOK_TOKEN para validar webhook',
      });
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`);
    // stderr direto: o logger depende do env que acabou de falhar.
    process.stderr.write(
      `\n[BOOT ABORTADO] Ambiente inválido (${lines.length} problema(s)):\n${lines.join('\n')}\n\n` +
        `Copie .env.example para .env e preencha. Nenhum segredo tem valor padrão.\n\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();

/** Flags derivadas: feature ligada == credencial presente. Sem meio-termo simulado. */
export const features = {
  billing: Boolean(env.ASAAS_API_KEY),
  whatsapp: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID),
  maps: Boolean(env.GOOGLE_MAPS_KEY),
  sentry: Boolean(env.SENTRY_DSN),
} as const;

export const isProduction = isProd;

/**
 * Origens que o navegador pode usar. Em `local`, qualquer porta de localhost /
 * 127.0.0.1 entra: exigir a porta exata em desenvolvimento so gera o erro de
 * CORS que ninguem relaciona com a causa. Fora de `local`, a lista e fechada.
 */
export function origemPermitida(origin: string): boolean {
  if (origin === env.FRONTEND_URL) return true;
  if (env.CORS_EXTRA_ORIGINS.includes(origin)) return true;
  if (env.APP_ENV === 'local' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}
