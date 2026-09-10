#!/usr/bin/env bash
# ─── Cifra um backup do VanPro para uma chave PÚBLICA ───────────────────────
#
#   bash infra/scripts/cifrar-backup.sh --gerar-chave ~/vanpro-backup   # UMA vez
#   bash infra/scripts/cifrar-backup.sh backups/banco-2026-….dump       # cifra
#   bash infra/scripts/cifrar-backup.sh --abrir arq.dump.enc chave.key  # abre
#
# ─── "O banco já é cifrado em repouso. Por que cifrar o dump?" ──────────────
#
# Porque o que está cifrado no banco é uma FATIA pequena do que sai no dump.
# A criptografia de campo do Prisma cobre nome, endereço e caminho da foto do
# aluno — e só. Sai em CLARO no mesmo arquivo:
#
#   • a trilha de auditoria inteira (quem fez o quê, quando, de qual IP);
#   • os valores financeiros: mensalidade, `amountCents` de cada fatura,
#     inadimplência por família — o faturamento da empresa, linha a linha;
#   • os hashes de senha de todos os usuários, prontos para ataque offline;
#   • a RELAÇÃO aluno ↔ responsável ↔ escola ↔ veículo ↔ rota, que é o dado
#     mais perigoso do conjunto: mesmo sem o nome em claro, ela diz que uma
#     criança específica é buscada em tal escola, em tal veículo, em tal
#     horário, todo dia. Padrão de deslocamento de criança é o que se usa para
#     abordar uma.
#
# É dado de criança, categoria em que a ANPD anunciou fiscalização para 2026, e
# o backup é justamente a cópia que sai da máquina protegida: vai para pendrive,
# para nuvem, para o notebook de alguém. Ele passa a viver com MENOS proteção
# que o servidor que o gerou, carregando mais coisa.
#
# ─── Por que chave PÚBLICA e não senha ──────────────────────────────────────
#
# Cifrar com senha coloca a senha na máquina que faz o backup. Quem comprometer
# o servidor leva o backup E a senha, e a cifra não protegeu de nada.
#
# Com envelope, o servidor tem só a chave PÚBLICA: consegue cifrar e não
# consegue abrir. A privada fica fora — cofre, outra máquina, papel. Servidor
# comprometido produz backups que o próprio atacante não lê. A proteção vem
# dessa assimetria, não da força do algoritmo.
#
# `openssl cms` faz o envelope de verdade: sorteia uma chave AES-256 por
# arquivo, cifra o conteúdo com ela, e cifra essa chave com a RSA do
# destinatário. Nada de derivar chave de senha, nada de reusar chave.
set -uo pipefail

erro() { printf '\n[cifra] erro: %s\n' "$1" >&2; exit 1; }

ajuda() { sed -n '2,46p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  -h|--help) ajuda; exit 0 ;;
  '')        ajuda; erro 'falta o arquivo a cifrar.' ;;
esac

command -v openssl >/dev/null 2>&1 || erro 'openssl nao encontrado no PATH. Instale o openssl antes de continuar.'

if [ "${1:-}" = '--gerar-chave' ]; then
  BASE="${2:-}"
  [ -n "$BASE" ] || erro 'uso: --gerar-chave <caminho-base> (ex.: ~/vanpro-backup)'
  [ -e "$BASE.key" ] && erro "$BASE.key ja existe — gerar por cima descartaria a chave que abre os backups existentes. Escolha outro caminho."

  # RSA-4096: a chave protege o envelope, não o conteúdo, e vive anos. O custo
  # de gerar é pago uma vez só.
  #
  # MSYS2_ARG_CONV_EXCL: no Git Bash do Windows, o MSYS reescreve qualquer
  # argumento que pareça caminho POSIX, e `-subj "/CN=..."` chega ao openssl como
  # `C:/Program Files/Git/CN=...`. A geração falha com "subject name is expected
  # to be in the format /type0=value0". Na VPS Linux a variável é ignorada.
  if ! MSYS2_ARG_CONV_EXCL='*' openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
       -keyout "$BASE.key" -out "$BASE.crt" -subj "/CN=VanPro Backup" 2>/dev/null; then
    # Sem esta limpeza, a chave meio-escrita bloquearia a proxima tentativa pela
    # guarda de "ja existe" acima — e essa guarda existe para proteger chave BOA.
    rm -f "$BASE.key" "$BASE.crt"
    erro 'openssl nao conseguiu gerar o par. Confira permissao de escrita no caminho informado e a versao do openssl.'
  fi
  chmod 600 "$BASE.key"
  chmod 644 "$BASE.crt"

  cat <<TXT

Gerado:
  $BASE.crt   PUBLICA — fica no servidor, apontada por VANPRO_BACKUP_CERT
  $BASE.key   PRIVADA — TIRE DAQUI. Sem ela nenhum backup abre.

A chave privada nao pode ficar na maquina que faz o backup: se ficar, o servidor
comprometido entrega backup e chave juntos, e a cifra vira enfeite. Guarde em
cofre, outra maquina ou papel.

E TESTE a abertura antes de confiar. Backup cifrado com chave perdida e backup
que nao existe — junto com o .env que leva a PRISMA_FIELD_ENCRYPTION_KEY, sao as
duas perdas das quais nao se volta.
TXT
  exit 0
fi

if [ "${1:-}" = '--abrir' ]; then
  ARQ="${2:-}"
  CHAVE="${3:-}"
  [ -n "$ARQ" ] || erro 'uso: --abrir <arquivo.enc> <chave.key>'
  [ -n "$CHAVE" ] || erro 'falta a chave privada. uso: --abrir <arquivo.enc> <chave.key>'
  [ -f "$ARQ" ] || erro "arquivo nao encontrado: $ARQ"
  [ -f "$CHAVE" ] || erro "chave privada nao encontrada: $CHAVE"

  SAIDA="${ARQ%.enc}"
  [ -e "$SAIDA" ] && erro "$SAIDA ja existe — nao vou sobrescrever. Mova ou renomeie o arquivo antes."

  openssl cms -decrypt -binary -inform DER -in "$ARQ" -inkey "$CHAVE" -out "$SAIDA" \
    || erro "a abertura falhou. Ou a chave nao e a que cifrou este arquivo, ou o envelope esta corrompido (o GCM detecta isso — ver o comentario sobre GCM neste arquivo)."
  printf '[cifra] aberto: %s\n' "$SAIDA"
  exit 0
fi

ARQ="$1"
CERT="${VANPRO_BACKUP_CERT:-}"
[ -n "$CERT" ] || erro 'VANPRO_BACKUP_CERT nao definido — sem chave publica nao ha o que cifrar.
Gere uma com: bash infra/scripts/cifrar-backup.sh --gerar-chave ~/vanpro-backup'
[ -f "$CERT" ] || erro "certificado nao encontrado: $CERT (valor de VANPRO_BACKUP_CERT)"
[ -f "$ARQ" ] || erro "arquivo nao encontrado: $ARQ"
[ -e "$ARQ.enc" ] && erro "$ARQ.enc ja existe — nao vou sobrescrever um envelope existente."

# AES-256-GCM cifra E autentica. Com CBC, um byte trocado no arquivo vira lixo
# que o pg_restore tenta interpretar; com GCM a ABERTURA falha, que é o que se
# quer de um backup — descobrir a corrupção na hora de abrir, não no meio de uma
# restauração de emergência às 3h da manhã.
openssl cms -encrypt -binary -aes-256-gcm -outform DER \
  -in "$ARQ" -out "$ARQ.enc" "$CERT" \
  || { rm -f "$ARQ.enc"; erro "openssl cms falhou ao cifrar. O original foi MANTIDO em $ARQ."; }

# O original só sai depois de o cifrado existir E ter tamanho. Apagar antes
# trocaria "backup em claro" por "nenhum backup".
[ -s "$ARQ.enc" ] || { rm -f "$ARQ.enc"; erro "o arquivo cifrado saiu vazio — o original foi mantido em $ARQ."; }

rm -f "$ARQ"
printf '[cifra] %s (%s bytes) — original removido\n' "$ARQ.enc" "$(wc -c < "$ARQ.enc" | tr -d ' ')"
