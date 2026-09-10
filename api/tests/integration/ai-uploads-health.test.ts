import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { cenarioDuasEmpresas, autenticar, criarUsuario, type Empresa } from '../helpers/factory';

/**
 * Tres superficies que a cobertura mostrou descobertas — e a razao de cada uma
 * doer.
 *
 * `modules/ai`     18% — a maquina de estados do rascunho (rascunho → aprovado
 *                        → publicado) decide o que sai no nome da escola.
 * `modules/uploads` 12% — e o unico caminho de escrita que nao passa por JSON, e
 *                        o que ele grava e foto de crianca.
 * `http/health`     23% — e o que o orquestrador consulta para decidir se
 *                        derruba ou nao o contentor.
 *
 * Cobertura baixa nao e o defeito; e o aviso de que nenhuma dessas decisoes
 * tinha prova. O que segue exercita cada uma pelo caminho real.
 */

let alfa: Empresa;
let beta: Empresa;

// PNG 1x1 valido: os oito primeiros bytes sao a assinatura que o servidor
// confere, e e por isso que nao da para usar texto disfarcado de imagem.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeEach(async () => {
  const cenario = await cenarioDuasEmpresas();
  alfa = cenario.alfa;
  beta = cenario.beta;
  await criarUsuario(alfa, 'DRIVER', 'motorista.alfa@teste.com.br');
});

// ---------------------------------------------------------------------------
// Campanhas e publicacoes
// ---------------------------------------------------------------------------

async function criarCampanha(c: Awaited<ReturnType<typeof autenticar>>, nome = 'Comunicado de férias') {
  const res = await c.post('/api/v1/ai/campaigns', {
    name: nome,
    template: 'Olá {{responsavel}}, o recesso começa na próxima segunda.',
    target: 'ALL_PARENTS',
    channel: 'WHATSAPP',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; isActive: boolean };
}

/** Rascunho criado direto no banco: a rota de geracao nao existe de proposito. */
async function criarRascunho(companyId: string, campaignId: string, canal = 'WHATSAPP') {
  return runUnscoped('fixture', () =>
    prisma.aIPost.create({
      data: {
        companyId,
        campaignId,
        content: 'Rascunho escrito por uma pessoa, que é como este produto funciona.',
        channel: canal,
        status: 'DRAFT',
      },
    }),
  );
}

describe('campanhas', () => {
  it('cria, lista, filtra por canal e desativa', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(dono);
    expect(campanha.isActive).toBe(true);

    const lista = await dono.get('/api/v1/ai/campaigns?channel=WHATSAPP&isActive=true');
    expect(lista.status).toBe(200);
    expect(lista.body.items.map((c: { id: string }) => c.id)).toContain(campanha.id);

    const desativada = await dono.patch(`/api/v1/ai/campaigns/${campanha.id}`, { isActive: false });
    expect(desativada.status).toBe(200);
    expect(desativada.body.isActive).toBe(false);

    // O filtro precisa refletir a mudanca, e nao servir de cache do estado velho.
    const ativas = await dono.get('/api/v1/ai/campaigns?isActive=true');
    expect(ativas.body.items.map((c: { id: string }) => c.id)).not.toContain(campanha.id);
  });

  it('a campanha de uma empresa nao aparece nem se deixa alterar pela outra', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(donoAlfa);

    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const lista = await donoBeta.get('/api/v1/ai/campaigns');
    expect(lista.body.items.map((c: { id: string }) => c.id)).not.toContain(campanha.id);

    // Pelo id direto: 404, e nao 403 — dizer "existe, mas não é sua" já entrega
    // que a campanha existe.
    const alteracao = await donoBeta.patch(`/api/v1/ai/campaigns/${campanha.id}`, { isActive: false });
    expect(alteracao.status).toBe(404);
  });

  it('o motorista nao mexe em campanha', async () => {
    const motorista = await autenticar('motorista.alfa@teste.com.br');
    const res = await motorista.get('/api/v1/ai/campaigns');
    expect(res.status).toBe(403);
  });
});

describe('publicacoes', () => {
  it('a geracao automatica recusa em vez de inventar texto', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/ai/posts/generate', {
      channel: 'WHATSAPP',
      prompt: 'Escreva um comunicado sobre o recesso.',
      quantity: 1,
    });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');

    // E nao pode ter gravado rascunho fantasma pelo caminho.
    const posts = await dono.get('/api/v1/ai/posts');
    expect(posts.body.meta.total).toBe(0);
  });

  it('aprovar so vale para rascunho, e a segunda tentativa e recusada', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(dono);
    const post = await criarRascunho(alfa.id, campanha.id);

    const aprovado = await dono.post(`/api/v1/ai/posts/${post.id}/approve`);
    expect(aprovado.status).toBe(200);
    expect(aprovado.body.status).toBe('APPROVED');

    const denovo = await dono.post(`/api/v1/ai/posts/${post.id}/approve`);
    expect(denovo.status).toBe(409);
  });

  it('publicar sem provedor do canal recusa — nao carimba PUBLISHED e torce', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(dono);
    const post = await criarRascunho(alfa.id, campanha.id);
    await dono.post(`/api/v1/ai/posts/${post.id}/approve`);

    const res = await dono.post(`/api/v1/ai/posts/${post.id}/publish`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');

    // O estado no banco continua APPROVED: recusa nao pode avancar a maquina.
    const atual = await runUnscoped('fixture', () =>
      prisma.aIPost.findUnique({ where: { id: post.id }, select: { status: true } }),
    );
    expect(atual!.status).toBe('APPROVED');
  });

  it('publicar sem aprovar antes e recusado', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(dono);
    const post = await criarRascunho(alfa.id, campanha.id);

    const res = await dono.post(`/api/v1/ai/posts/${post.id}/publish`);
    expect(res.status).toBe(409);
  });

  it('rejeitar guarda o motivo na trilha e barra a rejeicao do que ja foi ao ar', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(dono);
    const post = await criarRascunho(alfa.id, campanha.id);

    const res = await dono.post(`/api/v1/ai/posts/${post.id}/reject`, {
      reason: 'texto fala em reajuste que ainda não foi decidido',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');

    const trilha = await runUnscoped('fixture', () =>
      prisma.auditLog.findFirst({
        where: { companyId: alfa.id, action: 'AI_POST_REJECTED' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(trilha!.description).toContain('reajuste');

    // Ja veiculada nao volta atras: o efeito no mundo ja aconteceu.
    await runUnscoped('fixture', () =>
      prisma.aIPost.update({ where: { id: post.id }, data: { status: 'PUBLISHED' } }),
    );
    const tarde = await dono.post(`/api/v1/ai/posts/${post.id}/reject`, { reason: 'tarde demais' });
    expect(tarde.status).toBe(409);
  });

  it('publicacao de outra empresa devolve 404 pelo id direto', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const campanha = await criarCampanha(donoAlfa);
    const post = await criarRascunho(alfa.id, campanha.id);

    const donoBeta = await autenticar('dono.beta@teste.com.br');
    expect((await donoBeta.post(`/api/v1/ai/posts/${post.id}/approve`)).status).toBe(404);
  });
});

describe('aniversariantes', () => {
  it('so entra quem tem consentimento de imagem', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const hoje = new Date();

    await runUnscoped('fixture', () =>
      prisma.student.createMany({
        data: [
          {
            companyId: alfa.id,
            name: 'Com Consentimento',
            school: 'Escola A',
            grade: '1º Ano',
            shift: 'MORNING',
            monthlyFeeCents: 50_000,
            imageConsent: true,
            dateOfBirth: new Date(Date.UTC(2015, hoje.getUTCMonth(), hoje.getUTCDate())),
          },
          {
            companyId: alfa.id,
            name: 'Sem Consentimento',
            school: 'Escola A',
            grade: '1º Ano',
            shift: 'MORNING',
            monthlyFeeCents: 50_000,
            imageConsent: false,
            dateOfBirth: new Date(Date.UTC(2015, hoje.getUTCMonth(), hoje.getUTCDate())),
          },
        ],
      }),
    );

    const res = await dono.get('/api/v1/ai/birthdays?days=1');
    expect(res.status).toBe(200);
    const nomes = res.body.items.map((a: { name: string }) => a.name);
    expect(nomes).toContain('Com Consentimento');
    // LGPD Art. 14: crianca exige consentimento especifico, e a lista que
    // alimenta material de divulgacao nao pode nem cita-la.
    expect(nomes).not.toContain('Sem Consentimento');
  });
});

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

describe('upload de arquivo', () => {
  it('aceita PNG de verdade, guarda na pasta da empresa e devolve URL autenticada', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.upload('/api/v1/uploads', 'file', 'foto.png', PNG, 'image/png');

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.mimeType).toBe('image/png');
    // O nome do cliente nao sobrevive: e UUID + extensao.
    expect(res.body.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(res.body.url).toBe(`/uploads/${alfa.id}/${res.body.filename}`);

    const baixado = await dono.get(res.body.url.replace('/uploads', '/api/v1/uploads'));
    expect(baixado.status).toBe(200);
    expect(baixado.headers['content-type']).toContain('image/png');
    // Proxy guardando foto de crianca reabriria o acesso sem login.
    expect(baixado.headers['cache-control']).toBe('private, no-store');
    expect(baixado.headers['x-content-type-options']).toBe('nosniff');
  });

  it('recusa arquivo cujo conteudo nao corresponde ao tipo declarado', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.upload(
      '/api/v1/uploads',
      'file',
      'malicioso.png',
      Buffer.from('<?php system($_GET["c"]); ?>'),
      'image/png',
    );

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('não corresponde');
  });

  it('recusa tipo fora da lista, mesmo com conteudo coerente', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.upload(
      '/api/v1/uploads',
      'file',
      'planilha.csv',
      Buffer.from('a,b,c'),
      'text/csv',
    );
    expect(res.status).toBe(422);
  });

  it('o arquivo de uma empresa nao e servido para a outra', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const enviado = await donoAlfa.upload('/api/v1/uploads', 'file', 'foto.png', PNG, 'image/png');

    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const res = await donoBeta.get(`/api/v1/uploads/${alfa.id}/${enviado.body.filename}`);
    // 404, nao 403: confirmar a existencia ja e vazamento.
    expect(res.status).toBe(404);
    expect(beta.id).not.toBe(alfa.id);
  });

  it('travessia de caminho no nome do arquivo e recusada pela validacao', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get(`/api/v1/uploads/${alfa.id}/..%2f..%2f.env`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('o arquivo vive no BANCO, nao no disco da maquina', async () => {
    /*
     * Este teste existe por causa da segunda replica.
     *
     * Enquanto os bytes ficavam em `fs.writeFile`, a foto enviada numa maquina
     * nao existia na outra: a miniatura sumia e voltava conforme o balanceador,
     * de forma intermitente e praticamente impossivel de diagnosticar pelo
     * suporte ("na minha funciona"). Guardar no banco — que ja e compartilhado,
     * ja e isolado por empresa e ja entra no backup — resolve sem servico novo.
     *
     * O que se prova aqui e a propriedade, nao a implementacao: o conteudo
     * devolvido pela rota e byte a byte o que foi enviado, e ele esta numa
     * linha de tabela que qualquer replica enxerga.
     */
    const dono = await autenticar('dono.alfa@teste.com.br');
    const enviado = await dono.upload('/api/v1/uploads', 'file', 'foto.png', PNG, 'image/png');

    const [linha] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ id: string; companyId: string; sizeBytes: number; octetos: number }>>`
        SELECT id, "companyId", "sizeBytes", octet_length(conteudo) AS octetos
          FROM "Upload" WHERE id = ${enviado.body.filename}`,
    );

    expect(linha, 'o arquivo precisa existir como linha no banco').toBeTruthy();
    expect(linha!.companyId).toBe(alfa.id);
    expect(Number(linha!.octetos)).toBe(PNG.length);
    expect(linha!.sizeBytes).toBe(PNG.length);

    // E o que a rota devolve e exatamente o que entrou.
    const baixado = await dono.get(`/api/v1/uploads/${alfa.id}/${enviado.body.filename}`);
    expect(Buffer.from(baixado.body).equals(PNG)).toBe(true);
  });

  it('excluir arquivo e do OWNER, e arquivo inexistente devolve 404', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const enviado = await dono.upload('/api/v1/uploads', 'file', 'foto.png', PNG, 'image/png');

    const motorista = await autenticar('motorista.alfa@teste.com.br');
    expect((await motorista.delete(`/api/v1/uploads/${enviado.body.filename}`)).status).toBe(403);

    expect((await dono.delete(`/api/v1/uploads/${enviado.body.filename}`)).status).toBeLessThan(300);
    expect((await dono.delete(`/api/v1/uploads/${enviado.body.filename}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Sondas
// ---------------------------------------------------------------------------

describe('sondas de saude', () => {
  it('a sonda de prontidao responde com o estado de cada dependencia', async () => {
    const c = await autenticar('dono.alfa@teste.com.br');
    const res = await c.get('/api/v1/health/ready');

    expect([200, 503]).toContain(res.status);
    expect(res.body.checks.database).toBe('ok');
    // Banco fora e "nao pronto"; cache fora e degradado. A distincao existe
    // para o orquestrador nao derrubar o contentor por causa do Redis.
    expect(res.status).toBe(200);
  });

  it('as integracoes declaram ausencia em vez de omitir', async () => {
    const c = await autenticar('dono.alfa@teste.com.br');
    const res = await c.get('/api/v1/health/features');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('billing');
    expect(res.body).toHaveProperty('whatsapp');
    // Um campo a mais aqui seria uma integracao inventada na tela.
    expect(Object.keys(res.body).sort()).toEqual(['billing', 'whatsapp']);
  });

  it('as metricas saem no formato do Prometheus e sem identificador de ninguem', async () => {
    const c = await autenticar('dono.alfa@teste.com.br');
    await c.get('/api/v1/ai/campaigns');

    const res = await c.get('/api/v1/health/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('vanpro_up 1');
    expect(res.text).toContain('vanpro_requisicao_duracao_ms_bucket');

    // As duas metricas que devem ficar em ZERO: violacao de tenant e falha de
    // auditoria. Qualquer valor acima e bug com potencial de vazamento ou de
    // trilha perdida — e a segunda so e visivel aqui, porque `audit()` nunca
    // lanca de proposito.
    expect(res.text).toMatch(/vanpro_violacoes_tenant_total 0/);
    expect(res.text).toMatch(/vanpro_falhas_auditoria_total 0/);

    // Cardinalidade: nenhum id de empresa ou de usuario vira rotulo. Metrica
    // com id vira diretorio de quem existe no sistema, exposto no endpoint.
    expect(res.text).not.toContain(alfa.id);
    expect(res.text).not.toMatch(/rota="[^"]*[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
