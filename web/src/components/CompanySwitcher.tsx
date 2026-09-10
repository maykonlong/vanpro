import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronDown } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useAction } from '../hooks/useResource';
import { label } from '../lib/format';
import { homeForRole } from '../lib/routes';
import { InlineError } from './ui';

/**
 * Seletor de frota do cabeçalho.
 *
 * Só existe para quem atende mais de uma empresa — o motorista freelancer que
 * trabalha para duas frotas. Para quem tem uma só, um menu que nunca muda nada
 * seria ruído.
 *
 * A frota ativa fica visível o tempo todo, e não escondida atrás do menu:
 * operar na empresa errada sem perceber é exatamente o risco que este
 * componente existe para evitar.
 */
export function CompanySwitcher() {
  const { companies, currentCompanyId, switchCompany, switchingCompany, user } = useAuth();
  const navigate = useNavigate();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc: menu preso aberto no celular cobre o
  // conteúdo e não há como sair dele.
  useEffect(() => {
    if (!open) return;
    const onClickFora = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickFora);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickFora);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (companies.length <= 1) return null;

  const ativa = companies.find((c) => c.companyId === currentCompanyId) ?? null;

  const onEscolher = async (companyId: string) => {
    if (companyId === currentCompanyId) {
      setOpen(false);
      return;
    }
    const destino = companies.find((c) => c.companyId === companyId);
    const feito = await action.run(async () => {
      await switchCompany(companyId);
      return true;
    });
    if (!feito) return;
    setOpen(false);
    // O papel pode ser outro nesta frota (dona numa, motorista na outra). Se
    // mudou, a tela atual pode nem existir para o papel novo: leva para a
    // inicial dele em vez de entregar um 403.
    if (destino && user && destino.role !== user.role) {
      navigate(homeForRole(destino.role), { replace: true });
    }
  };

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switchingCompany}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Frota ativa: ${ativa?.companyName ?? 'nenhuma'}. Trocar de frota`}
        className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-50 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Building2 aria-hidden="true" size={18} className="shrink-0 text-brand-400" />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[11px] font-normal text-ink-400">Frota ativa</span>
          <span
            data-testid="frota-ativa"
            className="max-w-[9rem] truncate font-medium sm:max-w-[14rem]"
          >
            {ativa?.companyName ?? 'Nenhuma frota ativa'}
          </span>
        </span>
        <ChevronDown aria-hidden="true" size={16} className="shrink-0 text-ink-400" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Escolha a frota em que você vai operar"
          className="absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-ink-700 bg-ink-900 p-2 shadow-xl"
        >
          <p className="px-2 pb-2 pt-1 text-xs text-ink-400">
            Tudo que você vê e registra pertence à frota escolhida aqui.
          </p>

          <InlineError message={action.error} />

          <ul className="flex flex-col gap-1">
            {companies.map((empresa) => {
              const atual = empresa.companyId === currentCompanyId;
              return (
                <li key={empresa.companyId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={atual}
                    disabled={switchingCompany}
                    onClick={() => void onEscolher(empresa.companyId)}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      atual ? 'bg-ink-800 text-ink-50' : 'text-ink-200 hover:bg-ink-800'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{empresa.companyName}</span>
                      <span className="block text-xs text-ink-400">
                        {label.role(empresa.role)}
                        {empresa.status === 'ARCHIVED' ? ' · vínculo arquivado (só leitura)' : ''}
                      </span>
                    </span>
                    {atual ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-brand-400">
                        <Check aria-hidden="true" size={16} />
                        Ativa
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
