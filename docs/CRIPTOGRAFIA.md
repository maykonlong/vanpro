# Criptografia no VanPro — o que é cifrado, o que não é, e por quê

Três camadas diferentes, com garantias diferentes. Confundi-las é o erro que
faz alguém dizer "o banco é criptografado" e acreditar que isso resolve tudo.

| Camada | O que protege | Contra o quê | Contra o quê **não** protege |
|---|---|---|---|
| TLS no PostgreSQL | o dado **em trânsito** entre API e banco | escuta na rede, contêiner vizinho comprometido, proxy no meio | qualquer coisa depois que o dado chega |
| Cifra de campo (`prisma-field-encryption`) | colunas específicas **em repouso** | dump vazado, backup perdido, DBA curioso, disco descartado | quem tem a chave — a API tem |
| TLS no front (nginx) | o dado entre navegador e servidor | Wi‑Fi aberto, provedor, captive portal | o servidor e o navegador |

---

## 1. Em trânsito: TLS obrigatório, e verificado

**Navegador → nginx.** TLS 1.2/1.3, certificado emitido pela CA local
(`infra/scripts/gerar-certificados.sh`). A porta em claro existe só para
devolver `301` — nenhum byte da aplicação passa por HTTP. HSTS com dois anos e
`includeSubDomains`.

**API → PostgreSQL.** `sslmode=require` **mais** `sslaccept=strict` **mais**
`sslcert` apontando a CA. As três partes importam por motivos diferentes:

- `sslmode=require` cifra o fio;
- `sslaccept=strict` **autentica a outra ponta**. Cifrado sem verificar
  certificado protege contra escuta passiva e contra mais nada: quem consegue
  se pôr no caminho apresenta o próprio certificado e a conexão segue
  "segura";
- `sslcert` diz **qual** âncora vale. Sem ela a verificação cai na loja de CAs
  do sistema, que não conhece a CA local.

O padrão do Prisma para `sslaccept` é `accept_invalid_certs`. Ou seja: o
silêncio aqui vale pelo valor frouxo. Por isso `api/src/config/env.ts` **exige**
as três em `APP_ENV=production` e derruba o boot sem elas.

Do lado do servidor, `infra/postgres/pg_hba.conf` recusa `hostnossl` para
qualquer papel. Não existe caminho em claro para cair de volta.

> **Grafias diferentes para a mesma coisa.** O Prisma usa
> `sslmode=require&sslaccept=strict&sslcert=…`; o `libpq` (psql, pg_dump, e por
> isso o `backup.sh`) usa `sslmode=verify-full&sslrootcert=…`. São a mesma
> garantia escrita em dois dialetos. Trocar um pelo outro não dá erro de
> sintaxe — dá uma conexão mais fraca do que se pensa.

**Conferir que está de pé:**

```bash
docker compose exec postgres psql -U postgres -d vanpro \
  -c "SELECT usename, ssl, version FROM pg_stat_ssl JOIN pg_stat_activity USING (pid) WHERE usename IS NOT NULL;"
```

`ssl = t` e `version = TLSv1.3` na linha do `vanpro_app`.

---

## 2. Em repouso: cifra de campo

**Algoritmo:** AES‑256‑GCM (autenticado — adulterar o texto cifrado é
detectado, não decifrado errado em silêncio), via
[`prisma-field-encryption`](https://github.com/47ng/prisma-field-encryption).
Chave em `PRISMA_FIELD_ENCRYPTION_KEY`, formato `k1.aesgcm256.<32 bytes
base64url>`.

Cada valor no banco fica como `v1.aesgcm256.<fingerprint da chave>.<texto
cifrado>`. O *fingerprint* é o que permite rotação: registros cifrados com a
chave antiga continuam legíveis enquanto ela estiver na lista de chaves
antigas.

### O que é cifrado, e por quê

| Modelo | Campo | Por quê |
|---|---|---|
| `User` | `twoFactorSecret` | é a semente do TOTP: quem a lê gera os códigos da vítima para sempre |
| `User` | `pendingTwoFactorSecret` | idem, durante o cadastro do segundo fator |
| `User` | `twoFactorRecoveryCodes` | contornam o segundo fator inteiro |
| `Student` | `name` | nome de criança, dado pessoal de menor (LGPD Art. 14) |
| `Student` | `address` | onde a criança mora — junto com o nome, é tudo que alguém precisa |
| `Student` | `photoUrl` | caminho da foto do rosto de um menor |
| `Note` | `content` | texto livre da equipe sobre o aluno: alergia, guarda compartilhada, saúde |
| `TeamMessage` | `content` | chat interno; na prática carrega nome e endereço de aluno |
| `IncidentAlert` | `description` | escrito no calor da ocorrência, sempre acaba com nome, local e estado de saúde de uma criança |

### O que **não** é cifrado, e por quê

Não é esquecimento. Cifrar um campo o torna inútil para busca, ordenação,
índice e agregação — o valor no banco vira ruído comparável só por igualdade
exata, e nem isso quando o modo é aleatório.

| Campo | Por que fica em claro |
|---|---|
| `Student.school`, `Student.grade` | a tela filtra e agrupa por eles o tempo todo. Sozinhos não identificam ninguém: o nome, que é o que liga a escola a uma pessoa, está cifrado |
| `Student.dateOfBirth` | `DateTime`, e a cifra opera sobre `String`. Cifrar exigiria trocar o tipo da coluna e perder toda comparação por faixa etária |
| `Student.latitude` / `longitude` | `Float`, mesma limitação. **É a lacuna real desta lista** — coordenada de casa de criança é dado forte, e hoje ela está em claro no banco. Mitigação atual: o acesso passa pelo tenant-guard e por papel; o endereço textual, que é o que uma pessoa lê, está cifrado. Fechar isso de verdade pede um tipo `String` cifrado ou cifra a nível de coluna no PostgreSQL (`pgcrypto`), e é mudança de schema |
| `Company.document` (CNPJ/CPF) | é `@unique` e a busca por documento é o caminho de cadastro. Cifra aleatória quebra a unicidade útil; cifra determinística devolveria o mesmo texto para o mesmo documento e viraria um oráculo de "esta empresa existe?" |
| `User.email` | chave de login. Mesmo raciocínio |
| `User.password` | **não é cifrado — é hash bcrypt (custo 12)**, que é outra coisa: cifra tem volta, hash não tem. Senha nunca deve ter volta |
| `Session.tokenHash` | idem: hash. Vazamento do banco não vira sessão válida |
| Valores em centavos, datas, status | não identificam pessoa; cifrá-los tornaria o DRE impossível |

### Não existe telefone nem documento de responsável no schema

O pedido citava "documento do responsável, telefone". Auditei `schema.prisma`
inteiro: **esses campos não existem hoje** — nem em `User`, nem em `Student`,
nem em `Company`. O contato com o responsável acontece pelo login dele
(`User.email`) e pelo WhatsApp, que usa identificador guardado fora daqui.
Quando eles forem criados, nascem com `/// @encrypted`: telefone e CPF de
responsável de menor não têm justificativa nenhuma para ficar em claro.

---

## 3. A chave: rotação, e o que acontece se sumir

### Se a chave se perder, o dado se perde

Não há recuperação. Não há suporte que resolva, não há força bruta viável, não
há caminho lateral. Nome, endereço e foto de todos os alunos, todas as
observações, todo o chat e todos os incidentes viram texto ilegível com o
tamanho certo — e o resto do banco continua funcionando, o que torna a perda
**silenciosa**: o sistema sobe, lista os alunos, e cada nome aparece como
`v1.aesgcm256.…`.

Consequências práticas:

- `PRISMA_FIELD_ENCRYPTION_KEY` mora em cofre (AWS Secrets Manager, Vault,
  1Password), **nunca** só no `.env` de uma máquina;
- o `infra/scripts/backup.sh` empacota o `.env` junto com o dump justamente por
  isso, e marca o pacote `600`. **Um dump sem a chave não é backup.** As três
  peças — dump, uploads, config — viajam juntas ou não vale;
- o backup em si precisa da própria cifra, porque o pacote de config **é** a
  chave: `bash infra/scripts/cifrar-backup.sh --gerar-chave ~/vanpro-backup` e
  depois `VANPRO_BACKUP_CERT=… bash infra/scripts/backup.sh`.

### Rotacionar a chave

A rotação é suportada pela biblioteca e acontece em três tempos. Ela **não** é
instantânea: os registros continuam cifrados com a chave velha até serem
reescritos.

1. **Gerar a nova e manter a velha como leitura:**

   ```bash
   npx prisma-field-encryption generate-key
   ```

   No ambiente:

   ```
   PRISMA_FIELD_ENCRYPTION_KEY=<a NOVA>
   PRISMA_FIELD_DECRYPTION_KEYS=<a VELHA>   # lista, separada por vírgula
   ```

   A partir daqui toda **escrita** usa a nova; toda **leitura** aceita as duas.
   O `fingerprint` no prefixo de cada valor é o que decide qual usar.

2. **Reescrever o acervo.** Um `update` que não muda nada já basta para o
   registro ser regravado com a chave nova — a biblioteca cifra na saída:

   ```ts
   // Em lotes, e fora do horário de pico: cada linha é uma escrita real.
   for (const { id } of await prisma.student.findMany({ select: { id: true } })) {
     await prisma.student.update({ where: { id }, data: {} });
   }
   ```

   Repetir para `Note`, `TeamMessage`, `IncidentAlert` e `User`.

3. **Só então** remover a chave velha de `PRISMA_FIELD_DECRYPTION_KEYS`.
   Remover antes do passo 2 terminar transforma os registros restantes em lixo
   permanente.

**Os backups anteriores continuam presos à chave velha.** Ela não pode ser
destruída enquanto houver backup dentro da janela de retenção que dependa dela
— guardar a chave aposentada no cofre, marcada com a data, é parte da rotação.

### Rotacionar as senhas do banco

Outro assunto, outro procedimento — e este é reversível:

```bash
node infra/scripts/gen-secrets.mjs --write --rotacionar-banco
```

O comando imprime os `ALTER ROLE` que faltam. Trocar só o arquivo não troca o
servidor: a API passa a apresentar uma senha que o PostgreSQL nunca viu, e o
erro (`password authentication failed`) aponta para o lugar errado.

### Rotacionar os certificados

```bash
bash infra/scripts/gerar-certificados.sh --forcar
docker compose up -d --force-recreate postgres web
```

As folhas valem 825 dias; a CA, 10 anos. Trocar a **CA** obriga a reinstalar a
âncora em cada máquina que confia nela — inclusive nos `.env`, que apontam o
`sslcert`.

---

## 4. O que continua fora do escopo

- **Cifra do disco do banco.** O volume do PostgreSQL não é cifrado. Num
  servidor isso se resolve na camada de baixo (LUKS, EBS encryption) e não
  aqui; localmente, o disco da máquina é a fronteira.
- **Cifra de coluna dentro do PostgreSQL (`pgcrypto`).** Não usada: a chave
  ficaria do lado do banco, que é justamente o lado de quem a cifra de campo
  quer proteger.
- **HSM / KMS gerenciado.** A chave vive em variável de ambiente. Em escala, o
  próximo passo é buscá-la de um KMS no boot, sem nunca gravá-la em disco.
