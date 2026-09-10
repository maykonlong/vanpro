import {
  expect,
  test as base,
  type BrowserContext,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';

/* ==========================================================================
   Ferramental comum da suíte.

   Regra que vale para tudo aqui: um helper nunca pode fazer um teste passar
   "por ausência". Se o pré-requisito não existe, o teste PULA dizendo o que
   falta — nunca segue em frente e conclui verde.
   ========================================================================== */

export type Papel =
  | 'OWNER'
  | 'MANAGER'
  | 'DRIVER'
  | 'ASSISTANT'
  | 'PARENT'
  | 'SUPER_ADMIN'
  | 'FREELANCER'
  | 'OWNER_TESTE'
  | 'OWNER_2'
  | 'OWNER_SUSPENSO'
  | 'DRIVER_SUSPENSO';

export interface Conta {
  email: string;
  senha: string;
  nome: string;
  empresa: string | null;
}

/** Senha única do seed de demonstração; sobrescrevível pelo ambiente. */
const SENHA = process.env.E2E_PASSWORD ?? 'VanPro@Demo2026';

export const CONTAS: Record<Papel, Conta> = {
  SUPER_ADMIN: {
    email: 'admin@vanpro.com.br',
    senha: SENHA,
    nome: 'Administrador da Plataforma',
    empresa: null,
  },
  OWNER: {
    email: 'roberto@transvan.com.br',
    senha: SENHA,
    nome: 'Roberto Almeida',
    empresa: 'TransVan Escolar',
  },
  OWNER_2: {
    email: 'helena@rotasegura.com.br',
    senha: SENHA,
    nome: 'Helena Prado',
    empresa: 'Rota Segura Transportes',
  },
  OWNER_TESTE: {
    email: 'sandra@caminhoseguro.com.br',
    senha: SENHA,
    nome: 'Sandra Vilela',
    empresa: 'Caminho Seguro Transporte Escolar',
  },
  /**
   * Frota inadimplente. O seed a mantem em `SUSPENDED` de proposito: o modo
   * somente-leitura e o caminho mais delicado do produto e, sem uma empresa
   * nesse estado, so podia ser lido no codigo — nunca exercitado.
   */
  OWNER_SUSPENSO: {
    email: 'gilberto@vaievem.com.br',
    senha: SENHA,
    nome: 'Gilberto Nazareth',
    empresa: 'Vai e Vem Transporte Escolar',
  },
  DRIVER_SUSPENSO: {
    email: 'anderson@vaievem.com.br',
    senha: SENHA,
    nome: 'Anderson Cruz',
    empresa: 'Vai e Vem Transporte Escolar',
  },
  MANAGER: {
    email: 'secretaria@transvan.com.br',
    senha: SENHA,
    nome: 'Patrícia Nunes',
    empresa: 'TransVan Escolar',
  },
  DRIVER: {
    email: 'carlos@transvan.com.br',
    senha: SENHA,
    nome: 'Carlos Oliveira',
    empresa: 'TransVan Escolar',
  },
  ASSISTANT: {
    email: 'monitora@transvan.com.br',
    senha: SENHA,
    nome: 'Sílvia Ramos',
    empresa: 'TransVan Escolar',
  },
  PARENT: {
    email: 'maria@exemplo.com.br',
    senha: SENHA,
    nome: 'Maria Rodrigues',
    empresa: 'TransVan Escolar',
  },
  FREELANCER: {
    email: 'joana@freelancer.com.br',
    senha: SENHA,
    nome: 'Joana Martins',
    empresa: null,
  },
};

export const PAPEIS = Object.keys(CONTAS) as Papel[];

// ---------------------------------------------------------------------------
// Sessão de teste: uma por teste, obtida pela API
// ---------------------------------------------------------------------------

/**
 * Por que a suíte NÃO faz login pela tela em todo teste.
 *
 * O cliente dispara `POST /auth/refresh` sempre que `GET /auth/me` responde 401
 * — inclusive quando não existe sessão nenhuma —, e essa rota gasta o limite de
 * 10 por 15 min do `authLimiter`. Uma dezena de cargas anônimas e o próprio
 * login passa a responder 429 mesmo com a senha certa. Isso é um defeito de
 * produto, registrado em `INVENTARIO.md` (D-1); aqui é só a razão de a suíte
 * entrar pela API, onde credencial certa não consome cota.
 *
 * Por que uma sessão NOVA por teste, e não uma guardada em arquivo:
 *
 * - o refresh é rotacionado a cada uso e a reapresentação de um token já girado
 *   revoga a FAMÍLIA inteira. Vários contextos partindo do mesmo instantâneo de
 *   cookie acabam derrubando a sessão uns dos outros;
 * - o servidor amarra a sessão ao `User-Agent`. Contexto criado com um
 *   User-Agent e reaproveitado em outro cai em `SESSION_DEVICE_MISMATCH` e
 *   revoga tudo.
 *
 * Sessão fresca por teste elimina os dois. Custa um POST por teste e nenhuma
 * cota de rate limit.
 *
 * O login PELA TELA continua exercitado onde ele é o assunto: `90-publico` e o
 * cenário do motorista freelancer em `09-plataforma-multiempresa`.
 */
async function autenticar(contexto: BrowserContext, conta: Conta): Promise<void> {
  /*
   * Começa sem cookie NENHUM.
   *
   * `browser.newContext()` dentro de um teste herda as opções de `use` — e isso
   * inclui o `storageState` da fixture. Sem esta limpeza, o contexto "novo"
   * nasceria com a sessão de outro papel, e o próprio `POST /auth/login` seria
   * recusado com `CSRF_TOKEN_MISSING`: com credencial de ambiente presente, a
   * API passa a exigir o cabeçalho de CSRF, e com razão.
   */
  await contexto.clearCookies();

  const page = await contexto.newPage();
  try {
    // Página de JSON puro: o SPA não sobe, então nenhum `/auth/refresh` anônimo
    // é disparado por este passo.
    await page.goto('/api/v1/health');

    const chamar = (caminho: string, corpo: unknown) =>
      page.evaluate(
        async ({ url, dados }) => {
          const r = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados),
          });
          return { status: r.status, texto: await r.text() };
        },
        { url: caminho, dados: corpo },
      );

    /*
     * Credencial certa não consome cota (`skipSuccessfulRequests`), mas se a
     * janela do `authLimiter` já estiver estourada por navegação anônima
     * anterior (defeito D-1), nem ela passa. Espera a janela e diz em voz alta
     * o que está esperando — falhar aqui soaria como "senha errada", e seria
     * mentira.
     */
    const limite = Date.now() + 5 * 60 * 1000;
    let login = await chamar('/api/v1/auth/login', {
      email: conta.email,
      password: conta.senha,
    });
    while (login.status === 429 && Date.now() < limite) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sessão] authLimiter esgotado (429) ao entrar como ${conta.email}. ` +
          'Aguardando 30s pela janela. Causa: carga anônima do SPA dispara /auth/refresh sem sessão (D-1).',
      );
      await new Promise((ok) => setTimeout(ok, 30_000));
      login = await chamar('/api/v1/auth/login', {
        email: conta.email,
        password: conta.senha,
      });
    }

    expect(
      login.status,
      `login de ${conta.email} falhou: ${login.texto.slice(0, 300)}`,
    ).toBeLessThan(400);

    const dados = JSON.parse(login.texto) as {
      requiresCompanySelection?: boolean;
      selectionToken?: string;
      companies?: Array<{ companyId: string; companyName: string }>;
    };

    if (dados.requiresCompanySelection) {
      const empresa = dados.companies?.[0];
      expect(empresa, `${conta.email} deveria ter frotas para escolher`).toBeTruthy();
      const escolha = await chamar('/api/v1/auth/select-company', {
        selectionToken: dados.selectionToken,
        companyId: empresa!.companyId,
      });
      expect(
        escolha.status,
        `escolha de empresa falhou: ${escolha.texto.slice(0, 200)}`,
      ).toBeLessThan(400);
    }
  } finally {
    await page.close();
  }
}

/**
 * Contexto novo já autenticado.
 *
 * Herda o `User-Agent` padrão do navegador — o mesmo que o contexto criado pela
 * fixture usa —, porque a sessão do servidor é amarrada a ele.
 */
export async function contextoComo(
  browser: Browser,
  papel: Papel,
  opcoes: { viewport?: { width: number; height: number }; baseURL?: string } = {},
): Promise<BrowserContext> {
  const contexto = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...(opcoes.viewport ? { viewport: opcoes.viewport } : {}),
    ...(opcoes.baseURL ? { baseURL: opcoes.baseURL } : {}),
  });
  await autenticar(contexto, CONTAS[papel]);
  return contexto;
}

/**
 * `test` já logado como o papel pedido.
 *
 * Substitui a fixture `storageState`, para que o contexto continue sendo criado
 * pelo Playwright — e assim `test.use({ viewport })` de cada spec continue
 * valendo.
 */
export function testeComo(papel: Papel) {
  return base.extend({
    storageState: async ({ browser, baseURL }, use) => {
      const contexto = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
      await autenticar(contexto, CONTAS[papel]);
      const estado = await contexto.storageState();
      await contexto.close();
      await use(estado);
    },
  });
}

/**
 * A navegação principal VISÍVEL na largura atual.
 *
 * `AppLayout` renderiza dois `<nav>` com o mesmo nome acessível ("Navegação
 * principal"): o menu lateral, escondido abaixo de `lg`, e a barra inferior,
 * escondida a partir de `lg`. Como `getByRole` só enxerga o que chega à árvore
 * de acessibilidade, o que está com `display:none` simplesmente não conta — e
 * em cada largura sobra exatamente um.
 *
 * Ancorar no papel e no nome, e não em `nav.fixed`, é o que impede o teste de
 * quebrar no próximo ajuste de classe utilitária.
 */
export function navegacaoPrincipal(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Navegação principal' });
}

/** Apelido que diz, na chamada, qual das duas se espera naquela largura. */
export const barraInferior = navegacaoPrincipal;

/**
 * Impede que a carga ANÔNIMA do SPA gaste a cota de login.
 *
 * Toda abertura de página sem sessão dispara `GET /auth/me` → 401 →
 * `POST /auth/refresh` → 401, e esse refresh consome o `authLimiter` (10 por
 * 15 min por IP). É o defeito D-1, descrito em `INVENTARIO.md`.
 *
 * O defeito é **asseverado explicitamente** em `90-publico.spec.ts` ("a carga
 * anônima dispara um refresh sem sessão"). Nos demais testes anônimos, onde o
 * assunto é outro, o refresh é respondido localmente para que a suíte continue
 * medindo o produto em vez de medir o rate limit. Nada além dessa chamada é
 * interceptado: nenhum outro `fetch` é encenado nesta suíte.
 */
export async function pouparCotaDeLogin(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/refresh', (rota) =>
    rota.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: 'Sem sessão para renovar (interceptado pelo E2E).' },
      }),
    }),
  );
}

/** Sufixo aleatório: o banco é compartilhado, então nada que a suíte cria
 *  pode colidir com o que outro spec (ou outra rodada) criou. */
export function sufixo(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Placa Mercosul válida e improvável de colidir: 3 letras + dígito + letra + 2 dígitos. */
export function placaAleatoria(): string {
  const L = () => 'ABCDEFGHIJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 25)];
  const D = () => String(Math.floor(Math.random() * 10));
  return `${L()}${L()}${L()}${D()}${L()}${D()}${D()}`;
}

/** CNPJ sintático válido (dígito verificador conferido), para o cadastro público. */
export function cnpjValido(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const dv = (nums: number[]) => {
    const pesos =
      nums.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = nums.reduce((acc, n, i) => acc + n * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

/**
 * Entra pela tela de verdade — nunca por injeção de cookie.
 *
 * O login é o primeiro botão do produto: se ele quebrar, é aqui que o
 * relatório precisa dizer isso, e não num `beforeEach` silencioso.
 */
export async function entrar(page: Page, conta: Conta): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel(/^E-mail/).fill(conta.email);
  await page.getByLabel(/^Senha/).fill(conta.senha);

  const resposta = page.waitForResponse(
    (r) => r.url().includes('/api/v1/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const login = await resposta;
  expect(login.status(), `o login de ${conta.email} precisa ser aceito pela API`).toBeLessThan(400);

  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/**
 * Login de quem atende mais de uma frota: a API confere a credencial mas NÃO
 * emite sessão até a pessoa dizer onde vai operar.
 */
export async function entrarEscolhendoEmpresa(
  page: Page,
  conta: Conta,
  empresa: string,
): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel(/^E-mail/).fill(conta.email);
  await page.getByLabel(/^Senha/).fill(conta.senha);

  const resposta = page.waitForResponse(
    (r) => r.url().includes('/api/v1/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const login = await resposta;
  expect(login.status()).toBeLessThan(400);

  const corpo = (await login.json()) as { requiresCompanySelection?: boolean };
  expect(
    corpo.requiresCompanySelection,
    'quem tem vínculo em duas frotas precisa cair na escolha de empresa',
  ).toBe(true);

  await expect(page.getByRole('heading', { name: /Em qual frota/i })).toBeVisible();
  await page.getByRole('radio', { name: new RegExp(empresa, 'i') }).check();

  const selecao = page.waitForResponse((r) => r.url().includes('/api/v1/auth/select-company'));
  await page.getByRole('button', { name: /Entrar nesta frota/i }).click();
  expect((await selecao).status()).toBeLessThan(400);
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

export async function sair(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.waitForURL(/\/entrar/);
}

// ---------------------------------------------------------------------------
// Prova de efeito
// ---------------------------------------------------------------------------

/**
 * Casa uma requisição pelo CAMINHO, ignorando host e query.
 *
 * Compara com o `pathname` e não com a URL inteira: assim `/settle` casa com
 * `/api/v1/financial/transactions/<id>/settle` sem que o teste precise montar o
 * id na mão, e um parâmetro de busca com o mesmo texto não gera falso positivo.
 */
export function rota(caminho: string) {
  return (url: string) => {
    try {
      return new URL(url).pathname.includes(caminho);
    } catch {
      return url.includes(caminho);
    }
  };
}

/**
 * Clica e prova que houve efeito de verdade: a requisição esperada saiu e o
 * servidor respondeu o que se espera. Assertiva de renderização sozinha
 * aprovaria um `onClick={() => {}}`.
 */
export async function clicarEsperando(
  page: Page,
  alvo: Locator,
  caminho: string,
  opcoes: { metodo?: string; statusEsperado?: number; statusMaximo?: number } = {},
): Promise<{ status: number; corpo: string }> {
  const { metodo, statusEsperado, statusMaximo = 400 } = opcoes;
  const casa = rota(caminho);
  const espera = page.waitForResponse(
    (r) => casa(r.url()) && (!metodo || r.request().method() === metodo),
    { timeout: 30_000 },
  );
  await alvo.click();
  const resposta = await espera;
  const corpo = await resposta.text().catch(() => '');

  if (typeof statusEsperado === 'number') {
    expect(
      resposta.status(),
      `${metodo ?? ''} ${caminho} deveria responder ${statusEsperado}. Corpo: ${corpo.slice(0, 300)}`,
    ).toBe(statusEsperado);
  } else {
    expect(
      resposta.status(),
      `o clique precisa produzir uma chamada aceita em ${caminho}. Corpo: ${corpo.slice(0, 300)}`,
    ).toBeLessThan(statusMaximo);
  }
  return { status: resposta.status(), corpo };
}

/** Espera uma chamada disparada por uma ação qualquer (não só clique). */
export async function esperandoRota<T>(
  page: Page,
  caminho: string,
  metodo: string | undefined,
  acao: () => Promise<T>,
): Promise<number> {
  const casa = rota(caminho);
  const espera = page.waitForResponse(
    (r) => casa(r.url()) && (!metodo || r.request().method() === metodo),
    { timeout: 30_000 },
  );
  await acao();
  return (await espera).status();
}

// ---------------------------------------------------------------------------
// Leitura direta da API (montagem de cenário e conferência do dado gravado)
// ---------------------------------------------------------------------------

/**
 * O token CSRF vive num cookie legível de propósito (double-submit assinado).
 * Escrita direta pela API só é usada para MONTAR cenário — nunca para
 * substituir o clique que o teste precisa provar.
 */
export async function csrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const c = cookies.find((k) => k.name === 'csrf_token');
  expect(c, 'o cookie csrf_token precisa existir depois do login').toBeTruthy();
  return decodeURIComponent(c!.value);
}

/**
 * Chamada de API a partir da PÁGINA, e não do contexto de requisição do Node.
 *
 * Dois motivos: `vanpro.localhost` só é resolvido pelo navegador (o
 * `getaddrinfo` do Node não conhece o nome sem entrada em `hosts`), e a
 * chamada sai com o mesmo cookie de sessão e o mesmo CSRF que o app usaria —
 * é a mesma porta, não uma porta de fundos.
 */
/** Chamada crua, para cenarios que precisam do STATUS e nao do corpo feliz. */
export async function chamarApi(
  page: Page,
  caminho: string,
  metodo: 'GET' | 'POST' | 'DELETE',
  corpo?: unknown,
): Promise<{ status: number; texto: string }> {
  const token = metodo === 'GET' ? null : await csrf(page);
  return page.evaluate(
    async ({ url, verbo, dados, token: csrfToken }) => {
      const headers: Record<string, string> = {};
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
      if (dados !== undefined && dados !== null) headers['Content-Type'] = 'application/json';
      const r = await fetch(url, {
        method: verbo,
        credentials: 'include',
        headers,
        body: dados !== undefined && dados !== null ? JSON.stringify(dados) : undefined,
      });
      return { status: r.status, texto: await r.text() };
    },
    { url: `/api/v1${caminho}`, verbo: metodo, dados: corpo ?? null, token },
  );
}

export async function apiGet<T>(page: Page, caminho: string): Promise<T> {
  const r = await chamarApi(page, caminho, 'GET');
  expect(r.status, `GET ${caminho} falhou: ${r.texto.slice(0, 200)}`).toBeLessThan(400);
  return JSON.parse(r.texto) as T;
}

export async function apiPost<T>(page: Page, caminho: string, corpo?: unknown): Promise<T> {
  const r = await chamarApi(page, caminho, 'POST', corpo ?? {});
  expect(r.status, `POST ${caminho} falhou: ${r.texto.slice(0, 300)}`).toBeLessThan(400);
  return (r.texto ? JSON.parse(r.texto) : undefined) as T;
}

export async function apiDelete(page: Page, caminho: string): Promise<number> {
  return (await chamarApi(page, caminho, 'DELETE')).status;
}

export interface PaginadoLeve<T> {
  items: T[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

/**
 * Escolhe a primeira opção REAL de um `<select>` alimentado por rede.
 *
 * O combo nasce só com o "Selecione" e ganha as opções quando a lista chega do
 * servidor. Selecionar sem esperar dá um formulário submetido com o campo
 * vazio — e o teste culparia o botão por um erro do próprio teste.
 */
export async function escolherPrimeiraOpcao(campo: Locator, minimo = 2): Promise<string> {
  await expect
    .poll(() => campo.locator('option').count(), {
      message: 'o seletor precisa receber as opções vindas do servidor',
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(minimo);
  const opcao = campo.locator('option').nth(1);
  const valor = (await opcao.getAttribute('value')) ?? '';
  expect(valor, 'a opção escolhida precisa ter valor').not.toBe('');
  await campo.selectOption(valor);
  return (await opcao.innerText()).trim();
}

/**
 * "R$ 1.234,56" -> 123456.
 *
 * Comparação de dinheiro na suíte é sempre em CENTAVOS (inteiro). Comparar a
 * string formatada esconderia diferença de arredondamento; comparar em reais
 * com ponto flutuante criaria uma.
 */
export function centavos(texto: string): number {
  const limpo = texto.replace(/[^\d,-]/g, '').replace(/\./g, '');
  const negativo = limpo.trim().startsWith('-');
  const digitos = limpo.replace(/-/g, '');
  const [reais, cents = '0'] = digitos.split(',');
  const valor = Number(reais || '0') * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
  return negativo ? -valor : valor;
}

// ---------------------------------------------------------------------------
// Acessibilidade e mobile
// ---------------------------------------------------------------------------

/** Nenhuma tela pode empurrar o conteúdo para fora da largura da viewport. */
export async function semRolagemHorizontal(page: Page): Promise<void> {
  const estouro = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, client: doc.clientWidth };
  });
  expect(
    estouro.scroll,
    `a página rola na horizontal (${estouro.scroll}px de conteúdo em ${estouro.client}px de tela)`,
  ).toBeLessThanOrEqual(estouro.client + 1);
}

/** Alvo de toque mínimo de 44×44 CSS px — o motorista usa isto de pé. */
export async function alvosDeToqueGrandes(alvos: Locator, minimo = 44): Promise<void> {
  const total = await alvos.count();
  expect(total, 'não há alvo nenhum para medir — medir nada não é aprovar').toBeGreaterThan(0);
  for (let i = 0; i < total; i++) {
    const alvo = alvos.nth(i);
    if (!(await alvo.isVisible())) continue;
    const caixa = await alvo.boundingBox();
    if (!caixa) continue;
    const texto = ((await alvo.textContent()) ?? (await alvo.getAttribute('aria-label')) ?? '')
      .trim()
      .slice(0, 40);
    expect(caixa.height, `alvo "${texto}" tem ${Math.round(caixa.height)}px de altura`).toBeGreaterThanOrEqual(
      minimo - 0.5,
    );
    expect(caixa.width, `alvo "${texto}" tem ${Math.round(caixa.width)}px de largura`).toBeGreaterThanOrEqual(
      minimo - 0.5,
    );
  }
}

/** O foco precisa ser VISÍVEL: contorno ou sombra desenhados pelo navegador. */
export async function focoVisivel(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const temOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0;
    const temSombra = s.boxShadow !== 'none' && s.boxShadow.trim().length > 0;
    return temOutline || temSombra;
  });
}

/** A tela nunca pode ficar sem carregando, sem conteúdo e sem erro. */
export async function telaNaoFicaMuda(page: Page): Promise<void> {
  const conteudo = page.locator('main').first();
  await expect(conteudo).toBeVisible();
  const texto = (await conteudo.innerText()).trim();
  expect(texto.length, 'a tela não pode renderizar vazia').toBeGreaterThan(0);
}

/** Nenhuma tela do produto pode terminar num erro de runtime no console. */
export function coletarErrosDeConsole(page: Page): string[] {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  return erros;
}
