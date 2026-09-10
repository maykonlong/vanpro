#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Risco aceito com prazo vencido volta a ser risco.
#
# `.accept-risk.md` sem data de revisao vira gaveta: o item entra "por enquanto"
# e some. Este check falha o CI quando um prazo passa, forcando a decisao a ser
# retomada — corrigir, ou renovar o prazo por escrito.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/../.."

ARQ=".accept-risk.md"
[ -f "$ARQ" ] || { echo "ok     nenhum risco aceito declarado"; exit 0; }

HOJE=$(date -u +%Y-%m-%d)
VENCIDOS=0
TOTAL=0
SEM_DATA=0

# Contagem por SECAO, e nao por linha de prazo: um risco que esquece a linha
# "Revisar ate" nao pode desaparecer da conta.
SECOES=$(grep -cE '^## R-[0-9]' "$ARQ" || echo 0)

while IFS= read -r linha; do
  data=$(echo "$linha" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
  if [ -z "$data" ]; then
    # Antes isto era `continue` silencioso: o item saia da conta e ninguem
    # notava. "Revisar ate: antes do primeiro cliente pagante" e uma intencao,
    # nao um prazo — e o proprio preambulo do arquivo diz que item sem data de
    # revisao nao e risco aceito, e risco esquecido.
    printf '[33m?[0m      sem data verificavel: %s
' "$linha"
    SEM_DATA=$((SEM_DATA + 1))
    continue
  fi
  TOTAL=$((TOTAL + 1))
  if [ "$data" \< "$HOJE" ]; then
    printf '\033[31mVENCIDO\033[0m %s (prazo era %s)\n' "$linha" "$data"
    VENCIDOS=$((VENCIDOS + 1))
  fi
done < <(grep -E '^\*\*Revisar até:\*\*' "$ARQ")

if [ "$VENCIDOS" -gt 0 ]; then
  printf '\n\033[31m%d risco(s) aceito(s) com prazo vencido.\033[0m\n' "$VENCIDOS"
  echo "Corrija o problema, ou renove o prazo em $ARQ explicando o que mudou."
  exit 1
fi

if [ "$SEM_DATA" -gt 0 ]; then
  printf '
[33m%d risco(s) sem prazo verificavel — nao contam como aceitos.[0m
' "$SEM_DATA"
  echo "Escreva uma data ISO (AAAA-MM-DD) em **Revisar ate:**, ou o item some da"
  echo "conta e ninguem volta a olhar para ele. Nao falha o build; aparece."
fi

# Dois numeros, e nao um: uma secao pode declarar varios prazos (um por item
# aceito dentro dela). Dizer "11 de 6" seria pior que nao contar.
printf '[32mok[0m     %d prazo(s) verificavel(is) em %d risco(s) declarado(s), nenhum vencido
' "$TOTAL" "$SECOES"
