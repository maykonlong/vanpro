# Relatório de validação — VanPro

Escopo: reescrita da v2 para produção. Branch `harden/production-ready`.

**Regra que governa este documento:** só entra como verificado o que foi
**executado e medido**. O que não foi exercitado aparece como `NÃO VERIFICADO`,
nunca como aprovado — ausência de sinal não é aprovação.

---

## 1. Ponto de partida

A auditoria inicial encontrou 5 defeitos críticos e 9 altos. Os cinco críticos:

| # | Defeito | Consequência |
|---|---|---|
| 1 | `api/` sem `@prisma/client`, sem `prisma`, sem scripts `dev`/`build`/`start` | **a API não subia**; CI, Dockerfile e `iniciar.bat` quebravam |
| 2 | `students` montado sem auth na linha 99 e com auth na 104 — o Express casa o primeiro | **CRUD de crianças público**: nome, escola, endereço, foto |
| 3 | Verificação de assinatura do webhook **comentada** | qualquer um quitava fatura alheia |
| 4 | `student`/`vehicle`/`financial`/`timecard` sem filtro de empresa | **o DRE somava o faturamento de todos os tenants** |
| 5 | `JWT_SECRET \|\| 'super_secret_jwt_vanpro_key_123'` em 4 arquivos | deploy sem env rodava com segredo público no GitHub |

O `blindar` na versão original: **exit 2 (NO-GO)**, 180 achados, 26 checks
reprovados, cobertura de checks 69%.

---

## 2. O que existe hoje

| Área | Arquivos | Linhas |
|---|---|---|
| `api/src` | 45 | 8.949 |
| `api/tests` | 15 | 3.935 |
| `web/src` | 41 | 8.320 |
| `web/e2e` | 7 | 700 |
| `infra` + `docs` | 5 | 461 |

Removidos: `backend/` e `frontend/` (segunda stack morta), `data_storage.json`,
`teste-visual*.html`, `translate.js`, `sec.html`.

---

## 3. Verificado por execução

### 3.1 Suíte de testes — `269 / 269`

`npx vitest run` contra **PostgreSQL real** (`vanpro_test`), 13 arquivos.
Sem mock de banco: fixture testa a unidade, só o banco testa o sistema.

| Métrica | Valor | Piso do build |
|---|---|---|
| Linhas / statements | **75,53 %** | 70 % |
| Branches | **73,25 %** | 60 % |
| Funções | **77,90 %** | 70 % |

Cobre: isolamento entre empresas (camada de dados e HTTP), auth completo
(lockout, expiração de senha, 2FA, códigos de recuperação, rotação de refresh
com detecção de reuso), matriz RBAC por papel, CSRF, Sentinela, webhooks com
idempotência, LGPD com verificação da cadeia de auditoria, e as três rotinas
agendadas.

### 3.2 Isolamento entre empresas — provado ao vivo

Duas empresas no seed. Pela API, autenticado:

```
Helena (Rota Segura)  → GET /students        → 2 alunos (os dela)
Roberto (TransVan)    → GET /students        → 5 alunos (os dele)
Helena → GET /students/<id de aluno da TransVan>  → 404   (não 403: 403 confirmaria a existência)
DRE Helena  → R$ 0,00        DRE Roberto → R$ 3.920,00
```

O DRE conferido centavo a centavo contra `SELECT sum("amountCents")` no Postgres:
`392000` e `573050` centavos — bate exatamente com `R$ 3.920,00` e `R$ 5.730,50`.

### 3.3 Matriz de autorização — medida por HTTP

| Papel | `/financial/dre` | `/company/team` | `POST /students` | `POST /vehicles` | `/privacy/audit-trail` |
|---|---|---|---|---|---|
| OWNER | 200 | 200 | 201 | 201 | 200 |
| MANAGER (só `canManageFinance`) | 200 | 200 | **403** | **403** | **403** |
| DRIVER | **403** | **403** | **403** | **403** | **403** |
| ASSISTANT | **403** | **403** | **403** | **403** | **403** |
| PARENT | **403** | **403** | **403** | **403** | **403** |

Auditoria rota a rota (`infra/scripts/audit-route-guards.mjs`):
**68 rotas com `requireRole`**, 6 públicas declaradas com marcador escrito,
**0 sem guarda**.

### 3.4 Criptografia em repouso — conferida no disco

```
SELECT left(name,60) FROM "Student";
 v1.aesgcm256.5073e902.d7khz9nqeJ7poosH.lwTPmZW2Yo2_TI1miF5rI
```

### 3.5 Comportamento de borda

| Verificação | Resultado |
|---|---|
| `/students` sem sessão | 401 (era CRUD público) |
| `POST` autenticado sem `x-csrf-token` | 403 `CSRF_TOKEN_MISSING` |
| Payload com `<script>` | 400 `REQUEST_REJECTED` |
| Nome com apóstrofo (`Teste D'Avila`) | 201 — aceito |
| Webhook sem token | 401 |
| Webhook com payload real do Asaas (980 bytes) | chega à verificação HMAC |
| `POST /invoices` sem `ASAAS_API_KEY` | 503 `FEATURE_DISABLED`, zero linhas gravadas |
| Origem `https://evil.example` | 403 `CORS_ORIGIN_NOT_ALLOWED` |
| SIGTERM no contêiner | encerramento gracioso em 89 ms, exit 0 |

Cabeçalhos conferidos na resposta: CSP sem `unsafe-inline`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` negando
câmera/mic/geo/pagamento, `x-request-id`, sem `X-Powered-By`.

### 3.6 Interface

As 8 telas de OWNER, e as de DRIVER/ASSISTANT/PARENT/SUPER_ADMIN, renderizadas
no navegador contra a API real — não contra mock. Mobile 375 px: **zero
overflow horizontal**, `lang="pt-BR"`, alvos de toque ≥ 44 px, skip link.
Bundle **130 KB gzip** (orçamento: 400 KB).

### 3.7 Guardas de regressão — 15 / 15

`bash infra/scripts/guards.sh`. Cada guarda corresponde a um defeito que
existiu neste repositório: segredo com valor padrão, identificador simulado,
`console.*`, `as any`, token no corpo da resposta, filtro de tenant escrito à
mão, rota sem papel, webhook sem assinatura, dinheiro em float, SQLite,
contêiner como root, upload estático, prefixo montado duas vezes.

### 3.8 Dependências

`npm audit`: **0 vulnerabilidades** na API; web sem `high`/`critical`.
Corrigidos no caminho: `@simplewebauthn/server` 11 → 13 (advisory de verificação
de registro), `react-router` 6 → 7 (injeção de construtor e open redirect),
`node-cron` 3 → 4, `vitest` → 4, `vite` → 7, e `deepmerge-ts` via `override`.

---

## 4. Defeitos encontrados **durante** a construção

Todos por execução real, não por leitura. Cada um estava em código que eu
mesmo tinha escrito e que "parecia certo".

| # | Defeito | Como apareceu | Correção |
|---|---|---|---|
| 1 | `mergeWhere` embrulhava o `where` de `update`/`delete` em `AND`; `WhereUniqueInput` exige o campo único na raiz | **todo `PATCH`/`DELETE` devolvia 500** — 27 rotas. O produto criava e lia, não alterava nada | merge plano para operações de `where` único |
| 2 | Sentinela escaneava o `Buffer` cru do webhook; `Object.keys(buffer)` dá um índice por byte, e o teto de 300 chaves reprovava qualquer payload > ~300 B | **nenhuma cobrança real seria baixada** | corpo binário tratado como opaco, com teto próprio de bytes |
| 3 | Rate limit montava o store do Redis no import, antes da conexão; o construtor dispara um comando | **a API não subia** — o oposto do "fail-open" que o comentário prometia | store criado sob demanda, só com Redis pronto |
| 4 | `PrismaPromise` é preguiçoso: `runUnscoped('x', () => prisma.x.create())` executava fora da janela do `AsyncLocalStorage` | 9 testes de tenant falhando | o contexto amarra o resultado chamando `.then` de forma síncrona |
| 5 | Variável opcional vazia (`${VAR:-}` do compose) contava como preenchida | contêiner abortava por `ASAAS_API_KEY` inválida | string vazia normalizada para ausente |
| 6 | CORS recusava o próprio proxy, e a recusa vazava como **500** | login não funcionava pelo nginx | lista de origens + `CorsOriginError` tratado com 403 |
| 7 | `tmpfs` do compose montava por cima do `chown` da imagem | nginx morria sem permissão de escrita | `mode=1777` explícito |
| 8 | `swagger-jsdoc` sem anotação nenhuma nos controllers | **documentação subia com 0 rotas** — casca vazia que parece documentação | spec derivada da tabela de montagem: 95 rotas, não pode divergir do código |
| 9 | Seed casava registro por campo de exibição (escola + série); corrigir a acentuação quebrou o casamento | **seed duplicou alunos e mensalidades** | `upsert` por UUIDv5 sobre chave estável — rodar dez vezes = rodar uma (verificado) |
| 10 | Toda a interface sem acentuação | "Gestao", "Configuracoes", "Combustivel" | 70 arquivos corrigidos, incluindo os seletores de E2E que dependiam do texto antigo |
| 11 | `situação ACTIVE` cru na tela | valor de banco vazando como texto | mapa de rótulos para 15 enums |
| 12 | Lockfile gerado no Windows não fechava com `npm ci` no Linux; o npm 10.9.8 da imagem base quebra com `overrides` | **build do contêiner falhava** | npm fixado em `11.6.2` no Dockerfile, lock regenerado no Linux |

Erro meu que vale registro: escrevi em `.accept-risk.md` que `prisma` era só
`devDependency` e portanto a CVE não ia para a imagem. Estava errado — na linha
6 ela é dependência de **runtime** do `@prisma/client`, e está no contêiner
(66,9 MB). O gate de produção falhava de verdade. Corrigido com `override`, e o
documento agora registra a leitura errada em vez de escondê-la.

---

## 5. NÃO VERIFICADO

Isto **não** é a mesma coisa que "provavelmente funciona".

| Item | Situação |
|---|---|
| **Build do contêiner após a correção nº 12** | O Docker Desktop parou antes do rebuild final. A correção do `npm ci` foi validada rodando `npm install` + `npm ci --dry-run` **dentro** do `node:22-alpine` (saída: *lock consistente no Linux*), mas a imagem completa não foi reconstruída depois disso. **Precisa de um `docker compose up -d --build` com o Docker no ar.** |
| Cobrança real no Asaas | Só o caminho desligado foi exercitado (503). O caminho ligado nunca falou com o gateway. |
| Envio real de WhatsApp | Idem. Sem credencial, responde `FEATURE_DISABLED`. |
| E2E do Playwright | Os testes existem (7 arquivos, 6 papéis), mas o navegador não está instalado neste ambiente. `npx playwright install && npx playwright test`. |
| Restauração de backup | Não há rotina de backup nem restauração testada. `BACKUP_RECOVERY` é **NOT VERIFIED**. |
| Rollback de deploy | Não exercitado. |
| Host de produção | Firewall, TLS, DNS, vizinhos de contêiner — nada disso foi olhado. É o escopo do `ancorar`, que não está instalado. |
| Lighthouse | Não executado. |

---

## 6. Veredito

**CONDITIONAL GO** para homologação. **NO-GO** para produção com cobrança real.

O que destrava o GO pleno, em ordem:

1. Subir o Docker e rodar `docker compose up -d --build` — confirmar que a
   imagem constrói com o lockfile novo (é o único item aberto do trabalho).
2. `npx playwright install && npx playwright test` — os E2E de cada botão.
3. Rotina de backup **com restauração testada**, e um rollback exercitado.
4. Sandbox do Asaas no CI antes de ligar cobrança.
5. `ancorar` no host de destino: host não verificado não é host aprovado.

Riscos conhecidos e aceitos, com prazo de revisão: [`.accept-risk.md`](../.accept-risk.md).
O CI falha se algum prazo vencer.

---

## 7. Como reproduzir esta validação

```bash
docker compose up -d postgres redis
cd api && npm ci && npx prisma migrate deploy && npm run prisma:seed

npm run typecheck                    # 0 erros
npm run test:coverage                # 269/269, cobertura acima do piso
cd .. && bash infra/scripts/guards.sh          # 15/15
node infra/scripts/audit-route-guards.mjs      # 0 rotas sem guarda
bash infra/scripts/check-accepted-risks.sh     # nenhum prazo vencido
docker compose up -d --build                   # stack completa
```
