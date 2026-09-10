#!/usr/bin/env bash
# ─── Backup do VanPro — o que se prova por restauração ──────────────────────
#
#   bash infra/scripts/backup.sh                      # dump + uploads + config
#   bash infra/scripts/backup.sh --verificar          # + restaura e confere
#   bash infra/scripts/backup.sh --destino /mnt/bk    # onde gravar
#
# Gera, em <destino>/:
#   • banco-<carimbo>.dump      pg_dump --format=custom do banco `vanpro`
#   • uploads-<carimbo>.tgz     conteúdo do volume `uploads` (fotos de aluno)
#   • config-<carimbo>.tgz      .env da raiz + docker-compose.yml
#                               (modo 600 — CONTÉM SEGREDO)
#
# ─── São TRÊS peças, e faltando uma não se reconstrói produção ──────────────
#
#   1. O DUMP        traz o dado.
#   2. O VOLUME      traz as fotos dos alunos, que não estão no banco.
#   3. A CONFIG      traz o `.env` da raiz, que NÃO é versionado.
#
# A terceira é a que costuma faltar, e é a que dói mais. O `.env` guarda
# `PRISMA_FIELD_ENCRYPTION_KEY`, e essa chave é a única coisa que abre os campos
# cifrados em repouso do banco: nome, endereço e foto do aluno saem do dump como
# `v1.aesgcm256.…` e assim ficam PARA SEMPRE se a chave se perder. Não existe
# recuperação, não existe suporte que resolva — o dump vira um arquivo de texto
# ilegível com o tamanho certo. Perder o `.env` é perder o backup inteiro, mesmo
# com o dump intacto na mão.
#
# `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` também estão lá: restaurar com
# segredos novos apenas desloga todo mundo, o que é aceitável. A chave de campo
# não tem esse consolo.
#
# ─── Por que este script não confia no próprio código de saída ──────────────
#
# `pg_dump` sai 0 e produz arquivo em situações em que não há backup nenhum:
# banco errado, schema vazio, permissão parcial. Um cron chamando um script
# assim reporta sucesso toda noite sem copiar um byte útil. Aqui, dump com zero
# tabelas é APAGADO e o script sai != 0 — ausência de sinal não vira aprovação.
#
# Para agendar no servidor, 3h da manhã:
#   0 3 * * * cd /opt/vanpro && bash infra/scripts/backup.sh --verificar \
#       --destino /var/backups/vanpro >> /var/log/vanpro-backup.log 2>&1
#
# Opções:
#   --destino DIR   onde gravar (padrão: ./backups)
#   --reter N       quantos jogos manter (padrão 14)
#   --url URL       DATABASE_URL explícita (padrão: a do ambiente/.env)
#   --uploads DIR   diretório de uploads a empacotar (padrão: ./storage/uploads)
#   --config DIR    onde estão .env e docker-compose.yml (padrão: raiz do repo)
#   --so-banco      não empacota uploads nem config
#   --sem-config    não empacota a config (que contém segredo)
#   --verificar     RESTAURA o dump num banco descartável e confere. É o único
#                   passo que separa "backup" de "arquivo"
#   --help          esta ajuda
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"

DESTINO="${VANPRO_DIR_BACKUPS:-$RAIZ/backups}"
DIR_UPLOADS="${VANPRO_UPLOADS_DIR:-$RAIZ/storage/uploads}"
DIR_CONFIG="$RAIZ"
RETER=14
SO_BANCO=0
SEM_CONFIG=0
VERIFICAR=0
URL=""

erro() { printf '[backup] erro: %s\n' "$*" >&2; exit 1; }
aviso() { printf '[backup] AVISO: %s\n' "$*" >&2; }
info() { printf '[backup] %s\n' "$*"; }

ajuda() { sed -n '2,52p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --destino)    DESTINO="${2:?--destino precisa de um caminho}"; shift ;;
    --reter)      RETER="${2:?--reter precisa de um numero}"; shift ;;
    --url)        URL="${2:?--url precisa de uma DATABASE_URL}"; shift ;;
    --uploads)    DIR_UPLOADS="${2:?--uploads precisa de um caminho}"; shift ;;
    --config)     DIR_CONFIG="${2:?--config precisa de um caminho}"; shift ;;
    --so-banco)   SO_BANCO=1 ;;
    --sem-config) SEM_CONFIG=1 ;;
    --verificar)  VERIFICAR=1 ;;
    -h|--help)    ajuda; exit 0 ;;
    *)            erro "opcao desconhecida: $1 — rode com --help" ;;
  esac
  shift
done

case "$RETER" in
  ''|*[!0-9]*) erro "--reter espera um numero inteiro, recebeu '$RETER'" ;;
esac

# O .env da raiz, se houver, sem sobrescrever o que já veio do ambiente.
if [ -z "$URL" ] && [ -f "$RAIZ/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$RAIZ/.env"
  set +a
fi
URL="${URL:-${DATABASE_URL:-}}"

[ -n "$URL" ] || erro "sem DATABASE_URL. Passe --url ou defina no ambiente/.env da raiz."
command -v pg_dump >/dev/null 2>&1 || erro "pg_dump nao encontrado no PATH. Instale o cliente do PostgreSQL 16 (postgresql-client-16)."
command -v pg_restore >/dev/null 2>&1 || erro "pg_restore nao encontrado no PATH. Instale o cliente do PostgreSQL 16."
if [ "$VERIFICAR" -eq 1 ]; then
  command -v psql >/dev/null 2>&1 || erro "psql nao encontrado no PATH, e --verificar precisa dele para criar o banco descartavel."
fi

mkdir -p "$DESTINO" || erro "nao consegui criar $DESTINO"
CARIMBO="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARQ_BANCO="$DESTINO/banco-$CARIMBO.dump"

# ─── 1ª peça: o dump ────────────────────────────────────────────────────────
# Um pg_dump mais antigo que o servidor recusa com "server version mismatch" e
# o backup simplesmente não acontece — por isso a falha aqui é fatal, não aviso.
info "banco -> $ARQ_BANCO"
# `--dbname=` e nao a URL como argumento POSICIONAL.
#
# `pg_dump "$URL" --format=custom ...` e a forma que aparece em todo tutorial e
# que o pg_dump 16 do Windows recusa com "too many command-line arguments
# (first is --format=custom)" — uma mensagem que acusa a opcao seguinte e nao
# diz nada sobre posicao. Na forma nomeada nao ha ambiguidade em build nenhum.
if ! pg_dump --dbname="$URL" --format=custom --no-owner --no-acl --file "$ARQ_BANCO"; then
  rm -f "$ARQ_BANCO"
  erro "pg_dump falhou. Confira a DATABASE_URL e se a versao do cliente alcanca a do servidor (PostgreSQL 16)."
fi

# O índice do dump prova que existem objetos; contar o que tem DADO separa "o
# comando rodou" de "o backup existe".
LISTA="$(pg_restore --list "$ARQ_BANCO" 2>/dev/null || true)"
N_TABELAS="$(printf '%s\n' "$LISTA" | grep -c 'TABLE DATA' || true)"
info "indice do dump: $N_TABELAS tabela(s) com dado"

if [ "${N_TABELAS:-0}" -eq 0 ]; then
  rm -f "$ARQ_BANCO"
  erro "dump sem NENHUMA tabela com dado — apagado. Isto nao e backup. Confira se a DATABASE_URL aponta para o banco 'vanpro' e nao para um banco vazio."
fi
info "tamanho: $(wc -c < "$ARQ_BANCO" | tr -d ' ') bytes"

# ─── 2ª peça: o volume de uploads ───────────────────────────────────────────
# A foto do aluno vive no volume `uploads`, não no banco. Restaurar só o dump
# devolve o cadastro sem rosto, e não há como regenerar isso.
if [ "$SO_BANCO" -eq 0 ]; then
  if [ -d "$DIR_UPLOADS" ]; then
    ARQ_UPLOADS="$DESTINO/uploads-$CARIMBO.tgz"
    info "uploads ($DIR_UPLOADS) -> $ARQ_UPLOADS"
    if tar -czf "$ARQ_UPLOADS" -C "$(dirname "$DIR_UPLOADS")" "$(basename "$DIR_UPLOADS")"; then
      info "tamanho: $(wc -c < "$ARQ_UPLOADS" | tr -d ' ') bytes"
    else
      rm -f "$ARQ_UPLOADS"
      erro "falhei ao empacotar $DIR_UPLOADS. Sem as fotos o backup esta incompleto — resolva antes de confiar neste jogo."
    fi
  else
    # O volume do compose é nomeado; num host ele mora em
    # /var/lib/docker/volumes/vanpro_uploads/_data. Passar --uploads apontando
    # para lá é o caminho normal em servidor.
    aviso "$DIR_UPLOADS nao existe — as FOTOS DOS ALUNOS ficaram de fora deste backup. Use --uploads <dir> (no host, /var/lib/docker/volumes/vanpro_uploads/_data)."
  fi
fi

# ─── Verificação por RESTAURAÇÃO ────────────────────────────────────────────
#
# `pg_restore --list` prova que o índice tem objetos; não prova que o dump
# restaura. Um arquivo truncado no meio lista o índice inteiro (ele vem no
# começo do arquivo) e falha na metade dos dados.
#
# Um dump que nunca foi restaurado não é backup, é uma hipótese. O custo é um
# CREATE DATABASE temporário; o benefício é a diferença entre achar que se tem
# backup e ter. É o que o gate BACKUP_RECOVERY pede.
#
# O banco descartável cai SEMPRE, inclusive se a restauração explodir no meio —
# por isso o trap, e não um `dropdb` no fim do bloco.
if [ "$VERIFICAR" -eq 1 ]; then
  BK_NOME="vanpro_verifica_$(date -u +%s)"
  # Mesma URL, trocando só o nome do banco (preservando query string).
  URL_BK="$(printf '%s' "$URL" | sed "s|/[^/?]*\(?.*\)\{0,1\}$|/$BK_NOME\1|")"

  limpar_bk() {
    psql --dbname="$URL" -tAc "DROP DATABASE IF EXISTS \"$BK_NOME\";" >/dev/null 2>&1 || true
  }
  trap limpar_bk EXIT

  info "verificando por restauracao em $BK_NOME…"
  if ! psql --dbname="$URL" -tAc "CREATE DATABASE \"$BK_NOME\";" >/dev/null 2>&1; then
    erro "nao consegui criar o banco de verificacao $BK_NOME. O usuario da DATABASE_URL precisa de CREATEDB, ou rode a verificacao a partir de um host que tenha."
  fi

  if ! pg_restore --no-owner --no-acl --dbname="$URL_BK" "$ARQ_BANCO" >/dev/null 2>&1; then
    # pg_restore emite aviso sobre objeto ausente mesmo em restauração boa
    # (extensões, roles). O que decide é a contagem abaixo, não o status.
    info "pg_restore devolveu avisos — quem decide e a contagem, nao o status"
  fi

  N_TAB_BK="$(psql --dbname="$URL_BK" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')"
  info "restaurado: ${N_TAB_BK:-0} tabela(s) em public"

  if [ "${N_TAB_BK:-0}" -eq 0 ]; then
    rm -f "$ARQ_BANCO"
    erro "o dump NAO restaura: zero tabelas em public no banco de verificacao. Dump apagado. Investigue a DATABASE_URL e o espaco em disco antes de rodar de novo."
  fi

  # As três tabelas que definem o produto. Zero linhas nelas não é
  # necessariamente falha (base recém-criada), mas é fato que o operador tem de
  # ver — e é o que pega o dump feito contra o banco de teste por engano.
  for tabela in Company Student Invoice; do
    N="$(psql --dbname="$URL_BK" -tAc "SELECT count(*) FROM public.\"$tabela\";" 2>/dev/null | tr -d ' ')"
    if [ -z "$N" ]; then
      aviso "tabela \"$tabela\" ausente no dump restaurado — o schema nao e o do VanPro. NAO trate este arquivo como backup de producao."
    else
      info "  $tabela: $N linha(s)"
    fi
  done

  limpar_bk
  trap - EXIT
  info "verificacao OK — o dump restaura"
fi

# ─── Cifra: DEPOIS de verificar, nunca antes ────────────────────────────────
#
# A ordem importa e já custou caro no projeto irmão: com a cifra antes, o
# `--verificar` chamava `pg_restore` sobre o envelope CMS e ou o backup
# "falhava" toda noite, ou o operador tirava o `--verificar` — voltando ao dump
# nunca restaurado, que é justamente o estado que a verificação existe para
# acabar. Não se sela um arquivo que ainda não se provou bom.
if [ -n "${VANPRO_BACKUP_CERT:-}" ]; then
  if ! bash "$AQUI/cifrar-backup.sh" "$ARQ_BANCO"; then
    erro "a cifra falhou. O dump em claro foi MANTIDO em $ARQ_BANCO — trate-o como material sensivel e cifre antes de tirar da maquina."
  fi
  ARQ_BANCO="$ARQ_BANCO.enc"
else
  # Falhar aqui trocaria "backup em claro" por "nenhum backup", que é pior.
  # Mas silêncio faria o operador achar que está cifrado.
  aviso "dump gravado EM CLARO. Defina VANPRO_BACKUP_CERT para cifrar."
  aviso "        gere a chave com: bash infra/scripts/cifrar-backup.sh --gerar-chave ~/vanpro-backup"
fi

# ─── 3ª peça: a config não versionada ───────────────────────────────────────
if [ "$SO_BANCO" -eq 0 ] && [ "$SEM_CONFIG" -eq 0 ]; then
  PECAS=()
  for f in .env docker-compose.yml; do
    [ -f "$DIR_CONFIG/$f" ] && PECAS+=("$f")
  done

  if [ ${#PECAS[@]} -eq 0 ]; then
    aviso "nenhum arquivo de config em $DIR_CONFIG — use --config DIR. Sem o .env, a PRISMA_FIELD_ENCRYPTION_KEY nao esta no backup e os campos cifrados sao IRRECUPERAVEIS."
  else
    ARQ_CONFIG="$DESTINO/config-$CARIMBO.tgz"
    info "config (${PECAS[*]}) -> $ARQ_CONFIG"
    if tar -czf "$ARQ_CONFIG" -C "$DIR_CONFIG" "${PECAS[@]}"; then
      # Modo restritivo imediatamente: o arquivo tem os segredos de JWT e a
      # chave de criptografia de campo.
      chmod 600 "$ARQ_CONFIG"
      info "tamanho: $(wc -c < "$ARQ_CONFIG" | tr -d ' ') bytes (modo 600 — contem segredo)"
    else
      rm -f "$ARQ_CONFIG"
      erro "falhei ao empacotar a config de $DIR_CONFIG."
    fi

    if [ ! -f "$DIR_CONFIG/.env" ]; then
      aviso ".env AUSENTE no pacote de config. Sem PRISMA_FIELD_ENCRYPTION_KEY, nome/endereco/foto dos alunos ficam ilegiveis para sempre, mesmo com o dump perfeito."
    fi
  fi
fi

# ─── Retenção que conta o que considerou ────────────────────────────────────
#
# No projeto irmão a poda por glob deixou de casar quando a cifra entrou
# (`banco-*.dump` não casa `banco-*.dump.enc`), a função saiu 0, e a retenção
# sumiu em silêncio por semanas — até o disco encher. Zero candidatos num
# diretório que TEM arquivos é um sinal, não uma não-notícia.
podar() {
  local padrao="$1"
  local candidatos sobrando n
  # `$DESTINO` entre aspas e `$padrao` fora: o diretório pode ter espaço no
  # caminho e o padrão PRECISA expandir como glob. Deixar os dois soltos fazia a
  # poda achar zero candidatos num diretório cheio — e sair 0, que é exatamente
  # a falha silenciosa que este bloco existe para acabar.
  # shellcheck disable=SC2086
  candidatos="$(ls -1t "$DESTINO"/$padrao 2>/dev/null || true)"
  n="$(printf '%s' "$candidatos" | grep -c . || true)"

  if [ "${n:-0}" -eq 0 ]; then
    printf '[backup] retencao %-22s 0 candidato(s)\n' "$padrao"
    return 0
  fi

  sobrando="$(printf '%s\n' "$candidatos" | tail -n "+$((RETER + 1))" || true)"
  local podados=0
  if [ -n "$sobrando" ]; then
    while read -r velho; do
      [ -n "$velho" ] || continue
      rm -f "$velho" && podados=$((podados + 1))
    done <<< "$sobrando"
  fi
  printf '[backup] retencao %-22s %d candidato(s), %d podado(s), %d mantido(s)\n' \
    "$padrao" "$n" "$podados" "$((n - podados))"
  return 0
}

TOTAL_ARQUIVOS="$(ls -1 "$DESTINO" 2>/dev/null | grep -c . || true)"
podar 'banco-*.dump'
podar 'banco-*.dump.enc'
podar 'uploads-*.tgz'
podar 'config-*.tgz'

# O diretório tem arquivos, mas nenhum padrão casou nada: é exatamente a falha
# silenciosa descrita acima, acontecendo de novo com outro nome.
CASOU="$(ls -1 "$DESTINO"/banco-*.dump "$DESTINO"/banco-*.dump.enc "$DESTINO"/uploads-*.tgz "$DESTINO"/config-*.tgz 2>/dev/null | grep -c . || true)"
if [ "${TOTAL_ARQUIVOS:-0}" -gt 0 ] && [ "${CASOU:-0}" -eq 0 ]; then
  aviso "$DESTINO tem $TOTAL_ARQUIVOS arquivo(s) e NENHUM casou os padroes de retencao. A poda nao esta acontecendo — confira se os nomes mudaram."
fi

info "ok — $CARIMBO"
cat <<'TXT'

ATENCAO: isto esta no disco desta maquina. Um disco so nao e backup.
Copie para fora (S3, rsync, outro host) — o incendio que apaga o banco apaga
o backup que mora ao lado dele.

As TRES pecas precisam viajar juntas: dump + uploads + config. O .env leva a
PRISMA_FIELD_ENCRYPTION_KEY, sem a qual nome, endereco e foto dos alunos nao
voltam de jeito nenhum.
TXT

if [ "$VERIFICAR" -eq 0 ]; then
  cat <<'TXT'

Um dump que nunca foi restaurado nao e backup, e um arquivo.
Rode com --verificar para a restauracao acontecer aqui.
TXT
fi
