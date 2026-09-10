# VanPro — front-end

React 19 + TypeScript + Vite 8 + Tailwind 4. Sem webpack, sem Babel, sem Cypress:
o build e o do Vite e o E2E e Playwright.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Vite em `http://localhost:5173`, com proxy de `/api` e `/socket.io` para `http://localhost:3000` |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run typecheck` | So a checagem de tipos (`src`, `e2e`, configs) |
| `npm run lint` | oxlint |
| `npm run e2e` | Playwright contra a **pilha em modo produção** (`https://vanpro.localhost:8443`), não contra o Vite de desenvolvimento |

## Como a sessao funciona

- Access e refresh vivem em **cookie httpOnly**. O front nunca ve o token, e
  nada de sessao e gravado em `localStorage`/`sessionStorage`.
- O CSRF volta no JSON do login/registro e fica **em memoria** (`src/lib/api.ts`);
  toda mutacao envia `x-csrf-token`.
- Existe **um unico** `fetch`, dentro de `src/lib/api.ts`. Ele injeta
  `credentials: 'include'`, tenta **um** refresh em 401 e refaz a chamada, e
  normaliza o envelope de erro na classe `ApiError` (com `.code`).
- Front e API precisam ficar na **mesma origem** — por isso o proxy no dev e no
  nginx. Cookie `SameSite` nao acompanha chamada cross-site.

## Dinheiro

A API devolve `{ cents, formatted }`. **Exiba `formatted`, calcule com `cents`.**
Nao existe aritmetica de reais em ponto flutuante no front.

## E2E

**97 cenários, zero pulados.** Rodam contra a pilha completa em modo produção —
nginx com TLS, a imagem que vai para o servidor, PostgreSQL e Redis de verdade
— e não contra o servidor de desenvolvimento. Testar o Vite testaria um
artefato que ninguém publica.

```bash
docker compose up -d --build          # na raiz do repositório
cd web && npx playwright install chromium
npx playwright test
```

As contas são as do seed (`VanPro@Demo2026`), declaradas em `e2e/helpers.ts`.
Duas variáveis sobrescrevem, e só elas: `E2E_PASSWORD` e `E2E_ADMIN_TOTP` — o
administrador da plataforma tem segundo fator obrigatório, porque o console que
suspende frotas exige 2FA.

Nenhum cenário se declara "não verificado": o que dependia de um estado ausente
(empresa suspensa, segunda página de lista, segundo dispositivo conectado)
passou a **criar** esse estado. `e2e/limites.ts` zera a contagem de rate limit
que a própria suíte gerou — sem afrouxar o limite de produção, que continua
provado por um cenário dedicado.

Inventário de cada botão e cada cenário: [`e2e/INVENTARIO.md`](e2e/INVENTARIO.md).

## Docker

`Dockerfile` multi-stage → `nginx:alpine` como usuario **nao-root** na porta
**8080**. O `nginx.conf` traz `/healthz`, proxy de `/api` e `/socket.io` para
`http://api:3000`, fallback de SPA, gzip e os cabecalhos de seguranca (CSP sem
`unsafe-eval`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
COOP/CORP).
