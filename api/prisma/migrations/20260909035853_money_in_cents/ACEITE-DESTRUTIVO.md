# Aceite de migration destrutiva

**Quem:** reescrita v3 · **Quando:** 2026-09-10

## O que esta migration remove

Sete colunas monetarias em ponto flutuante — `Charter.price`,
`Driver.dailyRate`, `Expense.amount`, `FinancialTransaction.amount`,
`Invoice.amount`, `Student.monthlyFee`, `SubscriptionPlan.price` —
substituidas pelos equivalentes em centavos inteiros.

## Por que remover, e nao conviver

Manter as duas representacoes lado a lado seria pior que remover: duas fontes de
verdade para o mesmo valor, com a soma divergindo entre elas conforme o
arredondamento. O erro apareceria na conciliacao, meses depois, sem quem
soubesse qual coluna estava certa.

## Por que o rollback para a versao anterior nao e necessario

Esta migration pertence a reescrita inicial e foi aplicada sobre banco vazio.
Nao existe deploy anterior a ela para o qual voltar, e nenhum dado de cliente
atravessou a mudanca.

**A partir daqui vale expand/contract:** remover coluna passa a exigir duas
releases de distancia — uma que para de escrever nela, outra que a remove.

## Por que este aceite mora AQUI, e nao dentro do migration.sql

O Prisma guarda o checksum de cada `migration.sql` em `_prisma_migrations`.
Escrever o aceite dentro do arquivo muda o checksum de uma migration **ja
aplicada**, e o proximo `migrate dev` exige reset do banco — em producao, isso e
um incidente, nao um aviso. Foi exatamente o que aconteceu ao tentar a primeira
versao deste aceite.

O arquivo ao lado carrega a decisao sem tocar no que o Prisma assina.
