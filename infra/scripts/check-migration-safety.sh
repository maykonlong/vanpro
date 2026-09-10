#!/usr/bin/env bash
# ─── Guarda: migration destrutiva não passa sem aceite escrito ──────────────
#
#   bash infra/scripts/check-migration-safety.sh                 # tudo
#   bash infra/scripts/check-migration-safety.sh --desde origin/main   # só o novo
#   bash infra/scripts/check-migration-safety.sh --help
#
# ─── Por que este guarda existe ─────────────────────────────────────────────
#
# `infra/scripts/rollback.sh` reverte o CÓDIGO e não o schema. Isso só funciona
# enquanto o código antigo continuar compatível com o schema novo. Uma única
# migration com `DROP COLUMN` fecha essa porta em silêncio: o rollback continua
# rodando, continua dizendo "app revertido", e o app quebra no primeiro acesso.
#
# Reversibilidade que ninguém verifica é falsa sensação de reversibilidade — é
# pior que não ter rollback, porque se conta com ela no pior momento.
#
# Este guarda falha quando uma migration contém:
#
#   DROP COLUMN                  código antigo faz SELECT do que sumiu
#   DROP TABLE                   funcionalidade inteira 500
#   ALTER COLUMN … SET NOT NULL  código antigo insere sem o campo e é recusado
#   DROP CONSTRAINT              perda de garantia sem substituto declarado
#
# Nenhuma delas é proibida — todas são, às vezes, exatamente o certo. O que este
# guarda exige é que a decisão seja ESCRITA no arquivo, não tomada por omissão.
#
# ─── Como aceitar ──────────────────────────────────────────────────────────
#
# Crie, NA MESMA PASTA do `migration.sql`, um arquivo `ACEITE-DESTRUTIVO.md`
# dizendo quem aceitou, quando, por que a remoção é a decisão certa, e por que
# o rollback para a versão anterior não é mais necessário.
#
# O aceite fica versionado ao lado do comando que autoriza — não numa planilha,
# não numa mensagem de commit que ninguém relê.
#
# Por que ao LADO, e não dentro do `migration.sql`: o Prisma guarda o checksum
# de cada migration em `_prisma_migrations`. Editar o arquivo de uma migration
# JÁ APLICADA muda o checksum, e o próximo `migrate dev` passa a exigir reset do
# banco. Em desenvolvimento é um susto; em produção é um incidente. A primeira
# versão deste guarda pedia o marcador dentro do SQL e quebrou exatamente assim.
#
# Antes de escrever o marcador, considere expand/contract (ver o topo de
# `infra/scripts/rollback.sh`): quase toda remoção pode virar um deploy que
# adiciona e um deploy posterior que remove, e aí não há janela sem rollback.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "[migration-safety] erro: nao consegui chegar na raiz do repo" >&2; exit 1; }

DIR_MIGRACOES='api/prisma/migrations'
DESDE=''

erro() { printf '[migration-safety] erro: %s\n' "$*" >&2; exit 2; }
ajuda() { sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --desde)   DESDE="${2:?--desde precisa de um ref git (ex.: origin/main)}"; shift ;;
    -h|--help) ajuda; exit 0 ;;
    *)         erro "opcao desconhecida: $1 — rode com --help" ;;
  esac
  shift
done

[ -d "$DIR_MIGRACOES" ] || erro "$DIR_MIGRACOES nao existe. Rode a partir da raiz do repo."

# Quais arquivos examinar. Com --desde, só os que mudaram — é o modo do CI, onde
# examinar o histórico inteiro reprovaria migrations já aceitas há meses.
if [ -n "$DESDE" ]; then
  command -v git >/dev/null 2>&1 || erro 'git nao encontrado, e --desde precisa dele.'
  git rev-parse --verify "$DESDE" >/dev/null 2>&1 || erro "ref '$DESDE' desconhecido. Rode 'git fetch' antes."
  ARQUIVOS="$(git diff --name-only --diff-filter=ACMR "$DESDE"...HEAD -- "$DIR_MIGRACOES" 2>/dev/null | grep 'migration\.sql$' || true)"
  ESCOPO="alteradas desde $DESDE"
else
  ARQUIVOS="$(find "$DIR_MIGRACOES" -name 'migration.sql' -type f 2>/dev/null | LC_ALL=C sort || true)"
  ESCOPO='todas as migrations do repo'
fi

N_ARQUIVOS="$(printf '%s' "$ARQUIVOS" | grep -c . || true)"
printf '[migration-safety] escopo: %s — %d arquivo(s)\n' "$ESCOPO" "${N_ARQUIVOS:-0}"

# Zero arquivos com --desde é legítimo (PR que não mexe em schema). Zero arquivos
# sem --desde, num repo que TEM migrations, é o guarda medindo nada e dizendo que
# está tudo bem — que é exatamente o defeito que esta base não aceita.
if [ "${N_ARQUIVOS:-0}" -eq 0 ]; then
  if [ -z "$DESDE" ] && [ -n "$(find "$DIR_MIGRACOES" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)" ]; then
    printf '[migration-safety] NAO VERIFICADO: ha diretorios de migration em %s mas nenhum migration.sql foi encontrado. O guarda nao mediu nada — isso nao e aprovacao.\n' "$DIR_MIGRACOES" >&2
    exit 2
  fi
  echo '[migration-safety] ok — nenhuma migration a examinar.'
  exit 0
fi

# Comentário SQL (`--`) fora: um guarda que acusa a própria documentação ensina a
# equipe a ignorar o guarda.
sem_comentario() { grep -vE '^[[:space:]]*--' ; }

PADRAO='DROP[[:space:]]+COLUMN|DROP[[:space:]]+TABLE|SET[[:space:]]+NOT[[:space:]]+NULL|DROP[[:space:]]+CONSTRAINT'
ACEITE='ACEITE-DESTRUTIVO.md'

FALHAS=0
ACEITOS=0
LIMPOS=0

while read -r arq; do
  [ -n "$arq" ] || continue
  [ -f "$arq" ] || continue

  ACHADOS="$(sem_comentario < "$arq" | grep -inE "$PADRAO" || true)"

  if [ -z "$ACHADOS" ]; then
    LIMPOS=$((LIMPOS + 1))
    continue
  fi

  ARQ_ACEITE="$(dirname "$arq")/$ACEITE"
  if [ -f "$ARQ_ACEITE" ]; then
    # Aceite vazio nao e aceite: um arquivo em branco criado so para calar o
    # guarda e o mesmo que nao ter decidido nada.
    if [ "$(tr -d '[:space:]' < "$ARQ_ACEITE" | wc -c)" -lt 80 ]; then
      FALHAS=$((FALHAS + 1))
      printf '\033[31mFALHA\033[0m  %s\n' "$arq"
      printf '        %s existe mas esta praticamente vazio.\n' "$ARQ_ACEITE"
      printf '        Escreva o motivo: aceite sem justificativa nao e decisao, e silencio.\n\n'
      continue
    fi
    ACEITOS=$((ACEITOS + 1))
    printf '\033[33maceito\033[0m %s\n' "$arq"
    printf '        ver %s\n' "$ARQ_ACEITE"
    continue
  fi

  FALHAS=$((FALHAS + 1))
  printf '\033[31mFALHA\033[0m  %s\n' "$arq"
  printf '%s\n' "$ACHADOS" | sed 's/^/         /'
  cat <<TXT
         Esta migration e destrutiva e o codigo da versao ANTERIOR deixa de
         funcionar contra este schema. Com isso, infra/scripts/rollback.sh
         deixa de bastar — e ele nao tem como saber disso sozinho.

         Prefira expand/contract (ver o topo de infra/scripts/rollback.sh).
         Se a remocao for mesmo a decisao certa, crie ao lado deste SQL:

           $(dirname "$arq")/ACEITE-DESTRUTIVO.md

         dizendo quem aceitou, quando, por que remover e por que o rollback para
         a versao anterior nao e mais necessario.

         NAO escreva o aceite dentro do migration.sql: isso muda o checksum de
         uma migration ja aplicada e o proximo `migrate dev` exige reset.

TXT
done <<< "$ARQUIVOS"

printf '\n[migration-safety] %d limpa(s) · %d aceita(s) por escrito · %d reprovada(s)\n' \
  "$LIMPOS" "$ACEITOS" "$FALHAS"

if [ "$FALHAS" -gt 0 ]; then
  echo '[migration-safety] REPROVADO — ha migration destrutiva sem aceite escrito.' >&2
  exit 1
fi
echo '[migration-safety] ok'
