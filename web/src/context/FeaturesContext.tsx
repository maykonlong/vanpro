import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../lib/api';
import type { FeatureFlags } from '../lib/types';

/**
 * Integrações ligadas no ambiente (`GET /health/features`).
 *
 * Carregado UMA vez e compartilhado, para que qualquer tela possa desabilitar
 * o botão com explicação ANTES do clique, em vez de deixar a pessoa tomar um
 * 503 depois de preencher um formulário inteiro. Enquanto não sabemos, o
 * default é "não sei" — e não "tudo ligado": prometer uma função que não
 * existe é pior que dizer que ela está indisponível.
 */

interface FeaturesValue {
  flags: FeatureFlags | null;
  loading: boolean;
  /** `false` enquanto carrega ou se a sonda falhar. Ausência não é aprovação. */
  enabled: (feature: keyof FeatureFlags) => boolean;
}

const FeaturesContext = createContext<FeaturesValue | null>(null);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    api
      .get<FeatureFlags>('/health/features', undefined, controller.signal)
      .then((data) => {
        if (alive) setFlags(data);
      })
      .catch(() => {
        // Sonda fora do ar não vira "tudo desligado" nem "tudo ligado": fica
        // nulo, e a tela mostra o aviso de indisponibilidade.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const value = useMemo<FeaturesValue>(
    () => ({
      flags,
      loading,
      enabled: (feature) => Boolean(flags?.[feature]),
    }),
    [flags, loading],
  );

  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): FeaturesValue {
  const ctx = useContext(FeaturesContext);
  if (!ctx) throw new Error('useFeatures precisa estar dentro de <FeaturesProvider>.');
  return ctx;
}
