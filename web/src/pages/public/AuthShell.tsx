import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Casca comum das telas publicas de autenticacao. */
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
    <div className="flex min-h-screen flex-col bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="border-b border-ink-800">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <Link to="/" className="inline-flex min-h-[44px] items-center text-lg font-semibold text-brand-400">
            VanPro
          </Link>
        </div>
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-ink-400">{subtitle}</p> : null}
        <div className="mt-6 flex flex-col gap-4">{children}</div>
        {footer ? <div className="mt-6 text-sm text-ink-400">{footer}</div> : null}
      </main>

      <footer className="border-t border-ink-800">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-400">
          <Link to="/privacidade" className="inline-flex min-h-[44px] items-center text-brand-400 underline">
            Política de Privacidade
          </Link>
        </div>
      </footer>
    </div>
  );
}
