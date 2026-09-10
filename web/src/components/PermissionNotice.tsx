import { Eye, KeyRound, PlugZap } from 'lucide-react';

import { Card } from './ui';
import type { PermissionFlag } from '../lib/types';

const FLAG_TEXTO: Record<PermissionFlag, string> = {
  canManageFinance: 'Financeiro',
  canManageHR: 'Pessoas e RH',
  canManageRoutes: 'Rotas e cadastros',
};

/**
 * Área limitada pela permissão do vínculo.
 *
 * Dois casos bem diferentes, e o texto precisa dizer qual é — um aviso que
 * fala em "área oculta" acima de uma lista visível ensina a pessoa a não ler
 * os avisos:
 *
 * - `variante="oculta"`: o servidor recusa até a LEITURA (é o caso do
 *   financeiro, em que toda rota exige a flag). Não há dado nenhum na tela.
 * - `variante="leitura"` (padrão): a leitura é liberada e o que falta é o
 *   direito de alterar. A lista continua ali; sumiram os botões.
 *
 * Nos dois casos a explicação responde as três perguntas que a pessoa tem: o
 * que falta, quem libera e onde.
 */
export function PermissionNotice({
  area,
  flag,
  variante = 'leitura',
}: {
  area: string;
  flag?: PermissionFlag;
  variante?: 'oculta' | 'leitura';
}) {
  const oculta = variante === 'oculta';
  const Icone = oculta ? KeyRound : Eye;

  return (
    <Card>
      <div
        aria-hidden="true"
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-warn-soft text-warn-400"
      >
        <Icone size={20} />
      </div>

      <h2 className="text-base font-semibold text-ink-50">
        {oculta ? `${area} está fora das suas permissões` : `${area}: você está só de leitura`}
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        Seu vínculo com esta empresa não tem
        {flag ? (
          <>
            {' '}
            a permissão <strong className="text-ink-200">{FLAG_TEXTO[flag]}</strong>
          </>
        ) : (
          ' a permissão necessária'
        )}
        .{' '}
        {oculta
          ? 'Sem ela o servidor recusa até a consulta, então não há dado para mostrar aqui.'
          : 'Consultar continua liberado — a lista abaixo é real e está completa. O que some são os botões de criar, editar e excluir.'}{' '}
        Quem libera é o <strong className="text-ink-200">proprietário da conta</strong>, na tela
        Equipe: ele marca a permissão no seu nome e a área muda no próximo carregamento.
      </p>

      {oculta ? (
        <p className="mt-2 text-sm text-ink-400">
          Os números não aparecem aqui porque mostrar zero seria pior que mostrar nada: você leria
          como "a empresa não teve movimento".
        </p>
      ) : null}
    </Card>
  );
}

/** Integração sem credencial no ambiente (`FEATURE_DISABLED`, HTTP 503). */
export function FeatureDisabledNotice({ feature, detail }: { feature: string; detail?: string }) {
  return (
    <Card>
      <div
        aria-hidden="true"
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-800 text-ink-400"
      >
        <PlugZap size={20} />
      </div>
      <h2 className="text-base font-semibold text-ink-50">{feature} não está configurada</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        {detail ??
          `A integração "${feature}" não tem credenciais neste ambiente. O sistema não simula a operação: enquanto ela não for configurada, a função permanece indisponível — e dizer isso é mais honesto que aceitar o clique e falhar depois.`}
      </p>
    </Card>
  );
}
