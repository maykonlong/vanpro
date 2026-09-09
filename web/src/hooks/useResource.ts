import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/api';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (value: T | null) => void;
}

/**
 * Leitura de recurso com os tres estados que toda tela precisa ter: carregando,
 * erro e conteudo. Estado "sem dado e sem erro" nao existe aqui de proposito —
 * era assim que tela vazia sem explicacao aparecia.
 *
 * `deps` e a lista de dependencias que refaz a busca (pagina, filtro, mes).
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // O fetcher e recriado a cada render; guardar em ref evita loop de efeito.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive || (err as Error)?.name === 'AbortError') return;
        setError(errorMessage(err));
        setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload, setData };
}

/** Executa uma acao de escrita controlando "enviando" e mensagem de erro. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      const withFields = err as { fieldErrors?: () => Record<string, string> };
      if (typeof withFields?.fieldErrors === 'function') setFieldErrors(withFields.fieldErrors());
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  return { run, pending, error, fieldErrors, reset };
}
