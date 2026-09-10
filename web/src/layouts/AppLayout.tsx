import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BadgeDollarSign,
  Bus,
  CalendarRange,
  ClipboardList,
  Clock,
  FileClock,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPinned,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  Server,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { CompanySwitcher } from '../components/CompanySwitcher';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo } from '../components/Logo';
import { Modal } from '../components/ui';
import type { PermissionFlag, Role } from '../lib/types';
import { label } from '../lib/format';

interface NavItem {
  to: string;
  text: string;
  /** Rótulo curto para a barra inferior do celular. */
  short: string;
  icon: LucideIcon;
  roles: Role[];
  /** Menu escondido quando a flag está desligada — cortesia, não segurança. */
  permission?: PermissionFlag;
  /** Aparece na barra inferior do celular. No máximo quatro por papel. */
  primary?: boolean;
}

/**
 * Navegação declarada por papel.
 *
 * A ordem não é a do banco de dados nem a do menu antigo: é a do dia da pessoa.
 * O motorista vê "Rota" primeiro porque é o que ele abre às 6h; o dono vê
 * "Painel" porque a pergunta dele é o resultado do mês.
 */
const NAV: NavItem[] = [
  {
    to: '/app/painel',
    text: 'Painel',
    short: 'Painel',
    icon: LayoutDashboard,
    roles: ['OWNER', 'MANAGER'],
    primary: true,
  },
  {
    to: '/app/financeiro',
    text: 'Financeiro',
    short: 'Dinheiro',
    icon: BadgeDollarSign,
    roles: ['OWNER', 'MANAGER'],
    // Única área realmente escondida por flag: TODA rota de `/financial`
    // exige `canManageFinance`, então sem ela a tela seria 403 do topo ao pé.
    permission: 'canManageFinance',
    primary: true,
  },
  // Sem `permission`: LER a lista de alunos é liberado a toda a gestão pelo
  // servidor. Esconder o menu por causa da flag de escrita faria a gestora
  // concluir que a empresa não tem aluno cadastrado — a própria tela mostra a
  // lista e explica o que ela não pode alterar.
  {
    to: '/app/alunos',
    text: 'Alunos',
    short: 'Alunos',
    icon: Users,
    roles: ['OWNER', 'MANAGER'],
    primary: true,
  },
  // Sem `permission`: a tela tem abas com flags distintas (rotas e RH) e decide
  // sozinha o que mostrar.
  { to: '/app/frota', text: 'Frota', short: 'Frota', icon: Bus, roles: ['OWNER', 'MANAGER'] },
  // Consultar a equipe é liberado à gestão; convidar e alterar permissão exige
  // flag, e a própria tela cuida disso.
  {
    to: '/app/equipe',
    text: 'Equipe',
    short: 'Equipe',
    icon: ShieldCheck,
    roles: ['OWNER', 'MANAGER'],
  },
  // Mesma razão dos alunos: a agenda é legível para a gestão inteira.
  {
    to: '/app/fretamentos',
    text: 'Fretamentos',
    short: 'Fretes',
    icon: CalendarRange,
    roles: ['OWNER', 'MANAGER'],
  },
  {
    to: '/app/crm',
    text: 'Relacionamento',
    short: 'CRM',
    icon: MessageSquare,
    roles: ['OWNER', 'MANAGER'],
  },

  {
    to: '/app/privacidade-auditoria',
    text: 'Privacidade e auditoria',
    short: 'LGPD',
    icon: FileClock,
    roles: ['OWNER'],
  },

  {
    to: '/app/rota',
    text: 'Rota do dia',
    short: 'Rota',
    icon: ClipboardList,
    roles: ['DRIVER'],
    primary: true,
  },
  { to: '/app/ponto', text: 'Ponto', short: 'Ponto', icon: Clock, roles: ['DRIVER'], primary: true },
  {
    to: '/app/meus-ganhos',
    text: 'Meus ganhos',
    short: 'Ganhos',
    icon: Wallet,
    roles: ['DRIVER'],
    primary: true,
  },

  {
    to: '/app/embarque',
    text: 'Lista de embarque',
    short: 'Embarque',
    icon: ClipboardList,
    roles: ['ASSISTANT'],
    primary: true,
  },

  {
    to: '/app/acompanhamento',
    text: 'Acompanhar',
    short: 'Van',
    icon: MapPinned,
    roles: ['PARENT'],
    primary: true,
  },
  {
    to: '/app/faturas',
    text: 'Mensalidades',
    short: 'Faturas',
    icon: Receipt,
    roles: ['PARENT'],
    primary: true,
  },
  {
    to: '/app/privacidade',
    text: 'Meus dados (LGPD)',
    short: 'Dados',
    icon: ShieldCheck,
    roles: ['PARENT'],
    primary: true,
  },

  { to: '/app/plataforma', text: 'Plataforma', short: 'Infra', icon: Server, roles: ['SUPER_ADMIN'], primary: true },

  {
    to: '/app/configuracoes',
    text: 'Configurações',
    short: 'Ajustes',
    icon: Settings,
    roles: ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT', 'SUPER_ADMIN'],
  },
];

export function AppLayout() {
  const { user, logout, companyEpoch, switchingCompany, suspended } = useAuth();
  const navigate = useNavigate();
  const [maisAberto, setMaisAberto] = useState(false);

  const items = NAV.filter((item) => {
    if (!user) return false;
    if (!item.roles.includes(user.role)) return false;
    // OWNER tem todas as flags; MANAGER só vê o que o vínculo dele permite.
    if (item.permission && !user.permissions[item.permission]) return false;
    return true;
  });

  const naBarra = items.filter((i) => i.primary).slice(0, 4);
  const emMais = items.filter((i) => !naBarra.includes(i));

  const onLogout = async () => {
    await logout();
    navigate('/entrar', { replace: true });
  };

  // A empresa suspensa continua LENDO. O que para é a escrita — e a interface
  // diz isso de uma vez, em vez de deixar a pessoa descobrir botão por botão.
  const somenteLeitura = suspended || user?.contractStatus === 'ARCHIVED';
  const motivoLeitura = suspended
    ? 'A assinatura desta empresa está suspensa. Você continua vendo tudo, mas nenhuma alteração é aceita até o plano ser regularizado.'
    : 'Seu vínculo com esta empresa foi arquivado. O histórico continua visível, mas você não pode mais registrar nada aqui.';

  /*
   * Pagamento pendente NAO e somente-leitura: a frota continua trabalhando.
   *
   * O fim do periodo de teste deixa a empresa em `PAST_DUE` justamente porque o
   * produto ainda nao emite a fatura do proprio plano — cortar o acesso por
   * inadimplencia de um boleto que nunca foi enviado seria punir o cliente pelo
   * que falta no produto. O que cabe aqui e avisar, e avisar antes de alguem
   * descobrir por um erro.
   */
  const pagamentoPendente = user?.company?.tenantStatus === 'PAST_DUE';

  const desktopLink = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
      isActive
        ? 'bg-brand-500 font-semibold text-on-brand shadow-raised'
        : 'text-ink-200 hover:bg-ink-800'
    }`;

  return (
    <div className="min-h-dvh bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Logo />

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <CompanySwitcher />
            <div className="hidden text-right md:block">
              <p className="max-w-[12rem] truncate text-sm font-medium text-ink-50">{user?.name}</p>
              <p className="max-w-[12rem] truncate text-xs text-ink-400">
                {label.role(user?.role)}
                {user?.company ? ` · ${user.company.name}` : ''}
              </p>
            </div>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void onLogout()}
              aria-label="Sair da conta"
              title="Sair da conta"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-50"
            >
              <LogOut aria-hidden="true" size={20} />
            </button>
          </div>
        </div>

        {pagamentoPendente && !somenteLeitura ? (
          <div role="status" className="border-t border-warn-400/40 bg-warn-soft">
            <p className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2 text-xs font-medium text-warn-400 sm:text-sm">
              <Lock aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>Pagamento pendente.</strong> O período de teste terminou. Nada foi
                bloqueado — combine a regularização do plano para manter o acesso.
              </span>
            </p>
          </div>
        ) : null}

        {somenteLeitura ? (
          <div role="status" className="border-t border-warn-400/40 bg-warn-soft">
            <p className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2 text-xs font-medium text-warn-400 sm:text-sm">
              <Lock aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>Somente leitura.</strong> {motivoLeitura}
                {suspended ? (
                  <>
                    {' '}
                    <NavLink
                      to="/conta-suspensa"
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      Ver como regularizar
                    </NavLink>
                  </>
                ) : null}
              </span>
            </p>
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex max-w-7xl gap-7 px-4 py-5">
        <nav
          aria-label="Navegação principal"
          className="hidden w-56 shrink-0 lg:block"
        >
          <ul className="sticky top-24 flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={desktopLink}>
                  <item.icon aria-hidden="true" size={18} className="shrink-0" />
                  {item.text}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="conteudo" className="min-w-0 flex-1 pb-24 lg:pb-0">
          {/*
            A chave muda a cada troca de frota e desmonta a tela inteira. Sem
            isso, a lista carregada para a empresa anterior continuaria em tela
            depois da troca — dado de outra frota com aparência de atual.
          */}
          <div key={companyEpoch}>
            <Outlet />
          </div>
        </main>
      </div>

      {/*
        Barra inferior no celular, e não menu-sanduíche.

        O motorista usa isto de pé, com a van ligada, com uma mão só: o alcance
        do polegar é a parte de baixo da tela. Um menu escondido atrás de três
        risquinhos no canto superior esquerdo é o pior lugar possível para ele.
      */}
      <nav
        aria-label="Navegação principal"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-900/95 backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {naBarra.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors ${
                    isActive ? 'text-brand-600' : 'text-ink-400'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      aria-hidden="true"
                      size={22}
                      strokeWidth={isActive ? 2.4 : 1.8}
                      className="shrink-0"
                    />
                    <span className="truncate">{item.short}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {emMais.length > 0 ? (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMaisAberto(true)}
                aria-haspopup="dialog"
                aria-expanded={maisAberto}
                className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium text-ink-400"
              >
                <MoreHorizontal aria-hidden="true" size={22} strokeWidth={1.8} />
                <span>Mais</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <Modal
        open={maisAberto}
        title="Mais no VanPro"
        description="As demais áreas liberadas para o seu perfil nesta frota."
        onClose={() => setMaisAberto(false)}
      >
        <ul className="flex flex-col gap-1">
          {emMais.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                // Fecha a folha ao navegar: deixá-la aberta cobriria o conteúdo
                // recém-aberto no celular.
                onClick={() => setMaisAberto(false)}
                className={({ isActive }) =>
                  `flex min-h-[52px] items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${
                    isActive
                      ? 'bg-brand-500 font-semibold text-on-brand'
                      : 'text-ink-200 hover:bg-ink-800'
                  }`
                }
              >
                <item.icon aria-hidden="true" size={20} className="shrink-0" />
                {item.text}
              </NavLink>
            </li>
          ))}
        </ul>
      </Modal>

      {/*
        Troca de frota bloqueia a interface: não é filtro, é mudança de contexto
        inteira. Clicar em qualquer coisa no meio dela agiria sobre a empresa
        que está deixando de ser a ativa.
      */}
      {switchingCompany ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-busy="true"
          aria-live="assertive"
          aria-label="Trocando de frota"
        >
          <div className="rounded-card border border-ink-700 bg-ink-900 px-6 py-5 text-center shadow-float">
            <p className="text-sm font-semibold text-ink-50">Trocando de frota…</p>
            <p className="mt-1 max-w-xs text-sm text-ink-400">
              Abrindo uma sessão nova e recarregando os dados da empresa escolhida.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
