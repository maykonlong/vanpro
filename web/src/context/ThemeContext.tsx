import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Tema claro/escuro.
 *
 * O padrão é `sistema`: o motorista que abre o app às 6h com o celular no modo
 * noturno não deveria tomar um flash branco na cara. A escolha explícita fica
 * no `localStorage` porque é conveniência de aparelho — não é dado da sessão,
 * não é segredo e não precisa acompanhar o usuário entre dispositivos.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'vanpro:tema';

interface ThemeValue {
  /** O que a pessoa escolheu (pode ser "sistema"). */
  choice: ThemeChoice;
  /** O que está de fato pintado na tela agora. */
  resolved: 'light' | 'dark';
  setChoice: (value: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Navegador com armazenamento bloqueado (aba anônima, política de site):
    // o tema do sistema resolve, e insistir quebraria o app inteiro.
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' =
    choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    // A barra do navegador no celular acompanha o tema; sem isto fica um filete
    // escuro em cima de uma tela clara.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0a0e15' : '#faf9f6');
  }, [resolved]);

  const setChoice = useCallback((value: ThemeChoice) => {
    setChoiceState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Sem persistência, a escolha vale só para esta aba. Melhor que travar.
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  return ctx;
}
