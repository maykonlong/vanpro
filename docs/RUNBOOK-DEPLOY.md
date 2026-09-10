# Runbook — deploy do VanPro

Procedimento para subir uma versão nova em produção.

> **A pergunta que este runbook existe para responder** não é "o deploy subiu?".
> É "ninguém perdeu dado?". São perguntas diferentes, e só a segunda importa
> para o dono da van que abre o app na segunda-feira.
>
> Regra da casa: **ausência de sinal nunca é aprovação**. Passo que não pôde ser
> executado fica registrado como NÃO VERIFICADO, nunca como feito.

---

## 0. Antes de começar

| Pré-requisito | Como conferir |
|---|---|
| CI verde no commit que vai subir | `gh run list --limit 1` |
| Nenhuma migration destrutiva sem aceite | `bash infra/scripts/check-migration-safety.sh --desde origin/main` |
| `.env` da raiz presente no host | `test -f /opt/vanpro/.env && echo ok` |
| Janela combinada | fora do horário de rota (manhã 6h–8h, tarde 16h–18h) |

Deploy durante a rota é deploy no pior momento: é exatamente quando o motorista
faz check-in de criança pelo celular e o responsável acompanha.

### Se for a PRIMEIRA subida deste host

Três coisas precisam existir antes do `up`, e nenhuma delas é criada sozinha:

```bash
node infra/scripts/gen-secrets.mjs --write     # segredos + as 3 senhas do banco
bash infra/scripts/gerar-certificados.sh       # CA local + certificado do web e do banco
docker compose up -d --build
cd api && npm run prisma:seed                  # só em ambiente de demonstração
```

Os papéis `vanpro_owner` e `vanpro_app` nascem em
`infra/postgres/init/00-papeis.sh`, e o entrypoint do PostgreSQL **só executa os
scripts de init com o diretório de dados vazio**. Num volume que já existe eles
não aparecem, e o sintoma é uma API que não conecta com mensagem de senha — que
aponta para o lugar errado. Volume novo, ou os papéis criados à mão.

Num servidor com certificado público (Let's Encrypt), o `gerar-certificados.sh`
continua sendo necessário **para o banco**: o cliente do PostgreSQL não consulta
a loja de CAs do sistema, ele quer o arquivo apontado por `sslcert`.

---

## 1. Backup verificado — ANTES de subir, não depois

Este é o passo que não se pula. Um backup feito depois do deploy que corrompeu
dado é um backup do dado corrompido.

```bash
cd /opt/vanpro
bash infra/scripts/backup.sh --verificar \
  --destino /var/backups/vanpro \
  --uploads /var/lib/docker/volumes/vanpro_uploads/_data
```

O `--verificar` **restaura o dump num banco descartável** e conta as tabelas e
as linhas de `Company`, `Student` e `Invoice`. Sem ele o que se tem é um
arquivo, não um backup — um dump que nunca foi restaurado é uma hipótese.

**O script precisa sair 0.** Se sair diferente, **pare o deploy**. Não existe
"subir mesmo assim e tirar o backup depois": sem ponto de retorno, um bug de
escrita vira perda definitiva.

### As TRÊS peças

O backup só reconstrói produção se as três viajarem juntas:

| Peça | O que carrega | O que se perde sem ela |
|---|---|---|
| `banco-*.dump` | todo o dado | tudo |
| `uploads-*.tgz` | fotos dos alunos (volume `uploads`) | o rosto de cada criança — não se regenera |
| `config-*.tgz` | `.env` da raiz + `docker-compose.yml` | **a `PRISMA_FIELD_ENCRYPTION_KEY`** |

A terceira é a que costuma faltar e a que não tem volta. Nome, endereço e foto
do aluno estão **cifrados em repouso** no banco: saem do dump como
`v1.aesgcm256.…` e **só** a `PRISMA_FIELD_ENCRYPTION_KEY` os abre. Perdida a
chave, o dump continua íntegro, do tamanho certo, e ilegível para sempre.

Confirme, com os olhos, que as três existem:

```bash
ls -la /var/backups/vanpro | tail -5
```

E que elas estão **fora desta máquina**. Um disco só não é backup: o incêndio
que apaga o banco apaga o backup que mora ao lado dele.

---

## 2. Contagem-ANTES, por empresa

O que separa "o deploy subiu" de "ninguém perdeu dado". Sem esse número
anotado, um deploy que apagou 40 faturas de uma empresa passa despercebido —
todas as telas abrem, o app responde 200, e ninguém sabe o que havia antes.

```bash
docker compose exec -T postgres psql -U vanpro -d vanpro -A -F' | ' -c "
SELECT c.id,
       c.name                                                AS empresa,
       (SELECT count(*) FROM \"Student\" s
          WHERE s.\"companyId\" = c.id AND s.\"deletedAt\" IS NULL) AS alunos,
       (SELECT count(*) FROM \"Vehicle\" v
          WHERE v.\"companyId\" = c.id AND v.\"deletedAt\" IS NULL) AS veiculos,
       (SELECT count(*) FROM \"Invoice\" i
          WHERE i.\"companyId\" = c.id)                       AS faturas,
       COALESCE((SELECT sum(i.\"amountCents\") FROM \"Invoice\" i
          WHERE i.\"companyId\" = c.id), 0)                   AS soma_centavos
FROM \"Company\" c
ORDER BY c.id;
" | tee /var/backups/vanpro/contagem-antes-$(date -u +%Y%m%dT%H%M%SZ).txt
```

Guarde a saída. Ela é o único jeito de responder a pergunta do topo.

> `Company.name` **não** é campo cifrado (só `Student.name`, `Student.address` e
> `Student.photoUrl` são — `api/prisma/schema.prisma`), então o nome da empresa
> sai legível aqui. O que se compara, de qualquer forma, é o `id` e os números.

---

## 3. Subir

```bash
git fetch --all --tags
git checkout <sha-ou-tag>
docker compose up -d --build
```

O serviço `migrate` é one-shot e a `api` só sobe com
`condition: service_completed_successfully`. Se o migrate falhar, a API **não
sobe** — e isso é o comportamento certo: subir aplicação sobre schema meio
migrado é como se corrompe dado de verdade.

Acompanhe:

```bash
docker compose logs -f migrate
docker compose ps
```

---

## 4. Contagem-DEPOIS, por empresa

**A mesma consulta do passo 2**, comparada linha a linha:

```bash
diff <(cat /var/backups/vanpro/contagem-antes-*.txt | tail -n +1) \
     <(docker compose exec -T postgres psql -U vanpro -d vanpro -A -F' | ' -c "…mesma query…")
```

| Diferença | Leitura |
|---|---|
| nenhuma | esperado no deploy comum |
| contagens **subiram** | normal — o sistema continuou operando durante o deploy |
| contagem **caiu** em qualquer empresa | **PARE.** Rollback e investigação. Não existe explicação boa para aluno ou fatura sumir num deploy |
| `soma_centavos` mudou sem fatura nova | **PARE.** Ou uma migration converteu dinheiro, ou algo reescreveu valor |

Dinheiro é `Int` em centavos por contrato (`docs/ARCHITECTURE.md`, regra 5). Uma
`soma_centavos` que muda de escala (ex.: caiu 100x) é migration que passou o
valor por float — o defeito que a regra existe para impedir.

---

## 5. Verificar de fora

Subir não é estar certo:

```bash
bash infra/scripts/verificar-deploy.sh https://<host>
```

Três variáveis mudam o que dá para medir:

| Variável | Para quê |
|---|---|
| `VANPRO_CA` | arquivo da CA local. Se o certificado for recusado pela loja do sistema **mas** aceito por essa âncora, o resultado é **NV** e não FALHA — "certificado inválido" e "esta máquina ainda não instalou a CA" são coisas diferentes, e reprovar as duas igual é o que ensina uma equipe a rodar tudo com `-k`. Padrão: `infra/certs/ca.crt`, se existir |
| `VANPRO_URL_HTTP` | a URL em texto claro a testar. Necessária quando o HTTPS não está na 443: `http://host:8443` bate na porta TLS e o nginx responde 400, que seria contado como falha sem ter nada a ver com servir em claro |
| `VANPRO_LOGIN` / `VANPRO_SENHA` | credencial **válida**. Com elas, as flags do cookie de sessão saem de NV para medição de verdade — o cookie não existe numa resposta de credencial inválida |

Na stack local de produção simulada:

```bash
VANPRO_URL_HTTP=http://vanpro.localhost:8080 VANPRO_LOGIN=roberto@transvan.com.br VANPRO_SENHA='VanPro@Demo2026'   bash infra/scripts/verificar-deploy.sh https://vanpro.localhost:8443
```

| Exit | Significado | O que fazer |
|---|---|---|
| `0` | APROVADO — tudo medido e passou | seguir |
| `1` | REPROVADO — garantia prometida não está de pé | rollback |
| `3` | **INCOMPLETO** — nada falhou, mas nem tudo foi medido | **não é aprovação.** Feche o que ficou NV antes de declarar o deploy bom |

---

## 6. Se der errado

```bash
DRY_RUN=1 bash infra/scripts/rollback.sh <sha-anterior>   # ver o que faria
bash infra/scripts/rollback.sh <sha-anterior>
```

O rollback reconstrói **só os serviços de app**, com `--no-deps`, sem
re-executar o `migrate` — o motivo está escrito no topo do script.

**Ele reverte código, não schema.** Se a versão que está saindo trouxe migration
com `DROP COLUMN`, `DROP TABLE`, `SET NOT NULL` ou `DROP CONSTRAINT`, o código
antigo **não** roda contra o schema atual e o rollback não basta: o caminho é
restaurar o dump do passo 1 (com a perda do intervalo) ou seguir para frente com
hotfix. `infra/scripts/check-migration-safety.sh` existe para que essa situação
seja sempre uma decisão escrita, nunca uma surpresa.

Restauração, quando for o caso:

```bash
# 1. Abra o envelope, se o backup estiver cifrado
bash infra/scripts/cifrar-backup.sh --abrir banco-<carimbo>.dump.enc ~/vanpro-backup.key

# 2. Restaure sobre o banco parado (a api NÃO pode estar escrevendo)
docker compose stop api web
pg_restore --clean --if-exists --no-owner --no-acl \
  -d "$DATABASE_URL" banco-<carimbo>.dump

# 3. Devolva os uploads
tar -xzf uploads-<carimbo>.tgz -C /var/lib/docker/volumes/vanpro_uploads/

# 4. Confirme que a PRISMA_FIELD_ENCRYPTION_KEY do .env é a MESMA de quando o
#    dump foi feito. Com outra chave o app sobe, as telas abrem, e todo nome de
#    aluno vem ilegível — e essa é a hora de descobrir, não depois.
docker compose up -d
```

---

## 7. Depois

- Rode a contagem por empresa mais uma vez, 24h depois. Perda silenciosa às
  vezes aparece só no primeiro ciclo de cobrança.
- Confirme que o monitor sintético está agendado e passou:
  `node infra/scripts/monitor-sintetico.mjs https://<host>`
- Registre no `docs/RELATORIO-VALIDACAO.md` o que **não** foi verificado neste
  deploy. A lista de NÃO VERIFICADO é parte da entrega, não uma falha de
  relatório.

---

## NÃO VERIFICADO neste runbook

Escrito para ser honesto sobre o próprio estado:

| Item | Situação |
|---|---|
| Este procedimento de ponta a ponta | **nunca executado** contra um host real. Foi escrito a partir do compose e do código. Os passos 1, 3 e 5 já foram exercitados contra a stack local em modo de produção. |
| Restauração completa (passo 6) | os comandos de restauração **sobre produção** não foram rodados. `infra/scripts/backup.sh --verificar` **foi** executado e passou: 25 tabelas restauradas num banco descartável, com `Company: 3`, `Student: 40`, `Invoice: 2`. |
| Confiança no certificado pela loja do sistema | **NÃO VERIFICADO** na máquina de desenvolvimento: a CA local não está instalada, e o curl do Windows usa Schannel, que trata "revogação desconhecida" como falha mesmo com a CA instalada. O certificado é válido sob a âncora local — o que não dá para afirmar é o que o navegador de um terceiro faz. |
| Consultas de contagem (passos 2 e 4) | os nomes de tabela e coluna foram conferidos **lendo** `api/prisma/schema.prisma`; as consultas **não** foram executadas contra um banco. `Timecard` e `Punch` não entram na contagem — se passarem a importar, acrescente-os. |
