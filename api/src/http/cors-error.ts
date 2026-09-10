import { AppError } from '../lib/errors';

/**
 * Origem recusada pelo CORS.
 *
 * Classe propria para o handler global responder 403 com codigo estavel. Um
 * `new Error()` solto vindo do middleware de CORS caia no ramo de erro nao
 * tratado e virava 500 — o cliente recebia "erro interno" quando o problema
 * era configuracao de origem, e o log nao ligava uma coisa a outra.
 */
export class CorsOriginError extends AppError {
  constructor(readonly origin: string) {
    super(
      403,
      'CORS_ORIGIN_NOT_ALLOWED',
      'Origem não autorizada a acessar esta API.',
      undefined,
      'warn',
    );
  }
}
