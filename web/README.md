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
| `npm run e2e` | Playwright contra `http://localhost:5173` |

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

Os testes usam contas reais provisionadas pelo seed da API. Configure:

```
E2E_PASSWORD=...
E2E_OWNER_EMAIL=...
E2E_MANAGER_EMAIL=...
E2E_DRIVER_EMAIL=...
E2E_ASSISTANT_EMAIL=...
E2E_PARENT_EMAIL=...
E2E_SUPER_ADMIN_EMAIL=...
# opcional, por papel: E2E_<PAPEL>_PASSWORD, E2E_<PAPEL>_TOTP
```

Sem a variavel, o cenario daquele papel **pula com a razao dita em voz alta** —
ausencia de credencial nao conta como aprovacao.

## Docker

`Dockerfile` multi-stage → `nginx:alpine` como usuario **nao-root** na porta
**8080**. O `nginx.conf` traz `/healthz`, proxy de `/api` e `/socket.io` para
`http://api:3000`, fallback de SPA, gzip e os cabecalhos de seguranca (CSP sem
`unsafe-eval`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
COOP/CORP).
