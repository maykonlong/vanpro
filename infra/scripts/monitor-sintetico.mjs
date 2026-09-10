// ─── Monitor sintético do VanPro ─────────────────────────────────────────────
//
// Um cheque EXTERNO e periódico, do lado de fora do processo: o app responde, e
// o que ele diz de si mesmo confere? É a peça que os healthchecks do
// docker-compose não cobrem — eles reiniciam contêiner, não avisam ninguém.
//
// Serve a um cron, a um systemd timer ou a um uptime externo
// (Healthchecks.io, UptimeRobot) pelo CÓDIGO DE SAÍDA:
//
//   0  servindo (com ou sem aviso)
//   2  fora do ar — /health/live falhou, ou o banco se declarou caído
//
// A regra de quem acorda quem: BANCO CAÍDO derruba o exit code, porque sem
// banco não há cadastro, rota nem cobrança. INTEGRAÇÃO DESLIGADA (Asaas,
// WhatsApp, Maps) é aviso e não acorda ninguém — no VanPro, integração sem
// credencial é um estado NORMAL e declarado (`503 FEATURE_DISABLED`), não uma
// falha. Um monitor que grita por isso ensina a equipe a ignorar o monitor.
//
// A DECISÃO é pura e testável (`avaliar`), separada do I/O (`principal`). Assim
// dá para provar o comportamento em cada combinação sem subir servidor nenhum —
// inclusive as combinações que quase nunca acontecem em produção, que são
// justamente as que ninguém testa à mão.
//
// Uso:
//   VANPRO_URL=https://vanpro.exemplo node infra/scripts/monitor-sintetico.mjs
//   node infra/scripts/monitor-sintetico.mjs https://vanpro.exemplo
//
// Variáveis:
//   VANPRO_URL          base da aplicação (ou 1º argumento)
//   METRICS_TOKEN       se definido, tenta ler /health/metrics com Bearer
//   MONITOR_TIMEOUT_MS  padrão 8000

/** Lê um gauge simples ("nome valor") do texto Prometheus. `null` se ausente. */
export function lerGauge(texto, nome) {
  const re = new RegExp('^' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(-?[0-9.eE+]+)\\s*$', 'm');
  const m = re.exec(String(texto || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Decide o veredito a partir do que foi COLHIDO. Puro: sem rede, sem relógio,
 * sem process.exit. É o que os testes exercitam.
 *
 * @param {{
 *   liveOk: boolean,
 *   readyOk: boolean|null,
 *   dbUp: boolean|null,
 *   metricasOk: boolean,
 *   violacoesTenant: number|null,
 *   integracoesDesligadas: string[]
 * }} e
 * @returns {{codigo: 0|2, nivel: 'ok'|'aviso'|'critico', mensagem: string}}
 */
export function avaliar(e) {
  const {
    liveOk = false,
    readyOk = null,
    dbUp = null,
    metricasOk = false,
    violacoesTenant = null,
    integracoesDesligadas = [],
  } = e || {};

  if (!liveOk) {
    return { codigo: 2, nivel: 'critico', mensagem: '/health/live nao respondeu 200 — fora do ar' };
  }

  // Banco caído derruba, e é a única dependência que derruba: o /ready da API
  // trata Redis fora como degradado (rate limit cai para memória local) e o
  // resto do produto continua de pé.
  if (dbUp === false) {
    return { codigo: 2, nivel: 'critico', mensagem: '/health/live ok, mas o banco se declarou CAIDO (/health/ready: database=down)' };
  }
  if (readyOk === false && dbUp === null) {
    return { codigo: 2, nivel: 'critico', mensagem: '/health/ready respondeu 503 e nao disse qual dependencia caiu — trate como indisponivel ate saber' };
  }

  // Violação de tenant não muda o exit code (o app está servindo), mas nunca
  // pode passar despercebida: é vazamento potencial entre empresas. O alerta de
  // verdade é o do Prometheus; aqui o monitor grita para quem só tem o cron.
  if (typeof violacoesTenant === 'number' && violacoesTenant > 0) {
    return {
      codigo: 0,
      nivel: 'critico',
      mensagem: `INCIDENTE: vanpro_violacoes_tenant_total=${violacoesTenant} (consulta sem contexto de empresa). Ver docs/RUNBOOK-LGPD-BREACH.md — o prazo da ANPD comeca na deteccao`,
    };
  }

  if (integracoesDesligadas.length > 0) {
    return {
      codigo: 0,
      nivel: 'aviso',
      mensagem: `app ok; integracao desligada (normal se nao contratada): ${integracoesDesligadas.join(', ')}`,
    };
  }

  return {
    codigo: 0,
    nivel: 'ok',
    mensagem: metricasOk ? 'app ok, banco ok, metricas ok' : 'app ok, banco ok (/health/metrics nao lido — normal se o coletor for interno)',
  };
}

async function principal() {
  const base = String(process.argv[2] || process.env.VANPRO_URL || '').replace(/\/$/, '');
  if (!base) {
    console.error('defina VANPRO_URL ou passe a URL como argumento. Ex.: node infra/scripts/monitor-sintetico.mjs https://vanpro.exemplo');
    process.exit(2);
  }

  const api = base + '/api/v1';
  const tempo = Number(process.env.MONITOR_TIMEOUT_MS || 8000);
  const token = process.env.METRICS_TOKEN || '';

  const buscar = async (caminho, headers) => {
    const r = await fetch(api + caminho, { headers, signal: AbortSignal.timeout(tempo) });
    return { status: r.status, texto: await r.text().catch(() => '') };
  };

  let liveOk = false;
  let readyOk = null;
  let dbUp = null;
  let metricasOk = false;
  let violacoesTenant = null;
  const integracoesDesligadas = [];

  try {
    liveOk = (await buscar('/health/live')).status === 200;
  } catch {
    liveOk = false;
  }

  try {
    const r = await buscar('/health/ready');
    readyOk = r.status === 200;
    // O /ready diz QUAL dependência caiu. Sem esse detalhe, "não pronto" não
    // distingue banco fora (crítico) de cache fora (degradado).
    const corpo = JSON.parse(r.texto || '{}');
    if (corpo && corpo.checks && typeof corpo.checks.database === 'string') {
      dbUp = corpo.checks.database === 'ok';
    }
  } catch {
    // /ready inacessível não decide nada sozinho: se /live respondeu, o app
    // está de pé. Fica como desconhecido (null), e `avaliar` trata isso.
  }

  try {
    const r = await buscar('/health/features');
    const f = JSON.parse(r.texto || '{}');
    for (const [nome, ligada] of Object.entries(f || {})) {
      if (ligada === false) integracoesDesligadas.push(nome);
    }
  } catch {
    // idem: ausência de resposta aqui não é sinal de problema.
  }

  if (token) {
    try {
      const m = await buscar('/health/metrics', { Authorization: 'Bearer ' + token });
      if (m.status === 200) {
        metricasOk = true;
        violacoesTenant = lerGauge(m.texto, 'vanpro_violacoes_tenant_total');
      }
    } catch {
      // Métricas indisponíveis é o normal quando o coletor é interno: o nginx
      // não repassa esse prefixo. /live e /ready decidem.
    }
  }

  const v = avaliar({ liveOk, readyOk, dbUp, metricasOk, violacoesTenant, integracoesDesligadas });
  const linha = `[${new Date().toISOString()}] ${v.nivel.toUpperCase()} ${base} — ${v.mensagem}`;
  (v.codigo === 0 && v.nivel === 'ok' ? console.log : console.error)(linha);
  process.exit(v.codigo);
}

// Só roda o main quando executado direto — importar no teste não dispara rede.
if (process.argv[1] && process.argv[1].endsWith('monitor-sintetico.mjs')) {
  principal();
}
