import { currentTenantId } from './request-context';
import { TenantContextMissingError } from './prisma';

/**
 * A empresa dona da operacao atual.
 *
 * Existe por causa de um atrito real entre duas coisas certas: o guard do
 * Prisma preenche `companyId` sozinho em runtime, mas o tipo gerado pelo Prisma
 * continua exigindo o campo na escrita. As saidas ruins seriam `as any` (some
 * com a checagem de todos os outros campos) ou um `@default("")` no schema
 * (faz o desconhecido virar valor valido gravado no banco).
 *
 * A saida escolhida deixa a empresa VISIVEL no ponto da escrita — quem revisa o
 * diff ve de quem e o dado — e o guard confere se bate com o contexto,
 * recusando a gravacao se divergir. Verificar e mais forte que injetar em
 * silencio: um controller que passasse a empresa errada seria bloqueado, e nao
 * corrigido sem aviso.
 */
export function tenantId(): string {
  const id = currentTenantId();
  if (!id) throw new TenantContextMissingError('escrita', 'tenantId()');
  return id;
}
