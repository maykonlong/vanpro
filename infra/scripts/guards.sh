#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Guardas de regressao.
#
# Cada regra aqui corresponde a um defeito que EXISTIU neste repositorio e
# custou caro. O teste prova que a defesa funciona hoje; o guarda prova que
# ninguem a removeu amanha — inclusive por acidente, num merge apressado.
#
# Roda no CI (job "seguranca") e localmente:  bash infra/scripts/guards.sh
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/../.."

FALHAS=0
API_SRC="api/src"
WEB_SRC="web/src"

falhar() {
  printf '\033[31mFALHA\033[0m  %s\n' "$1"
  [ -n "${2:-}" ] && printf '        %s\n' "$2"
  FALHAS=$((FALHAS + 1))
}
ok() { printf '\033[32mok\033[0m     %s\n' "$1"; }

# Descarta linhas de comentario. Um guarda que acusa a propria documentacao
# ensina a equipe a ignorar o guarda — e ai ele deixa de proteger qualquer coisa.
sem_comentario() { grep -vE ':[0-9]+: *(//|\*|/\*|#)'; }

# Executa a busca; falha se sobrar alguma linha depois de tirar comentarios.
checar() {
  local titulo="$1" dica="$2"
  shift 2
  local achados
  achados=$("$@" 2>/dev/null | sem_comentario || true)
  if [ -n "$achados" ]; then
    echo "$achados"
    falhar "$titulo" "$dica"
  else
    ok "$titulo — limpo"
  fi
}

# --- 1. Segredo com valor padrao ------------------------------------------
# Origem: `process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123'` em 4
# arquivos. Sem a variavel, qualquer deploy rodava com um segredo publico.
checar "segredo com valor padrao" \
  "segredo nao tem fallback: valide em src/config/env.ts e deixe o boot falhar" \
  grep -rnE "(JWT[A-Z_]*SECRET|ENCRYPTION_KEY|API_KEY|WEBHOOK_TOKEN)[[:space:]]*(\|\||\?\?)[[:space:]]*['\"]" "$API_SRC"

# --- 2. Identificador simulado gravado no banco ---------------------------
# Origem: `companyId: 'mock-company'` no AsaasService — inclusive no caminho
# chamado de "real" — e um customer fixo `cus_000005030283`.
checar "identificador simulado" \
  "integracao sem credencial responde 503 FEATURE_DISABLED; nao simula" \
  grep -rnE "['\"]mock-company['\"]|cus_0000[0-9]+|simulated_pay_|fakeGatewayId" "$API_SRC"

# --- 3. Mock no caminho de producao ---------------------------------------
checar "mock em codigo de producao" \
  "dado de exemplo pertence ao seed e aos testes" \
  grep -rniE "^[[:space:]]*(const|let)[[:space:]]+mock[A-Z]|\[(ASAAS|WHATSAPP|GOOGLE_MAPS|WORKER)_MOCK\]" "$API_SRC" "$WEB_SRC"

# --- 4. console.* -----------------------------------------------------------
# Origem: 10 ocorrencias, uma delas logando id de usuario. console nao passa
# pela redacao de PII do pino — LGPD Art. 46.
checar "console.* no codigo" \
  "use o logger (api), que redige PII; no web, remova" \
  grep -rnE "(^|[^.[:alnum:]_])console\.(log|warn|error|info|debug)[[:space:]]*\(" "$API_SRC" "$WEB_SRC"

# --- 5. Escape do sistema de tipos ----------------------------------------
checar "escape do sistema de tipos" \
  "as any / @ts-ignore sao proibidos no projeto" \
  grep -rnE "\bas[[:space:]]+any\b|@ts-ignore|@ts-nocheck" "$API_SRC" "$WEB_SRC"

# --- 6. Token de sessao no corpo da resposta ------------------------------
# Origem: o login devolvia `token` no JSON "so pro MVP do React", anulando o
# httpOnly que o proprio README anunciava.
checar "token de sessao no corpo da resposta" \
  "sessao vive em cookie httpOnly; o corpo devolve apenas o csrfToken" \
  grep -rnE "res\.(json|send)\([^)]*\b(accessToken|refreshToken)\b" "$API_SRC"

# --- 7. Sessao em storage do navegador ------------------------------------
checar "token em storage do navegador" \
  "XSS le localStorage; a sessao e cookie httpOnly" \
  grep -rnE "(localStorage|sessionStorage)\.(set|get)Item\([[:space:]]*['\"](token|access|refresh|jwt|auth)" "$WEB_SRC"

# --- 8. Filtro de tenant escrito a mao na leitura -------------------------
# O guard do Prisma injeta companyId. Escrever a mao esconde o esquecimento —
# foi assim que o DRE somou o faturamento de todas as empresas.
#
# `runUnscoped` e a autorizacao EXPLICITA para cruzar empresas, e dentro dela o
# filtro manual passa a ser obrigatorio. Por isso o guarda olha as 60 linhas
# acima da ocorrencia (o corpo de um runUnscoped costuma ser longo): havendo runUnscoped abrindo o bloco, esta correto.
FORA_DE_ESCOPO=$(
  grep -rnE "where:[[:space:]]*\{[^}]*\bcompanyId\b" "$API_SRC/modules" 2>/dev/null |
    while IFS=: read -r arq linha resto; do
      ini=$((linha > 60 ? linha - 60 : 1))
      if ! sed -n "${ini},${linha}p" "$arq" | grep -q "runUnscoped"; then
        echo "$arq:$linha:$resto"
      fi
    done
)
if [ -n "$FORA_DE_ESCOPO" ]; then
  echo "$FORA_DE_ESCOPO"
  falhar "companyId em where fora de runUnscoped" \
    "na leitura o guard injeta; para cruzar empresas, abra runUnscoped e filtre explicitamente"
else
  ok "nenhum filtro de tenant escrito a mao na leitura"
fi

# --- 9. Rota sem guarda de papel ------------------------------------------
# Origem: 60 endpoints sem guard detectavel, e o CRUD de alunos publico.
#
# Um controller pode ser inteiramente publico de proposito (login, cadastro,
# webhook). Nesse caso ele precisa DIZER isso, com o marcador abaixo — a
# excecao vira uma decisao escrita, e nao um esquecimento que passa batido.
MARCADOR="GUARDA: rota-publica-intencional"
SEM_GUARDA=0
while IFS= read -r f; do
  rotas=$(grep -cE "^[[:space:]]*(router|publicRouter)\.(get|post|patch|put|delete)\(" "$f" || true)
  guardas=$(grep -cE "requireRole|requireSuperAdmin" "$f" || true)
  publico=$(grep -cF "$MARCADOR" "$f" || true)
  if [ "${rotas:-0}" -gt 0 ] && [ "${guardas:-0}" -eq 0 ] && [ "${publico:-0}" -eq 0 ]; then
    falhar "controller sem requireRole e sem marcador publico: $f" \
      "declare o papel, ou escreva o comentario \"$MARCADOR\" justificando"
    SEM_GUARDA=1
  fi
done < <(find "$API_SRC/modules" -name '*.controller.ts' 2>/dev/null)
[ "$SEM_GUARDA" -eq 0 ] && ok "todo controller declara papel ou se assume publico"

# O check acima olha o ARQUIVO. O perigoso e o arquivo com dez rotas protegidas
# e uma esquecida, entao a verificacao fina e por ROTA.
if command -v node >/dev/null 2>&1; then
  if SAIDA=$(node infra/scripts/audit-route-guards.mjs 2>&1); then
    ok "$(echo "$SAIDA" | head -1 | sed 's/  */ /g')"
  else
    echo "$SAIDA"
    falhar "rota sem guarda de papel" "declare requireRole(...) ou marque a rota como publica intencional"
  fi
else
  falhar "node indisponivel — auditoria de rota nao executada"     "sem medicao nao ha aprovacao: instale node ou rode audit-route-guards.mjs manualmente"
fi

# --- 10. Assinatura de webhook --------------------------------------------
# Origem: a verificacao estava COMENTADA. Qualquer um quitava fatura alheia.
WEBHOOK="$API_SRC/modules/webhooks/webhooks.controller.ts"
if [ -f "$WEBHOOK" ]; then
  if grep -q "timingSafeEqual" "$WEBHOOK"; then
    ok "webhook confere assinatura em tempo constante"
  else
    falhar "webhook sem verificacao de assinatura" \
      "rota publica que movimenta dinheiro exige token/HMAC conferido"
  fi
fi

# --- 11. Dinheiro em ponto flutuante --------------------------------------
checar "valor monetario em Float no schema" \
  "dinheiro e Int em centavos (BACEN 4658)" \
  grep -rnE "^[[:space:]]+(amount|price|fee|salary|dailyRate|monthlyFee)[[:space:]]+Float" api/prisma/schema.prisma

# --- 12. SQLite ------------------------------------------------------------
checar "SQLite referenciado" \
  "o projeto e PostgreSQL em todos os ambientes" \
  grep -rniE "provider[[:space:]]*=[[:space:]]*['\"]sqlite['\"]|url[[:space:]]*=[[:space:]]*['\"]file:" api/prisma/schema.prisma

# --- 13. Container como root ----------------------------------------------
for df in api/Dockerfile web/Dockerfile; do
  [ -f "$df" ] || continue
  USUARIO=$(grep -E "^USER " "$df" | tail -1 | awk '{print $2}')
  if [ -n "$USUARIO" ] && [ "$USUARIO" != "root" ]; then
    ok "$df roda como $USUARIO"
  else
    falhar "$df sem USER nao-root" "RCE em container root vira controle do container"
  fi
done

# --- 14. Uploads servidos como estatico -----------------------------------
# Origem: `app.use('/uploads', express.static(...))` deixava foto de crianca
# acessivel por URL adivinhavel, sem autenticacao nenhuma.
checar "uploads servidos como estatico" \
  "arquivo de aluno so por rota autenticada, com checagem de empresa" \
  grep -rnE "express\.static\([^)]*upload" "$API_SRC"

# --- 15. Montagem duplicada de rota ---------------------------------------
# Origem exata do CRUD publico: o mesmo router montado antes e depois do auth.
# O Express casa o PRIMEIRO, entao a segunda montagem — a que tinha o guard —
# nunca era alcancada.
#
# A tabela MONTAGENS existe justamente para isso ser verificavel: prefixo
# repetido e falha de CI, e nao algo que so aparece em producao.
ROUTES="$API_SRC/http/routes.ts"
if [ -f "$ROUTES" ]; then
  DUP=$(grep -oE "prefixo: '[^']*'" "$ROUTES" | sort | uniq -d)
  if [ -n "$DUP" ]; then
    falhar "prefixo montado duas vezes: $DUP"       "o Express usa o primeiro match; foi assim que /students ficou publico"
  else
    ok "nenhum prefixo de rota duplicado"
  fi

  # Toda montagem precisa dizer de que lado da fronteira esta. Sem `publico`
  # explicito, "esqueci de proteger" e indistinguivel de "e publico mesmo".
  # Conta so as ENTRADAS da tabela (prefixo com literal), nunca o campo da
  # interface `Montagem`, que tambem casaria com "prefixo:".
  MONT=$(grep -cE "prefixo: '" "$ROUTES" || true)
  DECL=$(grep -cE "publico: (true|false)" "$ROUTES" || true)
  if [ "${MONT:-0}" -ne "${DECL:-0}" ]; then
    falhar "montagem sem declarar publico/privado ($MONT montagens, $DECL declaracoes)"       "cada entrada de MONTAGENS precisa de publico: true|false"
  else
    ok "todas as $MONT montagens declaram publico/privado"
  fi
fi

echo
if [ "$FALHAS" -gt 0 ]; then
  printf '\033[31m%d guarda(s) falharam.\033[0m\n' "$FALHAS"
  exit 1
fi
printf '\033[32mTodos os %s guardas passaram.\033[0m\n' "15"
