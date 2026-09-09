-- Banco de testes separado: a suite trunca tabelas, e truncar o banco de dev
-- durante um teste distraido ja custou tarde de trabalho para muita gente.
CREATE DATABASE vanpro_test OWNER vanpro;
-- Banco vazio usado pelo `prisma migrate diff` para provar que as migrations
-- versionadas descrevem o schema. Precisa ser separado do banco de testes.
CREATE DATABASE vanpro_shadow OWNER vanpro;
