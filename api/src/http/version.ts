import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * "Eu conferi a imagem certa?"
 *
 * `gitSha` e um rotulo digitado no build (ARG GIT_SHA). Ele ja mentiu no
 * projeto irmao: o health anunciava um commit e a imagem carregava outro, e
 * dezessete verificacoes passaram contra a imagem errada sem que nada no
 * sistema pudesse contradizer o operador.
 *
 * Por isso o par. `conteudo` e derivado do que a imagem de fato carrega —
 * soma dos arquivos listados em `conteudo-carimbado.txt`, calculada durante o
 * build (ver api/Dockerfile). Rotulo e conteudo divergirem e o sinal de que o
 * build nao corresponde ao commit anunciado.
 *
 * Fora de uma imagem construida (ts-node, teste) o arquivo nao existe e a
 * resposta e `nao-carimbada` nos dois campos: e a resposta honesta, e nunca um
 * numero inventado que passaria por conferido.
 *
 * Nao mora em /health/live de proposito. Liveness e sonda quente — bate a cada
 * 15s, e pendurar leitura de disco nela e como se paga um reinicio em cascata
 * no dia em que o volume ficar lento.
 */
const router = Router();

const SEM_CARIMBO = 'nao-carimbada';

/** dist/http/version.js -> /app ; src/http/version.ts -> api/ . Mesmo alvo nos dois. */
const ARQUIVO_CARIMBO = path.resolve(__dirname, '..', '..', '.versao-conteudo');

/**
 * Lido uma vez, no import. O conteudo da imagem nao muda enquanto o processo
 * vive, e reler a cada requisicao so daria a um endpoint publico um I/O de
 * disco por chamada.
 */
function lerCarimbo(): string {
  try {
    const bruto = readFileSync(ARQUIVO_CARIMBO, 'utf8').trim();
    // Arquivo presente porem vazio e o caso que o projeto irmao nao previu: um
    // `RUN` que falhou pela metade deixa o arquivo criado e sem conteudo, e
    // devolver string vazia faria o verificador comparar contra nada e aprovar.
    return bruto === '' ? SEM_CARIMBO : bruto;
  } catch {
    return SEM_CARIMBO;
  }
}

const conteudo = lerCarimbo();
const gitSha = process.env.VANPRO_GIT_SHA?.trim() || SEM_CARIMBO;

router.get('/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ gitSha, conteudo });
});

export default router;
