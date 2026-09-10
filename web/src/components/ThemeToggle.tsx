import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '../context/ThemeContext';
import type { ThemeChoice } from '../context/ThemeContext';

const CICLO: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const TEXTO: Record<ThemeChoice, string> = {
  system: 'seguindo o sistema',
  light: 'claro',
  dark: 'escuro',
};

/**
 * Alterna claro → escuro → sistema.
 *
 * Um botão só, e não três: o estado atual está escrito no `aria-label` e no
 * `title`, então quem usa leitor de tela ouve onde está e para onde vai, sem
 * precisar de um menu inteiro para uma escolha de três valores.
 */
export function ThemeToggle() {
  const { choice, resolved, setChoice } = useTheme();
  const proximo = CICLO[choice];
  const Icone = choice === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={() => setChoice(proximo)}
      aria-label={`Aparência: ${TEXTO[choice]}. Trocar para ${TEXTO[proximo]}.`}
      title={`Aparência: ${TEXTO[choice]}`}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-50"
    >
      <Icone aria-hidden="true" size={20} />
    </button>
  );
}
