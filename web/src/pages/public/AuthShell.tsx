import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bus, ShieldCheck, Wallet } from 'lucide-react';

import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';

/**
 * Casca das telas públicas de autenticação.
 *
 * No celular é uma coluna só — nada de decoração empurrando o formulário para
 * baixo da dobra. No desktop a metade esquerda diz o que o produto faz, porque
 * quem chega aqui por um link de convite muitas vezes nunca ouviu falar do
 * VanPro e precisa saber onde está antes de digitar uma senha.
 */

const PILARES = [
  { Icone: Bus, texto: 'Rota, embarque e ponto no celular de quem está na rua.' },
  { Icone: Wallet, texto: 'Mensalidade, despesa e resultado do mês sem planilha.' },
  { Icone: ShieldCheck, texto: 'Trilha de auditoria e direitos de LGPD de verdade.' },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <header className="border-b border-ink-700 bg-ink-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Logo to="/" />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-8 lg:grid-cols-[1fr_28rem] lg:items-center lg:py-16">
        {/* Coluna de contexto: só no desktop, onde sobra espaço. */}
        <section className="hidden lg:block">
          <h2 className="max-w-lg text-3xl font-semibold leading-tight text-ink-50">
            A van escolar inteira em um lugar só — inclusive a parte que dá dinheiro.
          </h2>
          <ul className="mt-8 flex max-w-md flex-col gap-5">
            {PILARES.map(({ Icone, texto }) => (
              <li key={texto} className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-600"
                >
                  <Icone size={20} />
                </span>
                <p className="pt-2 text-sm leading-relaxed text-ink-400">{texto}</p>
              </li>
            ))}
          </ul>
        </section>

        <main
          id="conteudo"
          className="w-full rounded-card border border-ink-700 bg-ink-900 p-5 shadow-raised sm:p-7"
        >
          <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-400">{subtitle}</p>
          ) : null}
          <div className="mt-6 flex flex-col gap-4">{children}</div>
          {footer ? (
            <div className="mt-6 border-t border-ink-700 pt-5 text-sm text-ink-400">{footer}</div>
          ) : null}
        </main>
      </div>

      <footer className="border-t border-ink-700 bg-ink-900">
        <div className="mx-auto max-w-6xl px-4 py-3 text-xs text-ink-400">
          <Link
            to="/privacidade"
            className="inline-flex min-h-[44px] items-center rounded-xl text-brand-600 underline"
          >
            Política de Privacidade
          </Link>
        </div>
      </footer>
    </div>
  );
}
