import type { Router } from 'express';
import { env } from '../config/env';
import { MONTAGENS, type Montagem } from './routes';

/**
 * Especificacao OpenAPI derivada do ROUTER REAL.
 *
 * A primeira versao usava `swagger-jsdoc` lendo anotacoes nos controllers.
 * Como nenhum controller tinha anotacao, a pagina subia com zero rotas — uma
 * casca vazia que parecia documentacao. Pior que nao ter: quem abre confia.
 *
 * Aqui a lista sai da tabela `MONTAGENS` (a mesma que monta as rotas de fato)
 * cruzada com as camadas de rota de cada router. A consequencia importante e que
 * ela NAO PODE divergir do codigo: rota nova aparece sozinha, rota removida some
 * sozinha. O que este metodo nao consegue inferir — schema de corpo e de
 * resposta — fica declarado como desconhecido, em vez de inventado.
 *
 * Publicada apenas fora de producao (ver `app.ts`): indice de superficie de
 * ataque pronto e presente para quem esta sondando.
 */

interface RotaDescoberta {
  metodo: string;
  caminho: string;
  publico: boolean;
  tag: string;
}

/**
 * As camadas de rota do Express 5 expoem `route.path` (relativo ao router), mas
 * NAO expoem o prefixo em que o router foi montado — `layer.regexp` deixou de
 * existir e `matchers` sao funcoes opacas. Por isso o prefixo vem da tabela
 * `MONTAGENS`, que e a mesma fonte usada para montar de verdade: se um router
 * mudar de lugar, a documentacao muda junto, sem ninguem lembrar.
 */
function rotasDoRouter(m: Montagem): RotaDescoberta[] {
  const stack = (m.router as unknown as { stack?: Array<Record<string, any>> }).stack ?? [];
  const achadas: RotaDescoberta[] = [];

  for (const camada of stack) {
    const rota = camada.route;
    if (!rota) continue;
    const relativo: string = rota.path ?? '';
    const caminho = `${m.prefixo}${relativo}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
    for (const [metodo, ligado] of Object.entries(rota.methods ?? {})) {
      if (!ligado || metodo === '_all') continue;
      achadas.push({ metodo, caminho: caminho || '/', publico: m.publico, tag: tagDe(caminho) });
    }
  }
  return achadas;
}

export function descobrirRotas(): RotaDescoberta[] {
  return MONTAGENS.flatMap(rotasDoRouter).sort(
    (a, b) => a.caminho.localeCompare(b.caminho) || a.metodo.localeCompare(b.metodo),
  );
}

/** `/students/:id` no Express vira `/students/{id}` no OpenAPI. */
function paraOpenApi(caminho: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = caminho.replace(/:([A-Za-z0-9_]+)/g, (_m, nome: string) => {
    params.push(nome);
    return `{${nome}}`;
  });
  return { path, params };
}

const TAG_POR_PREFIXO: Array<[RegExp, string]> = [
  [/^\/auth/, 'Auth'],
  [/^\/(register|company|accept-invite)/, 'Empresa'],
  [/^\/students/, 'Alunos'],
  [/^\/(vehicles|drivers|timecards)/, 'Frota'],
  [/^\/financial/, 'Financeiro'],
  [/^\/charters/, 'Fretamento'],
  [/^\/(crm|ai)/, 'CRM'],
  [/^\/privacy/, 'Privacidade'],
  [/^\/uploads/, 'Arquivos'],
  [/^\/webhooks/, 'Webhooks'],
  [/^\/health/, 'Operacao'],
];

function tagDe(caminho: string): string {
  return TAG_POR_PREFIXO.find(([re]) => re.test(caminho))?.[1] ?? 'Outros';
}

/**
 * Rotas do router de auth que respondem sem sessao. O router inteiro e montado
 * na area publica, mas metade dele exige `authenticate` internamente — dizer
 * "tudo publico" aqui seria documentacao errada.
 */
const AUTH_SEM_SESSAO = new Set([
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/2fa/login',
  '/auth/webauthn/login/options',
  '/auth/webauthn/login/verify',
]);

export function construirSpec(_router?: Router) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const { metodo, caminho, publico } of descobrirRotas()) {
    const { path, params } = paraOpenApi(caminho);
    paths[path] ??= {};
    const publica = publico && (!caminho.startsWith('/auth') || AUTH_SEM_SESSAO.has(caminho));

    paths[path][metodo] = {
      tags: [tagDe(caminho)],
      summary: `${metodo.toUpperCase()} ${path}`,
      description: publica
        ? 'Rota publica: responde sem sessao.'
        : 'Exige sessao ativa. O papel aceito e verificado no servidor; consulte o controller correspondente.',
      security: publica ? [] : [{ sessionCookie: [] }],
      parameters: params.map((nome) => ({
        name: nome,
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      })),
      responses: {
        '2XX': { description: 'Sucesso' },
        '4XX': {
          description: 'Erro de cliente (validacao, autorizacao, conflito)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'VanPro API',
      version: '3.0.0',
      description: [
        'ERP multi-tenant para gestão de frotas de transporte escolar.',
        '',
        '**Como esta página é gerada**: os caminhos abaixo são extraídos do router',
        'que o Express realmente montou, e por isso não podem divergir do código.',
        'Em compensação, o formato de corpo e de resposta **não** é inferido:',
        'onde ele não aparece, considere não documentado — e não presuma que é vazio.',
        '',
        '**Autenticação**: cookie `access_token` (httpOnly, SameSite=Strict), renovado',
        'por `POST /auth/refresh` com o cookie `refresh_token`. O token nunca',
        'trafega no corpo da resposta.',
        '',
        '**CSRF**: toda requisição que altera estado e carrega cookie de sessão exige',
        'o header `x-csrf-token` com o valor do cookie `csrf_token`.',
        '',
        '**Dinheiro**: sempre em centavos inteiros (`{ cents, formatted }`).',
        '',
        '**Isolamento**: o filtro por empresa é aplicado na camada de acesso a dados,',
        'não no controller. Requisição sem empresa no contexto falha fechada.',
      ].join('\n'),
    },
    servers: [{ url: `http://localhost:${env.PORT}/api/v1`, description: 'local' }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'access_token' },
      },
      schemas: {
        Erro: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'FORBIDDEN' },
                message: { type: 'string', example: 'Você não tem permissão para esta ação.' },
                requestId: { type: 'string' },
              },
            },
          },
        },
        Dinheiro: {
          type: 'object',
          properties: {
            cents: { type: 'integer', example: 48000 },
            formatted: { type: 'string', example: 'R$ 480,00' },
          },
        },
        Paginacao: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            perPage: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNext: { type: 'boolean' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Sessão, 2FA, passkeys e senha' },
      { name: 'Empresa', description: 'Cadastro, plano e equipe' },
      { name: 'Alunos' },
      { name: 'Frota', description: 'Veículos, motoristas e ponto' },
      { name: 'Financeiro', description: 'DRE, mensalidades, despesas e faturas' },
      { name: 'Fretamento' },
      { name: 'CRM', description: 'Notas, incidentes, chat e campanhas' },
      { name: 'Privacidade', description: 'Direitos do titular (LGPD Art. 18)' },
      { name: 'Arquivos' },
      { name: 'Webhooks' },
      { name: 'Operacao', description: 'Sondas de saúde e integrações ligadas' },
    ],
    paths,
  };
}
