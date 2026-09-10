#!/usr/bin/env bash
# Recusa iniciar a suite quando outra ja esta rodando.
#
# Por que existe.
#
# A trava consultiva em `api/tests/setup.ts` impede que duas suites corrompam os
# dados uma da outra — mas ela so age DEPOIS que o vitest subiu. Duas coisas
# acontecem antes disso e continuam colidindo:
#
#   - o diretorio de cobertura (`api/coverage/.tmp`) e compartilhado, e a
#     segunda execucao apaga os arquivos temporarios da primeira. A mensagem que
#     sai e "Something removed the coverage directory", que ninguem associa a
#     concorrencia;
#   - a segunda suite fica parada esperando a trava por ate dois minutos, sem
#     dizer por que.
#
# O custo de nao ter isto foi medido nesta sessao: uma rodada concorrente
# produziu 96 falhas com violacao de chave estrangeira em fixture, 404 em rota
# que existe e deadlock no Postgres — todos parecendo defeito de produto, nenhum
# sendo. Horas de investigacao para chegar a "havia duas suites".
#
# Falha ABERTO: sem docker ou sem banco de pe, segue e deixa o vitest dar a
# mensagem dele. Um guarda que impede de rodar teste porque nao conseguiu
# verificar e pior que o problema que evita.
set -uo pipefail

DONOS=$(docker exec vanpro-postgres psql -U postgres -d vanpro_test -tAc \
  "select a.pid from pg_locks l join pg_stat_activity a on a.pid = l.pid
    where l.locktype = 'advisory' and l.granted" 2>/dev/null || true)

[ -z "$DONOS" ] && exit 0

cat >&2 <<MSG

[SUITE OCUPADA] Ja existe uma execucao da suite contra o banco vanpro_test.

  Conexoes segurando a trava: $(echo "$DONOS" | tr '\n' ' ')

Duas suites ao mesmo tempo NAO produzem dois resultados: produzem dois
resultados errados. Uma apaga as tabelas no meio dos casos da outra, e a falha
sai disfarcada de defeito de produto.

Espere a primeira terminar. Se nao ha nenhuma rodando, a trava ficou orfa de uma
execucao interrompida — libere com:

  docker exec vanpro-postgres psql -U postgres -d vanpro_test -c \
    "select pg_terminate_backend(pid) from pg_locks l join pg_stat_activity a using (pid) where l.locktype='advisory' and l.granted"

MSG
exit 1
