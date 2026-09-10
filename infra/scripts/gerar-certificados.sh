#!/usr/bin/env bash
# ─── Certificados da stack de producao simulada ─────────────────────────────
#
#   bash infra/scripts/gerar-certificados.sh
#   bash infra/scripts/gerar-certificados.sh --forcar        # regera tudo
#   bash infra/scripts/gerar-certificados.sh --host outro.test
#
# Gera, em infra/certs/ (fora do git):
#   ca.crt / ca.key          autoridade local, valida 10 anos
#   web/server.crt|key       o que o nginx apresenta ao navegador
#   db/server.crt|key        o que o PostgreSQL apresenta a API
#   db/ca.crt                copia da CA, para o `sslrootcert` do cliente
#
# ─── Por que UMA CA e nao certificado auto-assinado por servico ─────────────
#
# Auto-assinado obriga cada cliente a confiar em cada folha, uma a uma, e o
# atalho que todo mundo toma quando isso da trabalho e desligar a verificacao
# (`-k`, `sslaccept=accept_invalid_certs`, `rejectUnauthorized: false`). Ai a
# conexao continua cifrada e deixa de ser autenticada: qualquer coisa no
# caminho pode se passar pelo banco. Com uma CA local, instala-se UMA ancora e
# a verificacao continua ESTRITA em todo lugar — que e o ponto.
#
# ─── mkcert, se existir ────────────────────────────────────────────────────
#
# Se o `mkcert` estiver no PATH, ele e usado para a CA do WEB: alem de gerar,
# ele INSTALA a ancora no armazenamento do sistema e do navegador, e ai o
# cadeado fica verde sem passo manual. O certificado do BANCO continua vindo do
# openssl — o cliente do Postgres nao consulta o armazenamento do sistema, ele
# quer o arquivo de CA apontado por `sslrootcert`.
set -uo pipefail

# ─── Nada de `-subj` neste script ──────────────────────────────────────────
#
# `-subj "/C=BR/O=VanPro/CN=..."` PARECE um caminho unix, e o Git Bash reescreve
# argumento que parece caminho: o DN chega ao openssl com "C:/Program Files/Git"
# grudado na frente, e a mensagem fala de formato de nome — nunca de conversao.
# Desligar a conversao global (MSYS_NO_PATHCONV) troca um defeito por outro,
# porque ai os caminhos de SAIDA deixam de ser convertidos e o openssl nao
# consegue mais gravar. A saida limpa e descrever o DN num arquivo de
# configuracao, que nao tem argumento parecido com caminho nenhum.

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
CERTS="$RAIZ/infra/certs"

HOST_WEB="vanpro.localhost"
FORCAR=0

erro() { printf '[certs] erro: %s\n' "$*" >&2; exit 1; }
info() { printf '[certs] %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host)   HOST_WEB="${2:?--host precisa de um nome}"; shift ;;
    --forcar) FORCAR=1 ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) erro "opcao desconhecida: $1" ;;
  esac
  shift
done

command -v openssl >/dev/null 2>&1 || erro "openssl nao encontrado no PATH."

mkdir -p "$CERTS/web" "$CERTS/db" || erro "nao consegui criar $CERTS"

if [ "$FORCAR" -eq 1 ]; then
  rm -f "$CERTS"/ca.crt "$CERTS"/ca.key "$CERTS"/web/* "$CERTS"/db/*
fi

# ─── CA ─────────────────────────────────────────────────────────────────────
if [ ! -f "$CERTS/ca.key" ] || [ ! -f "$CERTS/ca.crt" ]; then
  info "gerando autoridade local (VanPro Local CA)…"
  cat > "$CERTS/ca.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
C  = BR
O  = VanPro
OU = Producao Simulada
CN = VanPro Local CA

[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
CNF
  if ! openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes       -config "$CERTS/ca.cnf" -keyout "$CERTS/ca.key" -out "$CERTS/ca.crt"       2>"$CERTS/.openssl.log"; then
    cat "$CERTS/.openssl.log" >&2
    erro "falhei ao gerar a CA."
  fi
  rm -f "$CERTS/ca.cnf"
else
  info "CA ja existe — reaproveitando (use --forcar para regerar)."
fi

# Emite uma folha assinada pela CA.
#   $1 diretorio de saida   $2 CN   $3 lista de SAN
emitir() {
  local dir="$1" cn="$2" san="$3"
  if [ -f "$dir/server.crt" ] && [ -f "$dir/server.key" ]; then
    info "$(basename "$dir")/server.crt ja existe — reaproveitando."
    return 0
  fi
  info "emitindo certificado para $cn ($san)…"

  # `extendedKeyUsage=serverAuth` nao e detalhe: cliente moderno recusa folha
  # sem ele, e a mensagem ("unsupported certificate purpose") nao sugere nada.
  cat > "$dir/leaf.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no

[dn]
C  = BR
O  = VanPro
CN = $cn

[v3]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $san
CNF

  if ! openssl req -newkey rsa:2048 -sha256 -nodes -config "$dir/leaf.cnf"       -keyout "$dir/server.key" -out "$dir/server.csr" 2>"$CERTS/.openssl.log"; then
    cat "$CERTS/.openssl.log" >&2
    return 1
  fi

  if ! openssl x509 -req -in "$dir/server.csr" -CA "$CERTS/ca.crt" -CAkey "$CERTS/ca.key"       -CAcreateserial -out "$dir/server.crt" -days 825 -sha256       -extfile "$dir/leaf.cnf" -extensions v3 2>"$CERTS/.openssl.log"; then
    cat "$CERTS/.openssl.log" >&2
    return 1
  fi

  rm -f "$dir/server.csr" "$dir/leaf.cnf"
  chmod 600 "$dir/server.key" 2>/dev/null || true
  return 0
}

# ─── Folha do WEB ───────────────────────────────────────────────────────────
# `localhost` e `127.0.0.1` entram junto: quem digita o endereco curto tambem
# tem de chegar sem aviso de certificado, senao a pessoa aprende a clicar em
# "prosseguir mesmo assim" — e ai o aviso perde a funcao para sempre.
emitir "$CERTS/web" "$HOST_WEB" "DNS:$HOST_WEB,DNS:localhost,DNS:web,IP:127.0.0.1" \
  || erro "falhei ao emitir o certificado do web."

# ─── Folha do BANCO ─────────────────────────────────────────────────────────
# `postgres` e o nome do servico na rede do compose (o que a API usa) e
# `localhost` e como o host alcanca a porta publicada (o que pg_dump e a suite
# usam). Faltando um dos dois, `verify-full` recusa — e a mensagem fala de
# "hostname mismatch" sem dizer qual nome faltou.
emitir "$CERTS/db" "postgres" "DNS:postgres,DNS:vanpro-postgres,DNS:localhost,IP:127.0.0.1" \
  || erro "falhei ao emitir o certificado do banco."

rm -f "$CERTS/.openssl.log"
cp -f "$CERTS/ca.crt" "$CERTS/db/ca.crt"

# ─── Instalar a ancora, se der ──────────────────────────────────────────────
if command -v mkcert >/dev/null 2>&1; then
  info "mkcert encontrado — instalando a ancora no armazenamento do sistema…"
  mkcert -install >/dev/null 2>&1 && info "ancora do mkcert instalada." \
    || info "mkcert -install falhou (precisa de privilegio). Siga o passo manual abaixo."
fi

cat <<TXT

[certs] pronto. Arquivos em infra/certs/ (ignorados pelo git).

Para o navegador e o curl aceitarem SEM aviso, instale a CA UMA vez:

  Windows (PowerShell como Administrador):
    Import-Certificate -FilePath "$CERTS/ca.crt" \\
      -CertStoreLocation Cert:\\LocalMachine\\Root

  Linux (Debian/Ubuntu):
    sudo cp "$CERTS/ca.crt" /usr/local/share/ca-certificates/vanpro-local-ca.crt
    sudo update-ca-certificates

  macOS:
    sudo security add-trusted-cert -d -r trustRoot \\
      -k /Library/Keychains/System.keychain "$CERTS/ca.crt"

  Firefox tem armazenamento proprio: Configuracoes -> Certificados ->
  Ver certificados -> Autoridades -> Importar -> marcar "sites".

Enquanto a CA nao estiver instalada, o verificar-deploy.sh reporta a checagem de
certificado como NAO VERIFICADO (e nao como falha) se voce apontar a ancora:

  VANPRO_CA=infra/certs/ca.crt bash infra/scripts/verificar-deploy.sh <url>

TXT
