import { Card } from './ui';

/**
 * Bloco honesto para quando a flag do vinculo nao autoriza a area.
 *
 * Some o dado, aparece a explicacao — nunca um painel zerado, que o usuario
 * leria como "a empresa nao tem movimento".
 */
export function PermissionNotice({ area }: { area: string }) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-ink-50">{area} indisponível para o seu perfil</h2>
      <p className="mt-2 text-sm text-ink-400">
        Seu vínculo com esta empresa não tem a permissão necessária para ver esta área. Peça ao
        proprietário da conta para habilitá-la em Equipe. Os números não aparecem aqui porque
        mostrar zero seria pior que mostrar nada.
      </p>
    </Card>
  );
}

/** Integracao sem credencial (`FEATURE_DISABLED`, HTTP 503). */
export function FeatureDisabledNotice({ feature, detail }: { feature: string; detail?: string }) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-ink-50">{feature} não está configurada</h2>
      <p className="mt-2 text-sm text-ink-400">
        {detail ??
          `A integração "${feature}" não tem credenciais neste ambiente. O sistema não simula a operação: enquanto ela não for configurada, a função permanece indisponível.`}
      </p>
    </Card>
  );
}
