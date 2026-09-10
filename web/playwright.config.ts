import { defineConfig } from '@playwright/test';

/**
 * E2E contra a pilha REAL, em modo produção, servida em
 * https://vanpro.localhost:8443 (a 8080 só redireciona).
 *
 * Sem stub de rede: teste que só confere renderização passa com o botão morto —
 * e foi assim que "salvo!" sem salvar chegou a produção. Cada spec clica e
 * depois prova o efeito (a requisição saiu, o estado mudou, o dado mudou).
 */
export default defineConfig({
  testDir: './e2e',

  /*
   * Zera os contadores de rate limit acumulados pela propria suite (e so eles).
   * Ver `e2e/limites.ts` para o porque — em resumo: 90 cenarios de um usuario so
   * estouravam a cota geral no meio da rodada e pintavam de vermelho testes de
   * tela que nao tinham defeito nenhum.
   */
  globalSetup: './e2e/limites.ts',

  /*
   * O banco é COMPARTILHADO entre os specs e a suíte escreve nele de verdade.
   * Paralelismo aqui não daria velocidade, daria intermitência: dois specs
   * mexendo no mesmo aluno, no mesmo veículo e no mesmo DRE ao mesmo tempo.
   * Teste que falha às vezes é pior que teste que falta.
   */
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://vanpro.localhost:8443',

    /*
     * O certificado é de uma CA local, que o Chromium do Playwright não conhece.
     *
     * ATENÇÃO AO QUE ISTO **NÃO** SIGNIFICA: aceitar qualquer certificado aqui
     * é uma concessão de FERRAMENTA, para o navegador de teste conseguir abrir
     * a página — não é, e nunca deve ser lida como, prova de que o TLS está
     * correto. A validade da cadeia, o protocolo, a cifra e o HSTS são medidos
     * por `infra/scripts/verificar-deploy.sh`, que fala com o servidor sem
     * atalho nenhum. Um teste de interface que aceita qualquer certificado,
     * usado como evidência de TLS, seria exatamente o "verde que não mediu
     * nada".
     */
    ignoreHTTPSErrors: true,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
  },

  /*
   * UM projeto só, e sem `devices[...]`.
   *
   * Um projeto só porque o celular não pode ser uma segunda execução da suíte
   * inteira: isso dobraria a escrita no banco compartilhado e poria as duas
   * cópias competindo pelo mesmo aluno. As telas que o motorista e o monitor
   * usam de pé são exercitadas em 375 px dentro dos próprios specs.
   *
   * Sem `devices[...]` porque o servidor amarra a sessão ao `User-Agent`
   * (`SESSION_DEVICE_MISMATCH` revoga a família inteira quando ele muda).
   * Contexto criado pela fixture e contexto criado à mão dentro de um teste
   * precisam apresentar o MESMO User-Agent, e o jeito de garantir isso é não
   * sobrescrevê-lo em lugar nenhum. O que interessava de `Desktop Chrome` era
   * o tamanho da janela, e esse fica declarado abaixo.
   */
  projects: [{ name: 'chromium', use: { viewport: { width: 1280, height: 720 } } }],

  /*
   * Sem `webServer`: a pilha já está no ar em modo produção (nginx + API +
   * Postgres + Redis via compose). Subir um Vite de desenvolvimento ao lado
   * testaria um artefato que não é o que vai para o servidor.
   */
});
