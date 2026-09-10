#!/bin/sh
# ─── Dois papeis, e nao um ──────────────────────────────────────────────────
#
# Ate aqui a aplicacao falava com o banco como dona de tudo: o mesmo papel que
# roda `CREATE TABLE` na migration atendia cada requisicao HTTP. Isso significa
# que UMA injecao de SQL bem-sucedida nao le dado — ela apaga o schema.
#
#   vanpro_owner  dono do banco e do schema. Roda as migrations, no servico
#                 `migrate`, uma vez, e some. Tem CREATEDB porque o
#                 `backup.sh --verificar` precisa criar um banco descartavel
#                 para provar que o dump restaura.
#   vanpro_app    o que a API usa em toda requisicao. SELECT/INSERT/UPDATE/
#                 DELETE e nada mais: nao cria, nao apaga tabela, nao e
#                 superusuario, nao enxerga papel nenhum.
#
# `postgres` (superusuario) continua existindo, mas o pg_hba o recusa pela rede:
# ele so responde no socket unix de dentro do container.
#
# As tabelas ainda nao existem quando este script roda — elas nascem na
# migration. Por isso o privilegio do app vem de ALTER DEFAULT PRIVILEGES: tudo
# que o owner criar dali em diante ja nasce com o GRANT certo. A alternativa
# (rodar GRANT depois das migrations) e um passo que se esquece exatamente uma
# vez, e o sintoma e a API inteira em erro de permissao.
set -eu

: "${VANPRO_OWNER_PASSWORD:?defina VANPRO_OWNER_PASSWORD no ambiente do servico postgres}"
: "${VANPRO_APP_PASSWORD:?defina VANPRO_APP_PASSWORD no ambiente do servico postgres}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
	CREATE ROLE vanpro_owner LOGIN PASSWORD '${VANPRO_OWNER_PASSWORD}'
	  NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
	CREATE ROLE vanpro_app LOGIN PASSWORD '${VANPRO_APP_PASSWORD}'
	  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

	ALTER DATABASE ${POSTGRES_DB} OWNER TO vanpro_owner;

	-- Banco de testes separado: a suite trunca tabelas, e truncar o banco de
	-- desenvolvimento durante um teste distraido ja custou tarde de trabalho
	-- para muita gente.
	CREATE DATABASE vanpro_test OWNER vanpro_owner;
	-- Banco vazio usado pelo \`prisma migrate diff\` para provar que as
	-- migrations versionadas descrevem o schema.
	CREATE DATABASE vanpro_shadow OWNER vanpro_owner;
SQL

# O mesmo tratamento nos tres bancos. O de teste tambem: a suite exercita o
# caminho de producao, e um privilegio que so existe em teste esconde
# justamente o erro de permissao que apareceria no deploy.
for banco in "$POSTGRES_DB" vanpro_test vanpro_shadow; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$banco" <<-SQL
	ALTER SCHEMA public OWNER TO vanpro_owner;

	-- Nenhum papel entra por ser "todo mundo". Sem isto, um papel novo nasce
	-- com CONNECT herdado de PUBLIC e o pg_hba vira a unica barreira.
	REVOKE ALL ON DATABASE ${banco} FROM PUBLIC;
	REVOKE ALL ON SCHEMA public FROM PUBLIC;

	GRANT CONNECT ON DATABASE ${banco} TO vanpro_app;
	GRANT USAGE ON SCHEMA public TO vanpro_app;

	ALTER DEFAULT PRIVILEGES FOR ROLE vanpro_owner IN SCHEMA public
	  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vanpro_app;
	ALTER DEFAULT PRIVILEGES FOR ROLE vanpro_owner IN SCHEMA public
	  GRANT USAGE, SELECT ON SEQUENCES TO vanpro_app;
	SQL
done

echo "[papeis] vanpro_owner (dono, migrations) e vanpro_app (runtime, so DML) criados."
