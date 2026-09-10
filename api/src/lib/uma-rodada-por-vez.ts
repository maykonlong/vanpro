/**
 * Uma rodada por vez.
 *
 * O `node-cron` nao espera a rodada anterior terminar: se o job e assincrono e
 * passa do intervalo, o tick seguinte entra por cima, e o seguinte, sem teto.
 *
 * O `guarded()` de `src/jobs/index.ts` cobria a outra metade do problema —
 * excecao dentro do job nao matar o agendador — e nao esta: em base grande, um
 * `purgeExpiredCredentials` que passe das 24h faz dois `deleteMany` da MESMA
 * janela rodarem juntos, disputando as mesmas linhas.
 *
 * Enquanto uma rodada esta em voo, a chamada seguinte devolve `undefined` sem
 * fazer nada. Tick perdido nao se acumula: a proxima rodada faz o mesmo
 * trabalho, porque os jobs sao idempotentes por requisito.
 *
 * O `finally` e a parte que importa. Rodada que lanca precisa soltar a trava,
 * senao a primeira falha de banco tranca o job ate o processo reiniciar — pior
 * que sobrepor, porque some sem log. Valor e rejeicao atravessam sem mudar,
 * para quem `await`a a rodada no teste ou no boot.
 *
 * A trava e por processo, nao distribuida: protege contra a sobreposicao de
 * ticks do MESMO agendador. Com varias replicas rodando cron, o lock precisa
 * ser compartilhado (Redis) — hoje o `ENABLE_CRON` deixa isso a cargo de quem
 * opera, ligando o cron numa instancia so.
 */
export function umaRodadaPorVez<A extends unknown[], R>(
  rodada: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | undefined> {
  let rodando = false;

  return async function rodadaExclusiva(...args: A): Promise<R | undefined> {
    if (rodando) return undefined;
    rodando = true;
    try {
      return await rodada(...args);
    } finally {
      rodando = false;
    }
  };
}
