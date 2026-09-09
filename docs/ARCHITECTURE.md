# Arquitetura VanPro — contrato interno

Este documento é a fonte da verdade para qualquer código novo na API.
Se algo aqui conflitar com um arquivo existente, **este documento vence** e o
arquivo está errado.

## Princípio único

> Ausência de sinal nunca vira aprovação.

Sem tenant no contexto, a query não roda. Sem credencial de integração, a
feature responde `503 FEATURE_DISABLED` — **nunca** simula sucesso. Sem
validação, o dado não chega ao Prisma. Sem role declarada, a rota não existe.

## Camadas

```
request
  └─ requestContext        abre AsyncLocalStorage (tenantId, userId, requestId)
     └─ helmet / cors / Permissions-Policy
        └─ express.json (256kb)  ·  webhooks recebem raw body antes disso
           └─ sentinela          escudo de borda (estrutura + assinaturas)
              └─ csrfProtection  double-submit assinado
                 └─ rate limit   Redis, fail-open
                    └─ authenticate      valida JWT + sessão viva no banco
                       └─ requireRole / requirePermission
                          └─ validate({ body, query, params })  zod
                             └─ handler        usa req.valid, nunca req.body
                                └─ prisma      tenant-guard injeta companyId
```

## Regras que não se negociam

| # | Regra | Por quê |
|---|---|---|
| 1 | Toda rota declara `requireRole(...)`, inclusive `GET` | rota sem guard foi como o CRUD de alunos ficou público |
| 2 | Handler lê `req.valid.body`, nunca `req.body` | impede mass-assignment (`{"role":"OWNER"}` num PATCH de perfil) |
| 3 | Nunca escrever `companyId` em `where` à mão | o guard do Prisma injeta; escrever à mão esconde o esquecimento |
| 4 | Listagem sempre paginada (`pagination` + `skipTake` + `paginate`) | listagem sem teto é DoS que o próprio cliente causa |
| 5 | Dinheiro é `Int` em **centavos**; entrada usa `brlInput`, saída usa `money()` | `0.1 + 0.2 !== 0.3` quebra conciliação |
| 6 | Toda escrita relevante chama `audit({...})` | trilha encadeada por hash; obrigação fiscal e trabalhista |
| 7 | Resposta usa serializador explícito, nunca a entidade crua | coluna nova não vira vazamento silencioso |
| 8 | Integração sem credencial → `Errors.featureDisabled('nome')` | jamais gravar `companyId: 'mock-company'` de novo |
| 9 | Sem `console.log` — só `logger` (que redige PII) | log de app vaza mais dado pessoal que endpoint ruim |
| 10 | Exclusão é lógica (`deletedAt`) em Student e Vehicle | histórico fiscal e defesa trabalhista |
| 11 | Erro vai pelo `next(err)` / `throw` — o handler global responde | mensagem estável, stack só no log |
| 12 | Nada de `as any` / `@ts-ignore` | — |

## Arquivos de fundação (já existem, **não reescrever**)

| Arquivo | Papel |
|---|---|
| `src/config/env.ts` | env validado por zod, fail-closed. `env`, `features`, `isProduction` |
| `src/lib/request-context.ts` | `runWithContext`, `runUnscoped(motivo, fn)`, `getContext` |
| `src/lib/prisma.ts` | client com tenant-guard + soft-delete + criptografia de campo |
| `src/lib/logger.ts` | pino com redação de PII; `pseudonymize()` |
| `src/lib/errors.ts` | `AppError` + fábrica `Errors.*` |
| `src/lib/money.ts` | `toCents`, `fromCents`, `formatBRL`, `brlInput`, `money()` |
| `src/lib/audit.ts` | `audit({action, description})`, `verifyChain()` |
| `src/lib/redis.ts` | conexão compartilhada, `redisHealthy()` |
| `src/security/sentinela.ts` | escudo de borda |
| `src/security/csrf.ts` | `issueCsrfToken`, `csrfProtection` |
| `src/security/rate-limit.ts` | `authLimiter`, `publicWriteLimiter`, `uploadLimiter`, ... |
| `src/http/validate.ts` | `validate`, `pagination`, `paginate`, `skipTake`, `uuidParam`, `strongPassword`, `emailField`, `documentField`, `plateField`, `text()` |
| `src/http/middlewares/authenticate.ts` | `authenticate`, `requireRole`, `requirePermission`, `requireSuperAdmin` |
| `src/http/error-handler.ts` | `errorHandler`, `notFoundHandler` |
| `src/modules/auth/session.service.ts` | `issueSession`, `refreshSession`, `revokeFamily`, `clearSessionCookies` |
| `src/modules/tenancy/plan-limits.ts` | `assertPlanLimit`, `planUsage` |

## Módulo de referência

`src/modules/students/students.controller.ts` — copie a estrutura dele.
Cada módulo exporta um `Router` como `default` de
`src/modules/<nome>/<nome>.controller.ts`.

## Papéis

| Papel | Alcance |
|---|---|
| `SUPER_ADMIN` | plataforma; único que atravessa empresas, e só via `requireSuperAdmin` |
| `OWNER` | dono da frota; tudo dentro da própria empresa |
| `MANAGER` | delegado; poderes vêm das flags `canManageFinance/HR/Routes` |
| `DRIVER` | operação da própria rota; vê os próprios ganhos, nunca o faturamento |
| `ASSISTANT` | monitor: check-in de aluno, leitura de rota |
| `PARENT` | só os próprios filhos, e só leitura + LGPD |

## Testes

Vitest + supertest contra **PostgreSQL real** (`vanpro_test`).
Sem mock de banco: fixture testa a unidade, só o banco de verdade testa o sistema.
Todo módulo entrega, no mínimo: caminho feliz, borda, negação por papel e
**tentativa de acesso cruzado entre empresas** (o teste que a versão anterior
não tinha e que teria pego o vazamento do DRE).
