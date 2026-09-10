#!/usr/bin/env bash
# ─── O que o deploy do VanPro PROMETE, conferido contra o que ele responde ──
#
#   bash infra/scripts/verificar-deploy.sh https://vanpro.exemplo.com.br
#
# Bate de FORA, contra a URL pública — não contra `localhost` de dentro do host,
# e não contra o contêiner. O que interessa é o que chega ao navegador do dono
# da van, depois de passar por todo proxy, WAF e CDN do caminho.
#
# Cada verificação aqui existe porque a falha correspondente é SILENCIOSA: a
# página abre, o app funciona, e a garantia não está lá.
#
# ─── Três estados, e o terceiro é o que faz este script valer ──────────────
#
#   PASS  medido e passou
#   FAIL  medido e reprovou
#   NV    NÃO VERIFICADO — não deu para medir
#
# NV não é PASS. Um teste que não conseguiu medir nada não descobriu que está
# tudo bem: descobriu que está cego. Por isso existe o exit 3.
#
# Códigos de saída:
#   0  APROVADO     tudo foi medido e passou
#   1  REPROVADO    há garantia prometida que não está de pé
#   3  INCOMPLETO   nada falhou, mas nem tudo foi medido — NÃO é aprovação
#   2  uso incorreto
set -uo pipefail

ajuda() { sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  -h|--help) ajuda; exit 0 ;;
  '')        echo "uso: bash infra/scripts/verificar-deploy.sh https://host" >&2; exit 2 ;;
esac

BASE="${1%/}"
command -v curl >/dev/null 2>&1 || { echo "[verificar] erro: curl nao encontrado no PATH." >&2; exit 2; }

ok=0; falhou=0; naoverificado=0
PASS() { printf '  \033[32mOK\033[0m    %s\n' "$1"; ok=$((ok + 1)); }
FAIL() { printf '  \033[31mFALHA\033[0m %s\n' "$1"; falhou=$((falhou + 1)); }
NV()   { printf '  \033[33m?\033[0m     %s\n' "$1"; naoverificado=$((naoverificado + 1)); }
titulo() { printf '\n─── %s ───\n' "$1"; }

# Sem `-k`, de propósito: um certificado que só passa com -k é um certificado
# que o navegador vai recusar. Testar com -k é testar outra coisa.
CURL='curl -sS --max-time 20'

cabecalhos() { $CURL -o /dev/null -D - "$@" 2>/dev/null; }
cab() { printf '%s' "$1" | grep -i "^$2:" | head -1 | tr -d '\r'; }
codigo() { $CURL -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }

API="$BASE/api/v1"

# ─────────────────────────────────────────────────────────────────────────────
titulo "TLS — $BASE"

if [ "${BASE#https://}" = "$BASE" ]; then
  FAIL 'a URL nao e https. Sem TLS o cookie de sessao sai sem Secure e o HSTS nunca e emitido.'
else
  if $CURL -o /dev/null "$API/health/live" 2>/dev/null; then
    PASS 'certificado aceito sem -k (cadeia valida, nome bate)'
  else
    FAIL 'o certificado NAO foi aceito sem -k. Um cert que so passa com -k o navegador recusa.'
  fi

  # Três desfechos em HTTP puro, e eles NÃO são equivalentes:
  #   sem ouvinte  → o mais estrito. Não existe caminho em claro para lugar
  #                  nenhum. O custo é quem digita o endereço sem esquema.
  #   redireciona  → aceitável. Nenhum byte da aplicação passa por HTTP.
  #   responde 200 → FALHA. A aplicação está servindo em claro.
  SEM_TLS="http://${BASE#https://}"
  R="$(cabecalhos "$SEM_TLS/" )"
  loc="$(cab "$R" 'location')"
  cod="$(codigo "$SEM_TLS/")"
  case "$loc:$cod" in
    *https://*) PASS 'porta 80 redireciona para https (nenhum byte da app em claro)' ;;
    :000)       PASS 'nao ha ouvinte em HTTP — nem redirect existe. E o mais estrito.' ;;
    :200)       FAIL 'a aplicacao RESPONDE em HTTP puro na porta 80. Feche ou redirecione.' ;;
    *)          FAIL "porta 80 responde $cod sem mandar para https" ;;
  esac
fi

# Os cabeçalhos de segurança são emitidos pelo nginx na raiz (SPA), não pela API.
H="$(cabecalhos "$BASE/")"
if [ -z "$H" ]; then
  NV 'o host nao respondeu em / — nenhum cabecalho pode ser medido abaixo.'
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Controle positivo — o portao esta aberto para quem deve passar?'
#
# Esta verificação vem ANTES das negativas de propósito. Se o host inteiro
# estiver recusando tudo (WAF mal configurado, app fora do ar, DNS para o lugar
# errado), todas as checagens de "sem sessao → 401" passariam por acidente, e o
# script daria APROVADO para um deploy morto.
#
# `/health/live` é público por contrato (routes.ts) e não expõe versão de
# dependência nem host de banco.
c_live="$(codigo "$API/health/live")"
case "$c_live" in
  200) PASS "$API/health/live -> 200 (a app responde; as negativas abaixo valem)" ;;
  000) FAIL "$API/health/live nao respondeu. A app pode estar fora do ar — as negativas abaixo NAO provam nada." ;;
  *)   FAIL "$API/health/live -> $c_live (esperado 200). Controle positivo falhou: o portao pode estar recusando tudo." ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Cabecalhos de seguranca'

if [ -z "$H" ]; then
  NV 'sem resposta em / — HSTS, CSP, X-Frame-Options e Permissions-Policy ficaram sem medicao.'
else
  hsts="$(cab "$H" 'strict-transport-security')"
  if [ -n "$hsts" ]; then
    PASS "HSTS: ${hsts#*: }"
  else
    FAIL 'sem Strict-Transport-Security. Sob TLS ele e obrigatorio; a ausencia costuma indicar proxy que nao repassa o esquema (trust proxy / X-Forwarded-Proto).'
  fi

  # X-Frame-Options: DENY, e não SAMEORIGIN. O VanPro não embute a si mesmo em
  # frame nenhum, e o nginx.conf já emite DENY — aceitar SAMEORIGIN aqui seria
  # afrouxar a verificação até o nível do que ela deveria pegar.
  xfo="$(cab "$H" 'x-frame-options')"
  case "$xfo" in
    *DENY*)       PASS 'X-Frame-Options: DENY' ;;
    *SAMEORIGIN*) FAIL 'X-Frame-Options: SAMEORIGIN — o contrato do VanPro e DENY. A app nao se embute em frame nenhum; SAMEORIGIN so abre superficie.' ;;
    '')           FAIL 'X-Frame-Options ausente' ;;
    *)            FAIL "X-Frame-Options inesperado: ${xfo#*: }" ;;
  esac

  for par in "x-content-type-options:nosniff" "referrer-policy:no-referrer" "cross-origin-opener-policy:same-origin"; do
    nome="${par%%:*}"; esperado="${par#*:}"
    v="$(cab "$H" "$nome")"
    case "$v" in
      *"$esperado"*) PASS "$nome: ${v#*: }" ;;
      '')            FAIL "$nome ausente" ;;
      *)             FAIL "$nome inesperado: ${v#*: } (esperado conter '$esperado')" ;;
    esac
  done

  pp="$(cab "$H" 'permissions-policy')"
  if [ -z "$pp" ]; then
    FAIL 'Permissions-Policy ausente. E o cabecalho que nega camera, microfone, geolocalizacao e pagamento a uma app que nao usa nenhum deles.'
  else
    faltando=''
    for recurso in camera microphone geolocation payment; do
      case "$pp" in
        *"$recurso=()"*) : ;;
        *) faltando="$faltando $recurso" ;;
      esac
    done
    if [ -z "$faltando" ]; then
      PASS 'Permissions-Policy nega camera, microfone, geolocalizacao e pagamento'
    else
      FAIL "Permissions-Policy nao nega:$faltando"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo 'CSP — a politica precisa APLICAR, nao so existir'

csp="$(cab "$H" 'content-security-policy')"
if [ -z "$csp" ]; then
  if [ -z "$H" ]; then
    NV 'sem resposta em / — a CSP nao pode ser medida.'
  else
    FAIL 'sem Content-Security-Policy'
  fi
else
  script="$(printf '%s' "$csp" | tr ';' '\n' | grep -i 'script-src' | sed 's/^ *//')"
  if [ -z "$script" ]; then
    FAIL "CSP presente mas sem script-src — o default-src pode estar cobrindo, confira manualmente: $csp"
  else
    # `unsafe-inline` em script-src desliga a proteção contra XSS refletido.
    # style-src com unsafe-inline é aceito neste projeto (o React aplica estilo
    # em atributo) e por isso a checagem é feita só sobre script-src.
    case "$script" in
      *"'unsafe-inline'"*) FAIL "script-src leva 'unsafe-inline' — a protecao de XSS esta desligada: $script" ;;
      *)                   PASS "script-src sem 'unsafe-inline'" ;;
    esac
    case "$script" in
      *"'unsafe-eval'"*) FAIL "script-src leva 'unsafe-eval' — qualquer injecao de string vira execucao de codigo." ;;
      *)                 PASS "script-src sem 'unsafe-eval'" ;;
    esac
  fi

  case "$csp" in
    *"object-src 'none'"*) PASS "object-src 'none'" ;;
    *)                     FAIL "object-src nao esta em 'none'" ;;
  esac
  case "$csp" in
    *"frame-ancestors 'none'"*) PASS "frame-ancestors 'none' (clickjacking)" ;;
    *"frame-ancestors"*)        FAIL "frame-ancestors presente mas nao e 'none' — o contrato do VanPro e negar embutimento." ;;
    *)                          FAIL 'frame-ancestors ausente' ;;
  esac
  case "$csp" in
    *"base-uri 'none'"*) PASS "base-uri 'none'" ;;
    *)                   FAIL "base-uri nao esta em 'none' — sem isso um <base> injetado reescreve todo caminho relativo." ;;
  esac
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Fail-closed — sem sessao nao se le dado de crianca'

for rota in /students /vehicles /financial/dre /company/team; do
  c="$(codigo "$API$rota")"
  case "$c" in
    401)     PASS "$rota -> 401" ;;
    403)     PASS "$rota -> 403" ;;
    000)     NV   "$rota nao respondeu — nao deu para medir" ;;
    200)     FAIL "$rota -> 200 SEM SESSAO. Dado de aluno aberto na internet. Pare o deploy." ;;
    *)       FAIL "$rota -> $c (esperado 401/403)" ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Metricas nao vazam pela internet'
#
# `/health/metrics` deve morrer no nginx (ver web/nginx.conf). Latência por rota
# diz a um curioso exatamente que superfície existe e quanto tráfego cada parte
# recebe.
c_met="$(codigo "$API/health/metrics")"
case "$c_met" in
  404|403) PASS "/health/metrics -> $c_met (nao repassado pela borda)" ;;
  000)     NV   '/health/metrics nao respondeu — nao deu para medir' ;;
  200)     FAIL '/health/metrics -> 200 pela internet. O endpoint de metricas esta publico.' ;;
  *)       FAIL "/health/metrics -> $c_met (esperado 404)" ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Login recusa credencial invalida'

cl="$(codigo -X POST -H 'Content-Type: application/json' \
      -d '{"email":"nao-existe@invalido.local","password":"senha-errada-de-proposito"}' \
      "$API/auth/login")"
case "$cl" in
  400|401) PASS "login recusa credencial invalida ($cl)" ;;
  403)     PASS 'login recusou com 403 (provavelmente CSRF na borda — tambem e recusa)' ;;
  429)     PASS 'login ja esta limitando por tentativas (429)' ;;
  000)     NV   'a rota de login nao respondeu — nao deu para medir' ;;
  200)     FAIL 'login respondeu 200 para credencial INVALIDA. Pare o deploy.' ;;
  *)       FAIL "login respondeu $cl para credencial invalida (esperado 400/401)" ;;
esac

NV 'flags do cookie de sessao (Secure/HttpOnly/SameSite) exigem um login que FUNCIONE — rode com credencial valida para fechar esta.'

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Veredito'
printf '  %d OK · %d falha(s) · %d nao verificado(s)\n\n' "$ok" "$falhou" "$naoverificado"

if [ "$falhou" -gt 0 ]; then
  echo 'REPROVADO — ha garantia prometida que nao esta de pe.'
  exit 1
fi
if [ "$naoverificado" -gt 0 ]; then
  echo 'INCOMPLETO — nada falhou, mas nem tudo foi medido. Isso NAO e aprovacao.'
  exit 3
fi
echo 'APROVADO — todas as verificacoes foram executadas e passaram.'
exit 0
