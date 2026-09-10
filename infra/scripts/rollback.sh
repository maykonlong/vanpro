#!/usr/bin/env bash
# ─── Rollback do VanPro — sem cair na armadilha do serviço `migrate` ────────
#
#   bash infra/scripts/rollback.sh <sha-ou-tag>
#   DRY_RUN=1 bash infra/scripts/rollback.sh <sha-ou-tag>   # só mostra
#
# ─── A armadilha ────────────────────────────────────────────────────────────
#
# O rollback "óbvio" — `docker compose down && git checkout <sha> && up -d` —
# RE-EXECUTA o serviço `migrate`, que é one-shot, agora com o schema ANTIGO.
# Como `api` depende dele com `condition: service_completed_successfully`, basta
# esse migrate velho sair != 0 por qualquer motivo (uma migration já aplicada
# que ele não conhece, um checksum divergente do `_prisma_migrations`) para a
# API NÃO SUBIR: "dependency failed to start: container vanpro-migrate exited".
#
# Você fica sem caminho para frente (o deploy novo tinha bug) nem para trás (o
# migrate velho barra) — no meio de um incidente, que é a única hora em que
# alguém roda rollback.
#
# A saída é não re-rodar o migrate: reconstruir SÓ os serviços de app, com
# `--no-deps`, deixando `postgres`, `redis` e `migrate` intocados.
#
# ─── ⚠ RESSALVA QUE NÃO PODE SER IGNORADA ──────────────────────────────────
#
# Este script reverte CÓDIGO. Ele NÃO reverte schema, e no VanPro isso não é
# detalhe.
#
# O projeto irmão (fast_list) pode fazer rollback só de código porque o schema
# dele é ADITIVO por construção: `ADD COLUMN IF NOT EXISTS`, nunca remoção. O
# código antigo convive com o schema novo porque simplesmente ignora as colunas
# a mais.
#
# O VanPro usa migrations do Prisma, que NÃO são aditivas por natureza. Um
# `prisma migrate dev` gera com naturalidade `DROP COLUMN`, `DROP TABLE`,
# `ALTER COLUMN … SET NOT NULL` e `DROP CONSTRAINT`. Quando a migration nova
# contém qualquer um desses:
#
#   • DROP COLUMN         → o código antigo faz SELECT de coluna que não existe
#                           mais. Prisma quebra na leitura, não na escrita: o
#                           erro aparece no primeiro GET, com o app "no ar".
#   • SET NOT NULL        → o código antigo insere sem o campo e toma erro de
#                           constraint em toda escrita.
#   • DROP TABLE          → funcionalidade inteira 500.
#
# Nesses casos o rollback de código NÃO BASTA, e rodá-lo dá a falsa sensação de
# ter revertido — o app volta a subir e quebra em produção logo depois. A saída
# real é restaurar o dump do passo 1 do RUNBOOK-DEPLOY.md, com a perda de dados
# do intervalo, ou seguir para frente com um hotfix.
#
# O que evita esse beco é DISCIPLINA EXPAND/CONTRACT, e ela é decisão de quem
# escreve a migration, não deste script:
#
#   1. EXPAND    (deploy N)   — adiciona o novo (coluna nullable, tabela nova).
#                               Nada é removido. Código antigo e novo funcionam.
#   2. MIGRATE   (deploy N)   — o código novo escreve nos dois lugares e lê do
#                               novo; backfill do histórico.
#   3. CONTRACT  (deploy N+2) — só depois que N ficou estável e o rollback para
#                               N-1 deixou de ser possível é que o velho sai.
#
# Entre EXPAND e CONTRACT existe uma janela em que o rollback funciona. Fora
# dela, não existe rollback — existe restauração de backup.
#
# `infra/scripts/check-migration-safety.sh` roda no CI e recusa migration
# destrutiva sem marcador de aceite escrito, justamente para que ninguém feche
# essa janela por acidente.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "[rollback] erro: nao consegui chegar na raiz do repo" >&2; exit 1; }

erro() { printf '[rollback] erro: %s\n' "$*" >&2; exit 1; }
info() { printf '[rollback] %s\n' "$*"; }

ajuda() { sed -n '2,70p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  -h|--help) ajuda; exit 0 ;;
  '')        echo "uso: bash infra/scripts/rollback.sh <sha-ou-tag>   (--help para o porque)" >&2; exit 2 ;;
esac

ALVO="$1"

command -v git >/dev/null 2>&1 || erro 'git nao encontrado no PATH.'
command -v docker >/dev/null 2>&1 || erro 'docker nao encontrado no PATH.'
docker compose version >/dev/null 2>&1 || erro 'o plugin `docker compose` nao respondeu. Confira se o Docker esta rodando.'

git rev-parse --verify "$ALVO^{commit}" >/dev/null 2>&1 \
  || erro "'$ALVO' nao e um commit/tag conhecido neste repo. Rode 'git fetch --tags' e confira o identificador."

# Árvore suja + checkout = mudança não commitada perdida ou conflito no meio do
# incidente. Melhor recusar do que descobrir depois.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  erro 'a arvore de trabalho tem alteracoes nao commitadas. Faca stash ou commit antes — um checkout aqui as perderia.'
fi

# O compose é a fonte da verdade de quais serviços existem; enumerar à mão
# envelhece no primeiro serviço novo.
TODOS="$(docker compose config --services 2>/dev/null)"
[ -n "$TODOS" ] || erro 'docker compose config --services nao devolveu nada. Rode a partir da raiz do repo, com o Docker no ar.'

# postgres, redis e migrate ficam de FORA. O migrate por causa da armadilha
# descrita no topo; postgres e redis porque derrubá-los transforma um rollback
# de código em uma indisponibilidade de dados.
APP_SERVICES="$(printf '%s\n' "$TODOS" | grep -vE '^(postgres|redis|migrate)$' || true)"
[ -n "$APP_SERVICES" ] || erro 'nao achei servico de app no compose (tudo casou postgres/redis/migrate). Nada a reverter.'

SHA_ATUAL="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
ALVO_SHA="$(git rev-parse --short "$ALVO^{commit}" 2>/dev/null || echo "$ALVO")"

info "rollback de codigo: $SHA_ATUAL -> $ALVO_SHA"
info 'servicos de app a reconstruir (postgres, redis e migrate ficam INTOCADOS):'
printf '%s\n' "$APP_SERVICES" | sed 's/^/  - /'

# Se o intervalo revertido contém migration, o rollback de código pode não
# bastar. Avisar aqui é barato; descobrir em produção não é.
MIGRACOES="$(git diff --name-only "$ALVO_SHA..HEAD" -- api/prisma/migrations 2>/dev/null | grep -c 'migration.sql' || true)"
if [ "${MIGRACOES:-0}" -gt 0 ]; then
  cat >&2 <<TXT

[rollback] ATENCAO: ha $MIGRACOES arquivo(s) de migration entre $ALVO_SHA e HEAD.

  Este script NAO reverte schema. Se alguma dessas migrations removeu coluna,
  removeu tabela, tornou coluna NOT NULL ou removeu constraint, o codigo antigo
  NAO e compativel com o schema atual e este rollback vai subir um app que
  quebra no primeiro acesso.

  Confira antes de continuar:
    git diff $ALVO_SHA..HEAD -- api/prisma/migrations | grep -iE 'DROP COLUMN|DROP TABLE|SET NOT NULL|DROP CONSTRAINT'

  Se aparecer algo, o caminho nao e este script: e restaurar o dump do passo 1
  do docs/RUNBOOK-DEPLOY.md, ou seguir para frente com hotfix.
TXT
fi

if [ "${DRY_RUN:-}" = '1' ]; then
  echo
  info '[DRY_RUN] nada foi executado. O que seria feito:'
  # shellcheck disable=SC2086
  echo "  git checkout $ALVO_SHA"
  # shellcheck disable=SC2086
  echo "  docker compose build $(printf '%s' "$APP_SERVICES" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  echo "  docker compose up -d --no-deps $(printf '%s' "$APP_SERVICES" | tr '\n' ' ')"
  exit 0
fi

git checkout "$ALVO_SHA" || erro "git checkout $ALVO_SHA falhou. Nada foi mudado nos conteineres."

# shellcheck disable=SC2086
docker compose build $APP_SERVICES || erro "o build dos servicos de app falhou no codigo $ALVO_SHA. Os conteineres ANTIGOS continuam no ar (nada foi derrubado) — corrija o build ou escolha outro alvo."

# --no-deps: não sobe nem re-executa postgres, redis ou migrate.
# shellcheck disable=SC2086
docker compose up -d --no-deps $APP_SERVICES || erro "o 'up' falhou. Rode 'docker compose ps' e 'docker compose logs api' para ver o estado real antes de tentar de novo."

cat <<TXT

[rollback] app revertido para $ALVO_SHA. O schema NAO foi tocado.

Agora VERIFIQUE, como em qualquer deploy — subir nao e estar certo:
  bash infra/scripts/verificar-deploy.sh https://<host>

E confira a contagem por empresa (docs/RUNBOOK-DEPLOY.md §5): "o app subiu" e
"ninguem perdeu dado" sao perguntas diferentes.
TXT
