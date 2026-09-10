import { execFileSync } from 'node:child_process';

/**
 * Zera os contadores de rate limit da pilha local antes de exercitar um cenario
 * publico.
 *
 * Por que isto existe: o limite de escrita publica e 5/hora POR IP, e toda a
 * suite sai do mesmo IP. Recuperacao de senha, redefinicao e cadastro juntos
 * ja estouram a cota, e a versao anterior destes testes respondia a isso com
 * `test.skip('... NAO verificado nesta rodada')`. Pular e honesto, mas o efeito
 * pratico era que os tres caminhos que criam conta e trocam senha — os mais
 * sensiveis do produto — passavam rodadas inteiras sem nunca terem sido
 * exercitados, e o relatorio ficava verde do mesmo jeito.
 *
 * O que este arquivo NAO faz: afrouxar o limite. A configuracao de producao
 * segue 5/hora; o teste que PROVA que o limite dispara continua existindo em
 * `10-negativas.spec.ts` e nao chama nada daqui. Aqui apenas apagamos a
 * contagem acumulada pela propria suite, que nao representa trafego real.
 */
function redis(...args: string[]): string {
  return execFileSync('docker', ['exec', 'vanpro-redis', 'redis-cli', ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();
}

/** Apaga as chaves de um prefixo de limite (`public-write`, `upload`, `auth`). */
export function zerarLimite(prefixo: string): void {
  const chaves = redis('--scan', '--pattern', `rl:${prefixo}:*`).split('\n').filter(Boolean);
  for (const chave of chaves) redis('DEL', chave);
}

/** Cota de escrita publica: cadastro de empresa e recuperacao de senha. */
export function liberarCotaPublica(): void {
  zerarLimite('public-write');
}

/** Cota de upload: 30/15min por usuario. */
export function liberarCotaUpload(): void {
  zerarLimite('upload');
}

/**
 * Setup global da suite.
 *
 * Alem de zerar a contagem acumulada antes de comecar, mantem a chave do
 * limitador GERAL (1000/15min por usuario) limpa enquanto a suite roda. Os
 * ~90 cenarios saem todos do mesmo usuario e do mesmo IP: por volta do minuto
 * seis a cota estourava e testes de tela passavam a falhar com 429 — falha que
 * nao diz nada sobre o produto e some quando se roda o spec sozinho, que e a
 * pior especie de teste vermelho.
 *
 * De novo: nao afrouxa nada. O limite continua 1000/15min em producao, e quem
 * PROVA que ele dispara e o cenario dedicado em `10-negativas.spec.ts`, que
 * gera o proprio estouro e nao depende deste arquivo.
 */
/**
 * Apaga as empresas criadas pelo teste de cadastro publico.
 *
 * O cenario "o cadastro cria a empresa de verdade" provisiona um tenant novo a
 * cada rodada — e nao havia nada devolvendo o banco ao estado anterior. Depois
 * de algumas execucoes, o ambiente de producao simulada tinha mais frotas de
 * teste do que frotas de demonstracao, e qualquer contagem global (empresas
 * ativas, receita da plataforma) passava a somar lixo de suite.
 *
 * Roda no inicio, e nao no fim: uma rodada interrompida no meio deixaria a
 * limpeza sem acontecer, e limpar na entrada tambem recolhe o que rodadas
 * passadas deixaram.
 */
function limparRastroDaSuite(): void {
  /*
   * Duas heranças, e a segunda demorou mais para aparecer que a primeira.
   *
   * As EMPRESAS vinham do cenário de cadastro público, que provisiona um tenant
   * novo por rodada. Os USUÁRIOS vêm do cenário de convite, que adiciona alguém
   * à equipe da TransVan a cada rodada — e esses foram empilhando até a equipe
   * passar de 21 pessoas, empurrar o proprietário para a segunda página e
   * derrubar um teste que nada tinha a ver com convite. Lixo de suíte não fica
   * parado: ele muda o resultado de outro teste, dias depois, por um caminho
   * que ninguém liga ao original.
   */
  const sql = `
    DELETE FROM "AuditLog"  WHERE "companyId" IN (SELECT id FROM "Company" WHERE name LIKE 'E2E Frota %');
    DELETE FROM "UserCompany" WHERE "companyId" IN (SELECT id FROM "Company" WHERE name LIKE 'E2E Frota %');
    DELETE FROM "UserCompany" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'e2e.%@exemplo.com.br');
    DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'e2e.%@exemplo.com.br');
    DELETE FROM "AuditLog" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'e2e.%@exemplo.com.br');
    DELETE FROM "PasswordResetToken" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'e2e.%@exemplo.com.br');
    DELETE FROM "User" WHERE email LIKE 'e2e.%@exemplo.com.br';
    DELETE FROM "Company" WHERE name LIKE 'E2E Frota %';
  `;
  execFileSync('docker', ['exec', 'vanpro-postgres', 'psql', '-U', 'postgres', '-d', 'vanpro', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

export default function globalSetup(): () => void {
  for (const prefixo of ['global', 'auth', 'public-write', 'upload']) zerarLimite(prefixo);
  limparRastroDaSuite();

  const timer = setInterval(() => {
    try {
      zerarLimite('global');
    } catch {
      // Redis fora do ar durante a suite ja vai aparecer como falha de teste
      // de verdade; nao ha por que derrubar o processo do runner aqui.
    }
  }, 20_000);

  return () => clearInterval(timer);
}
