#!/usr/bin/env bash
# ─── O que o deploy do VanPro PROMETE, conferido contra o que ele responde ──
#
#   bash infra/scripts/verificar-deploy.sh https://vanpro.exemplo.com.br
#
# Variaveis de ambiente:
#   VANPRO_CA        arquivo de CA local. Se o certificado for recusado pela
#                    loja do sistema MAS aceito por esta ancora, o resultado e
#                    NV (nao verificado) e nao FALHA — sao duas coisas
#                    diferentes: "certificado invalido" contra "voce ainda nao
#                    instalou a CA nesta maquina". Padrao: infra/certs/ca.crt,
#                    se existir.
#   VANPRO_URL_HTTP  URL em texto claro a testar (padrao: mesmo host, porta 80).
#                    Necessario quando a stack publica o HTTPS fora da 443.
#   VANPRO_LOGIN     e VANPRO_SENHA: credencial VALIDA. Com elas, as flags do
#                    cookie de sessao passam de NV para medicao de verdade.
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

ajuda() { sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//'; }

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

# Ancora local, se houver. Ela NAO entra no `$CURL` padrao: o teste principal
# tem de continuar sendo "o navegador de um estranho aceita este certificado?".
# Ela serve so para separar os dois desfechos de uma recusa.
CA_LOCAL="${VANPRO_CA:-}"
if [ -z "$CA_LOCAL" ]; then
  _padrao="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)/infra/certs/ca.crt"
  [ -f "$_padrao" ] && CA_LOCAL="$_padrao"
fi

# Windows: o curl do sistema usa Schannel, que consulta CRL/OCSP e trata
# "revogacao desconhecida" como falha. Certificado de CA local nao publica CRL
# nenhuma, entao ele reprova ali por um motivo que nao e o certificado. O
# afrouxamento fica preso ao ramo de DIAGNOSTICO (o que so produz NV) — a
# verificacao principal, a que decide PASS ou FAIL, continua sendo a loja de
# CAs do sistema, sem nenhuma opcao extra.
CURL_REVOGACAO=''
case "$($CURL --version 2>/dev/null | head -1)" in
  *Schannel*) CURL_REVOGACAO='--ssl-revoke-best-effort' ;;
esac

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
    PASS 'certificado aceito sem -k pela loja de CAs do sistema (cadeia valida, nome bate)'
  elif [ -n "$CA_LOCAL" ] && $CURL --cacert "$CA_LOCAL" $CURL_REVOGACAO -o /dev/null "$API/health/live" 2>/dev/null; then
    # Dois desfechos MUITO diferentes, e reprovar os dois igual e o que faz uma
    # equipe passar a rodar tudo com -k:
    #   cert invalido        -> a garantia nao existe. FALHA.
    #   CA local nao instalada -> a garantia existe e ESTA MAQUINA ainda nao a
    #                            conhece. Nao da para afirmar o que o navegador
    #                            de um terceiro faria: e NAO VERIFICADO.
    NV "certificado assinado pela CA local ($CA_LOCAL) e valido, mas esta maquina nao a reconhece pela loja do sistema. Instale a ancora (veja gerar-certificados.sh) e rode de novo — ate la nao da para afirmar o que o navegador de um terceiro faz."

    # A partir daqui o resto das checagens passa a usar a ancora local.
    #
    # Sem isto, UMA pendencia de confianca cega as outras onze verificacoes —
    # HSTS, CSP, fail-closed, metricas, login — e o relatorio sai com "nao deu
    # para medir" em tudo, o que e pior que inutil: some a diferenca entre um
    # deploy sem CSP e um deploy cuja CA voce ainda nao instalou. A ressalva ja
    # esta registrada como NV logo acima e continua valendo no veredito.
    CURL="$CURL --cacert $CA_LOCAL $CURL_REVOGACAO"
    printf '        (as verificacoes abaixo seguem com a ancora local; a ressalva acima continua valendo)
'
  else
    FAIL 'o certificado NAO foi aceito sem -k, nem pela CA local. Um cert que so passa com -k o navegador recusa.'
  fi

  # Três desfechos em HTTP puro, e eles NÃO são equivalentes:
  #   sem ouvinte  → o mais estrito. Não existe caminho em claro para lugar
  #                  nenhum. O custo é quem digita o endereço sem esquema.
  #   redireciona  → aceitável. Nenhum byte da aplicação passa por HTTP.
  #   responde 200 → FALHA. A aplicação está servindo em claro.
  # A URL em claro nao e "a mesma trocando o esquema": se o HTTPS esta publicado
  # numa porta que nao e a 443, `http://host:8443` bate na porta TLS e o nginx
  # responde 400 ("plain HTTP request sent to HTTPS port") — que seria contado
  # como falha sem ter nada a ver com a aplicacao servir em claro. Por isso o
  # host vem sem porta, e quem publica em porta diferente informa VANPRO_URL_HTTP.
  _hostport="${BASE#https://}"
  SEM_TLS="${VANPRO_URL_HTTP:-http://${_hostport%%:*}}"
  SEM_TLS="${SEM_TLS%/}"
  R="$(cabecalhos "$SEM_TLS/" )"
  loc="$(cab "$R" 'location')"
  cod="$(codigo "$SEM_TLS/")"
  case "$loc:$cod" in
    *https://*) PASS 'porta 80 redireciona para https (nenhum byte da app em claro)' ;;
    :000)       PASS 'nao ha ouvinte em HTTP — nem redirect existe. E o mais estrito.' ;;
    :200)       FAIL "a aplicacao RESPONDE em HTTP puro em $SEM_TLS. Feche ou redirecione." ;;
    *)          FAIL "$SEM_TLS responde $cod sem mandar para https" ;;
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

# ─────────────────────────────────────────────────────────────────────────────
titulo 'Flags do cookie de sessao'
#
# So da para medir com um login que FUNCIONE: o cookie de sessao nao existe numa
# resposta de credencial invalida. Sem credencial, isto e NAO VERIFICADO — e nao
# "provavelmente esta certo".
if [ -z "${VANPRO_LOGIN:-}" ] || [ -z "${VANPRO_SENHA:-}" ]; then
  NV 'flags do cookie de sessao (Secure/HttpOnly/SameSite) exigem um login que FUNCIONE. Rode com VANPRO_LOGIN=... VANPRO_SENHA=... para fechar esta.'
else
  CORPO="$(printf '{"email":"%s","password":"%s"}' "$VANPRO_LOGIN" "$VANPRO_SENHA")"
  RESP="$($CURL -o /dev/null -D - -X POST -H 'Content-Type: application/json' -d "$CORPO" "$API/auth/login" 2>/dev/null)"
  COOKIES="$(printf '%s' "$RESP" | grep -i '^set-cookie:' | sed 's/\r$//')"
  COD_OK="$(printf '%s' "$RESP" | head -1 | awk '{print $2}')"

  if [ -z "$COOKIES" ]; then
    NV "o login com a credencial informada nao devolveu Set-Cookie (HTTP ${COD_OK:-?}). Confira usuario e senha — sem cookie nao ha o que medir."
  else
    # Uma linha por cookie, e a verificacao e sobre TODAS: basta um cookie de
    # sessao sem HttpOnly para o XSS ler a sessao inteira. Verificar so o
    # primeiro Set-Cookie e o erro que faz a checagem passar num deploy em que
    # o refresh token esta exposto.
    ruins=''
    while IFS= read -r linha; do
      [ -n "$linha" ] || continue
      nome="$(printf '%s' "$linha" | sed 's/^[Ss]et-[Cc]ookie: *//; s/=.*//')"
      falta=''
      # O cookie de CSRF e a UNICA excecao a HttpOnly, e ela e por desenho:
      # no padrao de duplo envio o front PRECISA ler o valor para repetir no
      # cabecalho — um site de terceiro consegue disparar a requisicao com o
      # cookie anexado, mas nao consegue le-lo. Exigir HttpOnly aqui reprovaria
      # a defesa de CSRF por implementar CSRF. `Secure` e `SameSite` continuam
      # obrigatorios nele.
      case "$nome" in
        *csrf*|*CSRF*|*xsrf*|*XSRF*) : ;;
        *) printf '%s' "$linha" | grep -qi 'httponly' || falta="$falta HttpOnly" ;;
      esac
      printf '%s' "$linha" | grep -qi 'secure'   || falta="$falta Secure"
      printf '%s' "$linha" | grep -qi 'samesite=\(strict\|lax\)' || falta="$falta SameSite"
      [ -n "$falta" ] && ruins="$ruins $nome($falta )"
    done <<EOF
$COOKIES
EOF

    if [ -z "$ruins" ]; then
      PASS "cookie(s) de sessao com HttpOnly, Secure e SameSite"
    else
      FAIL "cookie de sessao sem as flags exigidas:$ruins — XSS le cookie sem HttpOnly, e cookie sem Secure viaja em claro."
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo 'O que esta REALMENTE no ar'

# Por que este bloco existe.
#
# Depois de um commit de correcao, medi a defesa contra Redis lento e ela falhou
# exatamente como antes — porque o contentor no ar rodava um `dist/` de tres
# horas atras. O codigo estava certo no disco e errado na maquina. Sem esta
# verificacao, o proximo relatorio diria "corrigido" sobre um artefato que nao
# contem a correcao, e ninguem teria como saber.
#
# O carimbo ja existia (`/interno/version`, gravado no build). Faltava alguem
# conferir.
#
# `/interno` nao e exposto pelo nginx de proposito (rede interna), entao aqui
# so da para conferir de dentro: se a sonda nao responder, isto e NAO VERIFICADO
# e nao aprovacao.
SHA_LOCAL="$(git rev-parse --short HEAD 2>/dev/null || echo desconhecido)"
VERSAO_NO_AR="$($CURL "$BASE/api/v1/interno/version" 2>/dev/null || true)"

# `/interno` e NEGADO no nginx de proposito — o carimbo fica na rede interna.
# Resposta que nao e o JSON esperado significa "nao deu para medir daqui", e
# nao "o artefato esta errado". Confundir as duas coisas transformaria uma
# defesa (a rota nao vazar para fora) em reprovacao do deploy.
case "$VERSAO_NO_AR" in
  *'"gitSha"'*) medivel=sim ;;
  *)            medivel=nao ;;
esac

if [ "$medivel" = nao ]; then
  NV "carimbo de versao nao alcancavel por $BASE — esperado: /interno e negado na borda.
      De dentro do host:
        docker exec vanpro-api wget -qO- localhost:3000/api/v1/interno/version
      Compare o gitSha com o commit implantado. Sem isso NAO da para afirmar que
      o artefato no ar contem o codigo que voce acabou de revisar."
elif [ "$SHA_LOCAL" = desconhecido ]; then
  NV "sem git nesta maquina — nao da para comparar o carimbo com o commit."
elif printf '%s' "$VERSAO_NO_AR" | grep -q "$SHA_LOCAL"; then
  PASS "artefato no ar carrega o commit atual ($SHA_LOCAL)"
else
  FAIL "o artefato no ar NAO e o commit atual ($SHA_LOCAL). Resposta: $(printf '%s' "$VERSAO_NO_AR" | head -c 200)
      Reconstrua antes de medir qualquer coisa: docker compose up -d --build api web"
fi


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
