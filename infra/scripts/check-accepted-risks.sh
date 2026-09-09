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

while IFS= read -r linha; do
  data=$(echo "$linha" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
  [ -z "$data" ] && continue
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

printf '\033[32mok\033[0m     %d risco(s) aceito(s), nenhum com prazo vencido\n' "$TOTAL"
