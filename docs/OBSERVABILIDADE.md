# Observabilidade — o painel e os oito alertas

A pergunta que este documento existe para responder: **são 6h30, a van está na
porta da escola e alguém liga dizendo que não consegue entrar. O que você olha?**

Antes, a resposta era "os logs do contêiner, e boa sorte". As métricas já
existiam — `api/src/lib/metrics.ts` sempre expôs latência, erro e saturação no
formato do Prometheus — mas ninguém as coletava. Métrica que ninguém lê é
esforço que não virou resposta.

---

## Subir

Fica **fora** do compose de produção, de propósito: acrescentar dois serviços ao
`docker-compose.yml` mudaria a topologia do deploy sem decisão de ninguém.

```bash
# a pilha do VanPro precisa estar no ar — é ela que cria a rede
export GRAFANA_USER=vanpro
export GRAFANA_PASSWORD="$(node -e 'process.stdout.write(require("crypto").randomBytes(18).toString("base64url"))')"

docker compose -p vanpro-obs \
  -f infra/observabilidade/docker-compose.observabilidade.yml up -d
```

Sem `GRAFANA_PASSWORD` o compose **recusa subir**, em vez de cair no
`admin/admin` — que é o mesmo que sem senha. Guarde a que você gerou.

### Ver o painel

Nenhum dos dois publica porta. Não é descuido: o painel mostra o mapa inteiro da
operação — quais rotas existem, quanto tráfego cada uma recebe, a que horas o
sistema cai. Isso é reconhecimento pronto para quem estiver olhando.

```bash
ssh -L 3001:vanpro-grafana:3000 usuario@servidor   # painel  → http://localhost:3001
ssh -L 9090:vanpro-prometheus:9090 usuario@servidor # regras → http://localhost:9090/alerts
```

---

## O painel

Um só, `VanPro — operação`, provisionado por arquivo e **não editável pela
interface**. Painel ajustado no navegador vive na memória de quem ajustou: some
no dia em que o volume for perdido e ninguém lembra como estava. Para mudar,
mude `infra/observabilidade/grafana/paineis/vanpro.json`.

Ele responde três perguntas, nessa ordem:

| Faixa | Pergunta |
|---|---|
| **As duas que precisam viver em zero** | vazou dado entre frotas? a trilha perdeu evento? |
| **Está rápido?** | p95 por rota, e respostas separadas por classe |
| **Borda e recursos** | o escudo está recusando muita coisa? a memória está estável? |

A primeira faixa vem antes da latência de propósito. Lentidão irrita; vazamento
entre empresas com dado de criança é incidente com prazo legal.

---

## Os oito alertas

Regra de corte: **só entra o que exige ação humana agora**. Alerta sem ação
possível ensina a equipe a ignorar alerta — e no dia em que um de verdade
disparar, ninguém olha.

### Os dois que valem acordar alguém

Estes disparam no **primeiro evento**, sem `for`. Não há limiar a calibrar: as
duas métricas foram construídas para viver em zero.

| Alerta | O que significa |
|---|---|
| `VanProViolacaoDeTenant` | Uma consulta rodou sem contexto de empresa, ou com empresa divergente. É vazamento potencial entre frotas, com dado de criança. Trate como incidente: [`RUNBOOK-LGPD-BREACH.md`](RUNBOOK-LGPD-BREACH.md), passo 1 — o prazo da ANPD começa na hora da detecção. |
| `VanProTrilhaDeAuditoriaFalhando` | A trilha deixou de gravar um evento. `audit()` nunca lança, de propósito, para não derrubar a operação principal — o preço é que a falha é **muda**. Já aconteceu aqui: uma trava mal escrita parou a trilha inteira e oito testes falharam antes de alguém entender. Este alerta é a única forma de a perda aparecer antes de alguém precisar da trilha como prova. |

### Disponibilidade

| Alerta | Limiar | Por quê |
|---|---|---|
| `VanProMetricasAusentes` | coleta falha por 2m | O coletor perder o alvo é sinal, não ruído |
| `VanProProcessoForaDoAr` | `vanpro_up == 0` | Zero aqui com a página estática de pé significa **dependência travada**, não máquina fora — foi exatamente o sintoma do cache congelado |
| `VanProReiniciandoEmLaco` | uptime que não cresce | Contêiner que reinicia sozinho parece saudável em `docker ps` |

### Qualidade de serviço

| Alerta | Limiar | Por quê esse número |
|---|---|---|
| `VanProErro5xxElevado` | 5% por 5m | Abaixo disso, o ruído de um cliente com rede ruim domina |
| `VanProLatenciaAlta` | p95 > 1,5s por 10m, **por rota** | 1,5s é onde a pessoa conclui que travou e recarrega — dobrando a carga quando ela já está alta. O limiar não é chute: com uma conexão a listagem responde em ~500 ms, e a saturação medida com vinte simultâneas levou o p95 a 3s. O corte fica entre os dois |
| `VanProSentinelaBloqueandoMuito` | 50 recusas em 10m | Varredura automatizada é normal na internet. O que não é normal é subir junto com uma publicação do front — aí o filtro está recusando cliente legítimo |

**Rotulado por rota** de propósito: "o sistema está lento" não aciona ninguém;
"`/students` está lento" aponta para onde olhar. As rotas chegam como **padrão**
(`/students/:id`), nunca com id interpolado — métrica com id vira índice de quem
existe no sistema, exposto no endpoint.

### O grupo deliberadamente vazio

`vanpro-recursos` não tem regra. O único alerta que caberia ali — memória alta —
depende de um limiar que ainda não foi medido em uso real, e **limiar chutado é
pior que alerta nenhum**: ou não dispara nunca, ou dispara toda noite até alguém
desligar. O painel mostra a memória justamente para descobrir qual é o normal
antes de escrever a regra.

---

## O que foi verificado, e o que não foi

**Verificado nesta máquina**, com a pilha no ar:

- o Prometheus alcança `vanpro-api:3000` pela rede interna — alvo `up`;
- as **8 regras carregam e avaliam sem erro** contra dado real;
- a forma da expressão dos alertas de contador foi conferida: vazia enquanto o
  valor é zero, com séries assim que sai de zero;
- o Grafana provisiona a fonte de dados e o painel `vanpro-operacao` a partir do
  repositório.

**Não verificado:** nenhum alerta chegou a **disparar de verdade** — para isso
seria preciso provocar o incidente que ele detecta. E não há destino de
notificação configurado: as regras acendem no Prometheus, mas ninguém é avisado.

> **O próximo passo é esse.** Um alerta que ninguém recebe é um painel que
> alguém precisa lembrar de abrir — e às 6h30 ninguém lembra. Configure o
> Alertmanager (ou o canal de notificação do Grafana) apontando para onde a
> pessoa de plantão realmente olha, e prove com um disparo de teste.

Enquanto isso não existir, este item continua **PARCIAL** no laudo, e não
aprovado.
