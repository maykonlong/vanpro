# VanPro

ERP multi-tenant para gestão de frotas de transporte escolar, fretamento e turismo.

Uma empresa cadastra sua frota, seus alunos e sua equipe; o sistema cuida do
financeiro (DRE por regime de caixa), do ponto dos motoristas, da escala de
fretamentos, da comunicação com os pais e das obrigações de LGPD sobre dados de
crianças.

> **Estado:** reescrito a partir da v2. A versão anterior não subia (faltavam
> dependências e scripts) e expunha o CRUD de alunos sem autenticação. O
> histórico do que mudou e por quê está em [`docs/RELATORIO-VALIDACAO.md`](docs/RELATORIO-VALIDACAO.md).

---

## Subir o projeto

Pré-requisitos: **Docker**, **Node 20+**.

```bash
git clone <repo> && cd vanpro
node infra/scripts/gen-secrets.mjs --write
docker compose up -d postgres redis
cd api && npm ci && npx prisma migrate deploy && npm run prisma:seed && npm run dev
```

Em outro terminal:

```bash
cd web && npm ci && npm run dev
```

- Front: http://localhost:5173
- API: http://localhost:3000/api/v1
- Documentação da API: http://localhost:3000/api/v1/docs *(só fora de produção)*

Tudo em contêiner, do jeito que vai para produção:

```bash
docker compose up -d --build
```

### Contas de demonstração

Criadas pelo seed, senha **`VanPro@Demo2026`** para todas. São **duas empresas**
de propósito — um sistema multi-tenant com um único inquilino no banco parece
correto até o dia em que entra o segundo.

| E-mail | Papel | Empresa |
|---|---|---|
| `admin@vanpro.com.br` | SUPER_ADMIN | plataforma |
| `roberto@transvan.com.br` | OWNER | TransVan Escolar |
| `secretaria@transvan.com.br` | MANAGER (só financeiro) | TransVan Escolar |
| `carlos@transvan.com.br` | DRIVER | TransVan Escolar |
| `monitora@transvan.com.br` | ASSISTANT | TransVan Escolar |
| `maria@exemplo.com.br` | PARENT | TransVan Escolar |
| `helena@rotasegura.com.br` | OWNER | Rota Segura |
| `joana@freelancer.com.br` | DRIVER freelancer | **as duas empresas** |
| `joao.pai@exemplo.com.br` | PARENT | Rota Segura |

`joana@freelancer.com.br` existe para exercitar o caso que quebra
multi-tenancy ingênua: a mesma pessoa com vínculo ativo em duas frotas, sem que
uma enxergue os dados da outra.

---

## Arquitetura

```
web/   React 19 + Vite + Tailwind        → nginx (não-root, porta 8080)
api/   Express 5 + Prisma + PostgreSQL   → Node 22 alpine (não-root)
       Redis (rate limit distribuído + presença de socket)
```

O contrato interno que todo código novo segue está em
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### O isolamento entre empresas não é responsabilidade do controller

A regra que sustenta o produto inteiro vive na camada de dados, não nas rotas:

```ts
// src/lib/prisma.ts — extensão do Prisma Client
prisma.student.findMany()      // vira ... WHERE "companyId" = <empresa do contexto>
prisma.student.findMany()      // sem contexto de empresa → LANÇA, não devolve tudo
```

Isso é deliberado. A versão anterior deixava o filtro a cargo de cada
controller, e o DRE — a tela principal do produto — somava o faturamento de
todas as empresas do banco porque um `aggregate` esqueceu o `where`. Nenhum
teste tentava atravessar de uma empresa para outra, então o defeito era
invisível.

Cruzar empresas continua possível, mas só de forma explícita e visível na
revisão de código:

```ts
runUnscoped('cron-cobranca', () => prisma.invoice.updateMany({ ... }))
```

### Sentinela — o escudo de borda

`src/security/sentinela.ts` faz o que só dá para fazer antes do handler:
allowlist de Content-Type, poluição de protótipo, profundidade e tamanho de
payload, byte nulo, travessia de caminho, poluição de parâmetro HTTP e
assinaturas de alta confiança (`<script`, `javascript:`, `${jndi:`,
tautologia SQL).

O que ele **não** faz é bloquear texto humano. A versão anterior barrava
qualquer apóstrofo no corpo da requisição: "Maria D'Ávila" não conseguia se
cadastrar, senhas com aspa não passavam, e nenhuma injeção era impedida — o
Prisma já parametriza. A suíte tem 12 casos de conteúdo legítimo que precisam
passar antes dos 12 casos de ataque que precisam ser barrados.

### Dinheiro

Sempre `Int` em **centavos**. `0.1 + 0.2 !== 0.3`, e num DRE que soma centenas
de mensalidades o erro acumula até a conciliação nunca fechar.
Entrada por `brlInput` (aceita `199.9`, `"199,90"`, `"R$ 199,90"`), saída por
`money()` → `{ cents, formatted }`.

### Sessão

Dois tokens, nenhum deles no corpo da resposta:

- **access** — JWT de 15 min em cookie `httpOnly`, `SameSite=Strict`.
- **refresh** — valor opaco guardado no banco **apenas como hash**, rotacionado
  a cada uso, com detecção de reuso: token já rotacionado que reaparece revoga a
  família inteira.

Toda requisição confirma no banco que a sessão ainda vive e que o vínculo com a
empresa continua ativo — demitir alguém tem efeito imediato, não em até 15
minutos. CSRF por double-submit assinado por HMAC, exigido em toda escrita que
carrega cookie de sessão.

### Integração sem credencial não é simulada

Sem `ASAAS_API_KEY`, a rota de cobrança responde **`503 FEATURE_DISABLED`**.
Não gera fatura falsa, não grava `companyId: 'mock-company'`, não devolve um
`gatewayId` inventado — que era o comportamento anterior, e fazia o painel
mostrar faturamento que não existia. O mesmo vale para WhatsApp, Google Maps e
o assistente de IA.

---

## Testes

Vitest + supertest contra **PostgreSQL real**. Não há mock de banco: fixture
testa a unidade, só o banco de verdade testa o sistema.

```bash
cd api
npm test                 # suíte completa
npm run test:coverage    # com cobertura (piso de 70% falha o build)
```

Todo módulo cobre, no mínimo: caminho feliz, borda, negação por papel e
**tentativa de acesso cruzado entre empresas**.

E2E do front com Playwright:

```bash
cd web && npx playwright test
```

### Guardas de regressão

```bash
bash infra/scripts/guards.sh
```

15 verificações estáticas, uma para cada defeito que já existiu neste
repositório: segredo com valor padrão, identificador simulado no banco, `console.*`,
`as any`, token de sessão no corpo da resposta, filtro de tenant escrito à mão,
rota sem guarda de papel, webhook sem assinatura, dinheiro em float, SQLite,
container como root, upload servido estaticamente e prefixo de rota montado duas
vezes.

O teste prova que a defesa funciona hoje; o guarda prova que ninguém a removeu
amanhã. Rodam no CI, e reprovam o merge.

---

## Variáveis de ambiente

Ver [`api/.env.example`](api/.env.example) — comentado campo a campo.

**Nenhum segredo tem valor padrão.** Faltando `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` ou `PRISMA_FIELD_ENCRYPTION_KEY`, o processo não sobe e diz
exatamente o que falta. O código anterior trazia
`process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123'` em quatro
arquivos, o que significa que qualquer deploy sem a variável rodava com um
segredo publicado no GitHub.

`NODE_ENV` controla a otimização do build; `APP_ENV` (`local`/`staging`/`production`)
controla o rigor das travas. Separar os dois evita a escolha ruim entre rodar o
artefato de produção na máquina local e ter travas de produção que valem de
verdade.

> `PRISMA_FIELD_ENCRYPTION_KEY` cifra nome, endereço e foto dos alunos em
> repouso. **Perdê-la torna esses dados ilegíveis para sempre** — guarde em
> cofre, não no repositório.

---

## Segurança e privacidade

| Camada | O que existe |
|---|---|
| Sessão | cookie `httpOnly`+`Strict`, refresh rotativo com detecção de reuso, revogação imediata, bloqueio progressivo por tentativa, expiração de senha em 90 dias |
| 2FA | TOTP com 10 códigos de recuperação de uso único; passkeys (WebAuthn) |
| Autorização | `requireRole` em toda rota + feature flags granulares por gestor; modo arquivo (ex-funcionário lê o histórico, não escreve) |
| Entrada | zod na fronteira; o handler nunca lê `req.body` cru — mass-assignment é impossível por construção |
| Dados | isolamento por empresa na camada de acesso; criptografia em repouso de nome, endereço e foto |
| Arquivos | upload por empresa, nome aleatório, MIME conferido por **magic bytes**; download por rota autenticada — nunca `express.static` |
| Auditoria | trilha append-only encadeada por hash, com `verifyChain()` que aponta onde a cadeia quebrou |
| LGPD | portabilidade, consentimento, direito ao esquecimento com aprovação humana, purga automática de credenciais expiradas |
| Rede | CSP sem `unsafe-eval`, HSTS, Permissions-Policy, COOP/CORP, CORS de origem única |
| Infra | contêineres não-root, filesystem read-only, `cap_drop: ALL`, `npm ci` no build |

---

## Licença

Proprietário.
