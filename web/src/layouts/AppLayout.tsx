import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BadgeDollarSign,
  Bus,
  CalendarRange,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Server,
  ShieldCheck,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import type { PermissionFlag, Role } from '../lib/types';
import { label } from '../lib/format';

interface NavItem {
  to: string;
  text: string;
  icon: LucideIcon;
  roles: Role[];
  /** Menu escondido quando a flag esta desligada — cortesia, nao seguranca. */
  permission?: PermissionFlag;
}

const NAV: NavItem[] = [
  { to: '/app/painel', text: 'Painel', icon: LayoutDashboard, roles: ['OWNER', 'MANAGER'] },
  {
    to: '/app/financeiro',
    text: 'Financeiro',
    icon: BadgeDollarSign,
    roles: ['OWNER', 'MANAGER'],
    permission: 'canManageFinance',
  },
  {
    to: '/app/alunos',
    text: 'Alunos',
    icon: Users,
    roles: ['OWNER', 'MANAGER'],
    permission: 'canManageRoutes',
  },
  // Sem `permission`: a tela tem duas abas com flags distintas (rotas e RH) e
  // decide sozinha o que mostrar.
  { to: '/app/frota', text: 'Frota', icon: Bus, roles: ['OWNER', 'MANAGER'] },
  // Consultar a equipe e liberado a gestao; convidar e alterar permissao exige
  // flag, e a propria tela cuida disso.
  { to: '/app/equipe', text: 'Equipe', icon: ShieldCheck, roles: ['OWNER', 'MANAGER'] },
  {
    to: '/app/fretamentos',
    text: 'Fretamentos',
    icon: CalendarRange,
    roles: ['OWNER', 'MANAGER'],
    permission: 'canManageRoutes',
  },
  { to: '/app/crm', text: 'CRM e IA', icon: MessageSquare, roles: ['OWNER', 'MANAGER'] },
  { to: '/app/rota', text: 'Rota do dia', icon: ClipboardList, roles: ['DRIVER'] },
  { to: '/app/ponto', text: 'Ponto', icon: Clock, roles: ['DRIVER'] },
  { to: '/app/meus-ganhos', text: 'Meus ganhos', icon: Wallet, roles: ['DRIVER'] },
  { to: '/app/embarque', text: 'Embarque', icon: ClipboardList, roles: ['ASSISTANT'] },
  { to: '/app/acompanhamento', text: 'Acompanhamento', icon: Bus, roles: ['PARENT'] },
  { to: '/app/faturas', text: 'Faturas', icon: BadgeDollarSign, roles: ['PARENT'] },
  { to: '/app/privacidade', text: 'Meus dados (LGPD)', icon: ShieldCheck, roles: ['PARENT'] },
  { to: '/app/plataforma', text: 'Plataforma', icon: Server, roles: ['SUPER_ADMIN'] },
  {
    to: '/app/configuracoes',
    text: 'Configurações',
    icon: Settings,
    roles: ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT', 'SUPER_ADMIN'],
  },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = NAV.filter((item) => {
    if (!user) return false;
    if (!item.roles.includes(user.role)) return false;
    // OWNER tem todas as flags; MANAGER so ve o que o vinculo dele permite.
    if (item.permission && !user.permissions[item.permission]) return false;
    return true;
  });

  const onLogout = async () => {
    await logout();
    navigate('/entrar', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
      isActive ? 'bg-brand-500 font-semibold text-ink-950' : 'text-ink-200 hover:bg-ink-800'
    }`;

  return (
    <div className="min-h-screen bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-ink-200 hover:bg-ink-800 lg:hidden"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Menu aria-hidden="true" size={22} />
          </button>

          <span className="text-base font-semibold text-brand-400">VanPro</span>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink-50">{user?.name}</p>
              <p className="text-xs text-ink-400">
                {label.role(user?.role)}
                {user?.company ? ` · ${user.company.name}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onLogout()}
              aria-label="Sair da conta"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-ink-200 hover:bg-ink-800"
            >
              <LogOut aria-hidden="true" size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-5">
        <nav
          id="menu-principal"
          aria-label="Navegação principal"
          className={`${menuOpen ? 'block' : 'hidden'} w-full shrink-0 lg:block lg:w-60`}
        >
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={linkClass} onClick={() => setMenuOpen(false)}>
                  <item.icon aria-hidden="true" size={18} />
                  {item.text}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="conteudo" className={`min-w-0 flex-1 ${menuOpen ? 'hidden lg:block' : 'block'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
