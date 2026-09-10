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
| `SUPER_ADMIN` | plataforma; **não atravessa empresas** — ver a nota abaixo |
| `OWNER` | dono da frota; tudo dentro da própria empresa |
| `MANAGER` | delegado; poderes vêm das flags `canManageFinance/HR/Routes` |
| `DRIVER` | operação da própria rota; vê os próprios ganhos, nunca o faturamento |
| `ASSISTANT` | monitor: check-in de aluno, leitura de rota |
| `PARENT` | só os próprios filhos, e só leitura + LGPD |

**Sobre o `SUPER_ADMIN`, com precisão.** Uma versão anterior desta tabela dizia
que ele "atravessa empresas, e só via `requireSuperAdmin`". As duas metades
estavam erradas, e a segunda escondia a primeira:

- `requireRole` **deixa** o `SUPER_ADMIN` passar por qualquer checagem de papel
  (`authenticate.ts`). Isso é passagem para o handler, não acesso a dado.
- O que protege o dado é o guard de tenant do Prisma, e ele **falha fechado**:
  a sessão de plataforma nasce sem empresa ativa, então toda consulta escopada
  por empresa é recusada na camada de dados. Exercitado em
  `tests/integration/security.test.ts` — e o que se verifica lá é justamente que
  a recusa não vaza nada sobre o motivo.
- O `SUPER_ADMIN` **com vínculo** numa frota (suporte operando dentro de um
  cliente) age como membro daquela frota, com a empresa ativa na sessão. É o
  mesmo caminho de qualquer outra pessoa.
- O console da plataforma (`/platform`) é a única superfície que atravessa
  empresas de propósito. Ele exige `requireSuperAdmin` **e** uma sessão com
  segundo fator, audita a leitura e audita a escrita na trilha da empresa
  afetada.

A diferença entre "não pode passar" e "passa e não encontra nada" importa: a
primeira é uma promessa de código que alguém pode remover numa refatoração; a
segunda é uma propriedade da camada de dados, que continua valendo mesmo quando
o guard de papel é esquecido.

## Testes

Vitest + supertest contra **PostgreSQL real** (`vanpro_test`).
Sem mock de banco: fixture testa a unidade, só o banco de verdade testa o sistema.
Todo módulo entrega, no mínimo: caminho feliz, borda, negação por papel e
**tentativa de acesso cruzado entre empresas** (o teste que a versão anterior
não tinha e que teria pego o vazamento do DRE).

---

## Topologia de produção (e a stack local é a mesma)

Não existe "modo local" com travas afrouxadas. O `docker-compose.yml` sobe com
`APP_ENV=production`, e `api/src/config/env.ts` recusa o boot se qualquer uma
das exigências abaixo faltar. O que se prova aqui é o que vale no servidor.

```
navegador
  │  TLS 1.2/1.3 · HSTS 2 anos · certificado da CA local (ou pública, no servidor)
  ▼
nginx (não-root, 8080 → 301, aplicação em 8443)
  │  CSP/XFO/Referrer/Permissions-Policy num único vanpro-seguranca.conf
  │  X-Forwarded-Proto: https  ← fixo, não $scheme: é o que decide Secure no cookie
  ▼
api (não-root, filesystem read-only, cap_drop ALL)
  │  TLS verificado: sslmode=require + sslaccept=strict + sslcert=<CA>
  │  papel vanpro_app — SELECT/INSERT/UPDATE/DELETE, e nada mais
  ▼
postgres (ssl=on · pg_hba recusa hostnossl · scram-sha-256)
       ▲
       │  papel vanpro_owner — dono do schema, só o serviço `migrate` o usa
   migrate (execução única, termina antes de a API subir)
```

### Três papéis no banco, e o motivo de cada um

| Papel | Alcance | Por quê |
|---|---|---|
| `postgres` | só socket unix, dentro do contêiner | superusuário existe, mas o `pg_hba` o recusa pela rede |
| `vanpro_owner` | DDL, `CREATEDB` | migrations e o banco descartável do `backup.sh --verificar` |
| `vanpro_app` | DML no schema `public` | é o que a API usa. Uma injeção de SQL bem-sucedida **lê** dado; não apaga o schema |

O privilégio do `vanpro_app` vem de `ALTER DEFAULT PRIVILEGES` — tabela criada
por migration já nasce com o `GRANT` certo. A alternativa (rodar `GRANT` depois
de cada migration) é um passo que se esquece exatamente uma vez, e o sintoma é
a API inteira em erro de permissão.

### Coerência entre o pool e o `max_connections`

`max_connections=100` no PostgreSQL contra `connection_limit=15` no Prisma da
API, `5` no `migrate` (transitório), ~10 da suíte de testes rodando no host e o
`psql` do operador: ~35 no pico. O resto é folga para um incidente. Número
grande demais não é generosidade — é um limite que nunca avisa antes de a
máquina começar a paginar.

### Duas grafias para a mesma exigência de TLS

O Prisma fala `sslmode=require&sslaccept=strict&sslcert=…`; o `libpq` (psql,
pg_dump, e portanto o `backup.sh`) fala `sslmode=verify-full&sslrootcert=…`.
Trocar uma pela outra não dá erro de sintaxe: dá uma conexão mais fraca do que
se pensa. O `env.ts` valida a grafia do Prisma explicitamente porque o padrão
da biblioteca para `sslaccept` é `accept_invalid_certs` — o silêncio, ali, vale
pelo valor frouxo.

Detalhe de criptografia (o que é cifrado, o que não é, rotação de chave):
[`CRIPTOGRAFIA.md`](CRIPTOGRAFIA.md).
