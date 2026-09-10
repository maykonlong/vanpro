import { performance } from 'node:perf_hooks';

/**
 * Metricas em formato Prometheus, sem dependencia nova.
 *
 * O que se mede aqui e escolhido pelo que ajuda a responder "esta ruim para o
 * usuario?": taxa de erro, latencia e saturacao. Contador de requisicao total
 * sozinho nao responde nada — sobe igual quando esta tudo bem e quando esta
 * tudo quebrado.
 *
 * NAO ha rotulo com id de usuario, empresa ou caminho com parametro
 * interpolado: cada valor distinto de rotulo cria uma serie temporal nova, e
 * `path=/students/<uuid>` faria a cardinalidade explodir — alem de virar um
 * indice de quem existe no sistema, exposto no endpoint de metricas.
 */

interface Balde {
  contagem: number;
  soma: number;
  buckets: Map<number, number>;
}

const LIMITES_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

const porRota = new Map<string, Balde>();
const porStatus = new Map<string, number>();
let bloqueiosSentinela = 0;
let violacoesTenant = 0;
let falhasDeAuditoria = 0;
const inicio = performance.now();

function baldeDe(chave: string): Balde {
  let b = porRota.get(chave);
  if (!b) {
    b = { contagem: 0, soma: 0, buckets: new Map(LIMITES_MS.map((l) => [l, 0])) };
    porRota.set(chave, b);
  }
  return b;
}

/** `rota` deve ser o PADRAO (`/students/:id`), nunca o caminho concreto. */
export function registrarRequisicao(metodo: string, rota: string, status: number, duracaoMs: number): void {
  const b = baldeDe(`${metodo} ${rota}`);
  b.contagem += 1;
  b.soma += duracaoMs;
  for (const limite of LIMITES_MS) {
    if (duracaoMs <= limite) b.buckets.set(limite, (b.buckets.get(limite) ?? 0) + 1);
  }
  const classe = `${Math.floor(status / 100)}xx`;
  porStatus.set(classe, (porStatus.get(classe) ?? 0) + 1);
}

export function registrarBloqueioSentinela(): void {
  bloqueiosSentinela += 1;
}

export function registrarViolacaoTenant(): void {
  violacoesTenant += 1;
}

export function registrarFalhaDeAuditoria(): void {
  falhasDeAuditoria += 1;
}

function escapar(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

export function renderizarPrometheus(): string {
  const linhas: string[] = [];
  const mem = process.memoryUsage();

  linhas.push('# HELP vanpro_up 1 quando o processo esta servindo.');
  linhas.push('# TYPE vanpro_up gauge');
  linhas.push('vanpro_up 1');

  linhas.push('# HELP vanpro_uptime_seconds Tempo desde o boot.');
  linhas.push('# TYPE vanpro_uptime_seconds gauge');
  linhas.push(`vanpro_uptime_seconds ${((performance.now() - inicio) / 1000).toFixed(1)}`);

  linhas.push('# HELP vanpro_memoria_bytes Memoria do processo, por area.');
  linhas.push('# TYPE vanpro_memoria_bytes gauge');
  linhas.push(`vanpro_memoria_bytes{area="heap_usado"} ${mem.heapUsed}`);
  linhas.push(`vanpro_memoria_bytes{area="heap_total"} ${mem.heapTotal}`);
  linhas.push(`vanpro_memoria_bytes{area="rss"} ${mem.rss}`);

  linhas.push('# HELP vanpro_respostas_total Respostas por classe de status.');
  linhas.push('# TYPE vanpro_respostas_total counter');
  for (const [classe, n] of porStatus) {
    linhas.push(`vanpro_respostas_total{classe="${escapar(classe)}"} ${n}`);
  }

  linhas.push('# HELP vanpro_requisicao_duracao_ms Latencia por rota.');
  linhas.push('# TYPE vanpro_requisicao_duracao_ms histogram');
  for (const [chave, b] of porRota) {
    const rotulo = escapar(chave);
    let acumulado = 0;
    for (const limite of LIMITES_MS) {
      acumulado = b.buckets.get(limite) ?? 0;
      linhas.push(`vanpro_requisicao_duracao_ms_bucket{rota="${rotulo}",le="${limite}"} ${acumulado}`);
    }
    linhas.push(`vanpro_requisicao_duracao_ms_bucket{rota="${rotulo}",le="+Inf"} ${b.contagem}`);
    linhas.push(`vanpro_requisicao_duracao_ms_sum{rota="${rotulo}"} ${b.soma.toFixed(1)}`);
    linhas.push(`vanpro_requisicao_duracao_ms_count{rota="${rotulo}"} ${b.contagem}`);
  }

  linhas.push('# HELP vanpro_sentinela_bloqueios_total Requisicoes recusadas pelo escudo de borda.');
  linhas.push('# TYPE vanpro_sentinela_bloqueios_total counter');
  linhas.push(`vanpro_sentinela_bloqueios_total ${bloqueiosSentinela}`);

  // Esta metrica deve ficar em ZERO. Qualquer valor acima disso e bug de
  // programacao com potencial de vazamento entre empresas, e merece alerta —
  // nao painel.
  linhas.push('# HELP vanpro_violacoes_tenant_total Consultas sem contexto de empresa ou com empresa divergente.');
  linhas.push('# TYPE vanpro_violacoes_tenant_total counter');
  linhas.push(`vanpro_violacoes_tenant_total ${violacoesTenant}`);

  // Tambem deve ficar em ZERO, e pelo mesmo motivo: `audit()` nunca lanca, para
  // nao derrubar a operacao principal. Isso torna a falha MUDA — foi assim que
  // uma trava mal escrita parou a trilha inteira sem ninguem notar. Este
  // contador e a unica forma de a perda aparecer antes de alguem precisar da
  // trilha como prova e descobrir que ela nao existe.
  linhas.push('# HELP vanpro_falhas_auditoria_total Eventos que nao puderam ser gravados na trilha.');
  linhas.push('# TYPE vanpro_falhas_auditoria_total counter');
  linhas.push(`vanpro_falhas_auditoria_total ${falhasDeAuditoria}`);

  return linhas.join('\n') + '\n';
}
