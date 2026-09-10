import { Link } from 'react-router-dom';

/**
 * Marca do produto.
 *
 * Um símbolo desenhado em SVG, e não uma imagem: pesa ~400 bytes, acompanha o
 * tema sem precisar de duas versões e continua nítido em qualquer densidade de
 * tela. O losango âmbar é o para-brisa da van visto de frente.
 */
export function Logo({ to = '/app', className = '' }: { to?: string | null; className?: string }) {
  const conteudo = (
    <>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-500 shadow-raised"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M4 15V8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V15"
            stroke="var(--vp-on-brand)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M4 12h16" stroke="var(--vp-on-brand)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="7.5" cy="17" r="1.75" fill="var(--vp-on-brand)" />
          <circle cx="16.5" cy="17" r="1.75" fill="var(--vp-on-brand)" />
        </svg>
      </span>
      <span className="text-base font-semibold tracking-tight text-ink-50">
        Van<span className="text-brand-600">Pro</span>
      </span>
    </>
  );

  const classe = `flex items-center gap-2.5 rounded-xl ${className}`;

  if (!to) {
    return <span className={classe}>{conteudo}</span>;
  }

  return (
    <Link to={to} className={`${classe} min-h-[44px]`} aria-label="VanPro — página inicial">
      {conteudo}
    </Link>
  );
}
