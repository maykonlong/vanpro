import { AppError } from '../../lib/errors';

/**
 * A trava contra cobranca acidental.
 *
 * Todo o resto do modulo financeiro pode falhar e alguem deixa de emitir uma
 * fatura. Se ESTA falhar, o pai de um aluno de verdade recebe um Pix de
 * verdade a partir de um ambiente que era para ser de teste.
 *
 * A regra e uma so: o modo vem da CREDENCIAL, nunca do `APP_ENV`.
 *
 * O jeito mais comum de cobrar alguem sem querer e copiar o `.env` de producao
 * para a maquina de um desenvolvedor: a credencial real vem junto e o `APP_ENV`
 * continua dizendo `local`. Quem carrega a informacao de que dinheiro real se
 * move e a credencial, e e nela que a trava olha. O `docker-compose.yml` deste
 * repositorio admite explicitamente rodar a imagem de producao com
 * `APP_ENV=local` — entao "o ambiente diz que e local" nunca foi garantia.
 *
 * Detalhe do Asaas: ele NAO distingue sandbox por prefixo de chave, como a
 * Stripe faz com `sk_test_`/`sk_live_`. A mesma chave `$aact_...` aparece nos
 * dois lados; o que separa e o ENDPOINT. Por isso a trava le `ASAAS_API_URL`.
 */

export type ModoCobranca = 'sandbox' | 'producao' | 'desconhecida';

/** A palavra precisa ser improvavel de estar num shell por heranca. */
export const VARIAVEL_LIBERACAO = 'VANPRO_COBRANCA_REAL';
export const VALOR_LIBERACAO = 'sim-eu-quero-cobrar-de-verdade';

export class CobrancaBloqueada extends AppError {
  constructor(mensagem: string) {
    super(500, 'COBRANCA_BLOQUEADA', mensagem, undefined, 'error');
    this.name = 'CobrancaBloqueada';
  }
}

/**
 * `desconhecida` e um valor de verdade, nao um erro adiado: endpoint ilegivel
 * nunca pode ser tratado como seguro por omissao. O Asaas pode publicar um host
 * novo amanha, e o padrao do desconhecido precisa ser recusar — nao "assumir
 * que e sandbox porque nao reconheci".
 */
export function modoDoEndpoint(apiUrl: string | undefined): ModoCobranca {
  let host: string;
  try {
    host = new URL(String(apiUrl)).hostname.toLowerCase();
  } catch {
    return 'desconhecida';
  }

  // Comparacao por rotulo de host, jamais por `includes`: `includes('asaas.com')`
  // aprovaria `api.asaas.com.exemplo.net`, e `includes('sandbox')` aprovaria
  // `sandbox.atacante.com` como se fosse do Asaas.
  if (host === 'sandbox.asaas.com') return 'sandbox';
  if (host === 'api.asaas.com') return 'producao';
  return 'desconhecida';
}

export interface ResultadoTrava {
  modo: ModoCobranca;
  /** Dinheiro real se move nesta configuracao. */
  real: boolean;
}

/**
 * Chamada no boot do modulo financeiro. LANCA em vez de avisar: um servidor que
 * sobe com a credencial errada e so faz `logger.warn` e um servidor que cobra
 * enquanto ninguem le o log.
 *
 * Sem credencial nao ha o que travar — a feature ja responde 503
 * FEATURE_DISABLED por `features.billing`, e a trava se cala.
 */
export function exigirModoSeguro(
  ambiente: NodeJS.ProcessEnv = process.env,
): ResultadoTrava | null {
  const chave = ambiente.ASAAS_API_KEY?.trim();
  if (!chave) return null;

  const modo = modoDoEndpoint(ambiente.ASAAS_API_URL);

  if (modo === 'sandbox') return { modo, real: false };

  if (modo === 'desconhecida') {
    throw new CobrancaBloqueada(
      `ASAAS_API_KEY esta definida, mas ASAAS_API_URL ("${ambiente.ASAAS_API_URL ?? ''}") ` +
        'nao aponta para sandbox.asaas.com nem para api.asaas.com. Na duvida sobre o ' +
        'endpoint, a cobranca nao sobe: endpoint ilegivel pode ser o de producao.',
    );
  }

  const appEnv = ambiente.APP_ENV ?? 'local';
  if (appEnv === 'production') return { modo, real: true };

  // Comparacao com o valor EXATO, sem trim e sem normalizar caixa. Variavel de
  // ambiente e facil de herdar de um shell aberto ha dias, de um compose antigo,
  // de um CI — e `true` ou `1` sao valores que aparecem por acidente. Uma frase
  // especifica so esta ali se alguem a escreveu para este fim.
  if (ambiente[VARIAVEL_LIBERACAO] === VALOR_LIBERACAO) return { modo, real: true };

  throw new CobrancaBloqueada(
    `ASAAS_API_URL aponta para PRODUCAO (api.asaas.com) com APP_ENV=${appEnv}. ` +
      'Nessa configuracao a proxima cobranca sai de verdade, para uma pessoa de verdade. ' +
      `Para liberar, defina ${VARIAVEL_LIBERACAO}=${VALOR_LIBERACAO} — exatamente assim. ` +
      'Se voce nao pretendia cobrar ninguem agora, aponte ASAAS_API_URL para ' +
      'https://sandbox.asaas.com/api/v3 e use a chave de sandbox.',
  );
}
