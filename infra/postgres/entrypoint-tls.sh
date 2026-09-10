#!/bin/sh
# Prepara o material de TLS ANTES de o PostgreSQL subir.
#
# O servidor recusa a chave privada se ela nao for do usuario que roda o
# processo e se o modo nao for 0600 — e recusa com "private key file has group
# or world access", parando o boot inteiro. Num bind mount vindo do Windows
# todo arquivo aparece como root:root 0777, entao NAO existe jeito de o arquivo
# montado servir direto: e preciso copiar para dentro do container e ajustar.
#
# Copiar (em vez de afrouxar a exigencia do Postgres com `ssl_passphrase` ou
# rodar como root) mantem a trava do servidor de pe: se um dia a copia falhar,
# o banco nao sobe em claro por engano — ele nao sobe.
set -eu

ORIGEM=/certs
HBA=/etc/vanpro/pg_hba.conf
DESTINO=/var/lib/postgresql/tls

[ -f "$ORIGEM/server.crt" ] || { echo "[pg-tls] FALTA $ORIGEM/server.crt. Rode: bash infra/scripts/gerar-certificados.sh" >&2; exit 1; }
[ -f "$ORIGEM/server.key" ] || { echo "[pg-tls] FALTA $ORIGEM/server.key. Rode: bash infra/scripts/gerar-certificados.sh" >&2; exit 1; }
[ -f "$HBA" ] || { echo "[pg-tls] FALTA $HBA." >&2; exit 1; }

mkdir -p "$DESTINO"
cp "$ORIGEM/server.crt" "$ORIGEM/server.key" "$DESTINO/"
cp "$HBA" "$DESTINO/pg_hba.conf"
chown -R postgres:postgres "$DESTINO"
chmod 700 "$DESTINO"
chmod 600 "$DESTINO/server.key"
chmod 644 "$DESTINO/server.crt" "$DESTINO/pg_hba.conf"

echo "[pg-tls] material TLS pronto em $DESTINO"

exec docker-entrypoint.sh "$@"
