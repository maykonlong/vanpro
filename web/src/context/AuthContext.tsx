import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { api, onApiEvent, setCsrfToken } from '../lib/api';
import type { CompanyMembership, Me, PermissionFlag, Role } from '../lib/types';

type Status = 'loading' | 'authenticated' | 'anonymous';

export interface LoginResult {
  /** Login com 2FA para na primeira etapa e devolve o desafio. */
  requires2FA?: boolean;
  challengeId?: string;
  /**
   * Mais de um vínculo ativo: a API confere a credencial mas NÃO emite sessão
   * até a pessoa dizer em qual frota vai operar.
   */
  requiresCompanySelection?: boolean;
  selectionToken?: string;
  companies?: CompanyMembership[];
  /** Última frota usada. Sugestão pré-selecionada, nunca escolha automática. */
  suggestedCompanyId?: string | null;
}

interface AuthValue {
  user: Me | null;
  status: Status;
  suspended: boolean;
  /** Frotas em que a pessoa pode entrar hoje. Vazio enquanto anônima. */
  companies: CompanyMembership[];
  /** Frota ativa da sessão. */
  currentCompanyId: string | null;
  /** Verdadeiro enquanto a troca de frota está em andamento. */
  switchingCompany: boolean;
  /**
   * Muda a cada troca de frota. Telas montadas a partir dele são refeitas do
   * zero — o dado em tela passou a ser de outra empresa.
   */
  companyEpoch: number;
  login: (email: string, password: string) => Promise<LoginResult>;
  loginWithTwoFactor: (challengeId: string, code: string) => Promise<LoginResult>;
  loginWithPasskey: () => Promise<LoginResult>;
  /** Conclui o login escolhendo a frota. */
  selectCompany: (selectionToken: string, companyId: string) => Promise<void>;
  /** Troca a frota ativa sem novo login. */
  switchCompany: (companyId: string) => Promise<void>;
  registerPasskey: () => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  hasPermission: (flag: PermissionFlag) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

interface SessionResponse {
  csrfToken: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [suspended, setSuspended] = useState(false);
  const [switchingCompany, setSwitchingCompany] = useState(false);
  const [companyEpoch, setCompanyEpoch] = useState(0);
  const booted = useRef(false);

  const loadMe = useCallback(async () => {
    const me = await api.get<Me>('/auth/me');
    setUser(me);
    setStatus('authenticated');
  }, []);

  /** Sessao real no boot: quem manda e o cookie, nao um flag guardado no cliente. */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        await loadMe();
      } catch {
        setUser(null);
        setStatus('anonymous');
      }
    })();
  }, [loadMe]);

  /**
   * O cliente de API avisa quando a sessao morreu em QUALQUER chamada. Sem esta
   * ponte, uma tela aberta continuaria mostrando dados de uma sessao que o
   * servidor ja revogou.
   */
  useEffect(
    () =>
      onApiEvent((event) => {
        if (event === 'unauthenticated') {
          setUser(null);
          setStatus('anonymous');
        }
        if (event === 'suspended') setSuspended(true);
      }),
    [],
  );

  /**
   * Desfecho comum de senha, 2FA e passkey.
   *
   * Quando a API pede escolha de empresa não há cookie de sessão nenhum ainda:
   * devolve o passo pendente para a tela e não toca no estado de autenticação.
   */
  const finishLogin = useCallback(
    async (data: SessionResponse & LoginResult): Promise<LoginResult> => {
      if (data.requiresCompanySelection) {
        return {
          requiresCompanySelection: true,
          selectionToken: data.selectionToken,
          companies: data.companies ?? [],
          suggestedCompanyId: data.suggestedCompanyId ?? null,
        };
      }
      setCsrfToken(data.csrfToken);
      // `/auth/login` devolve so o usuario publico; permissoes e empresa vem do
      // `/auth/me`, que le a SESSAO — inclusive qual frota ficou ativa.
      await loadMe();
      return {};
    },
    [loadMe],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const data = await api.post<SessionResponse & LoginResult>('/auth/login', {
        email,
        password,
      });
      if (data.requires2FA) return { requires2FA: true, challengeId: data.challengeId };
      return finishLogin(data);
    },
    [finishLogin],
  );

  const loginWithTwoFactor = useCallback(
    async (challengeId: string, code: string) => {
      const data = await api.post<SessionResponse & LoginResult>('/auth/2fa/login', {
        challengeId,
        code,
      });
      return finishLogin(data);
    },
    [finishLogin],
  );

  const loginWithPasskey = useCallback(async () => {
    const challenge = await api.post<{
      options: PublicKeyCredentialRequestOptionsJSON;
      challengeId: string;
    }>('/auth/webauthn/login/options');
    const response = await startAuthentication({ optionsJSON: challenge.options });
    const data = await api.post<SessionResponse & LoginResult>('/auth/webauthn/login/verify', {
      challengeId: challenge.challengeId,
      response,
    });
    return finishLogin(data);
  }, [finishLogin]);

  /** Segunda etapa do login de quem atende mais de uma frota. */
  const selectCompany = useCallback(
    async (selectionToken: string, companyId: string) => {
      const data = await api.post<SessionResponse>('/auth/select-company', {
        selectionToken,
        companyId,
      });
      setCsrfToken(data.csrfToken);
      await loadMe();
    },
    [loadMe],
  );

  /**
   * Troca a frota ativa sem novo login.
   *
   * A API revoga a sessão anterior e abre outra, então o `csrfToken` que volta
   * aqui é de uma sessão NOVA. Adotá-lo na mesma linha não é detalhe: seguir
   * mandando o antigo faria toda escrita seguinte responder 403.
   */
  const switchCompany = useCallback(
    async (companyId: string) => {
      setSwitchingCompany(true);
      try {
        const data = await api.post<{ csrfToken: string; companyId: string }>(
          '/auth/switch-company',
          { companyId },
        );
        setCsrfToken(data.csrfToken);
        // Papel, permissões e empresa mudam junto: relê tudo do servidor em vez
        // de remendar o estado local com o que a resposta trouxe.
        await loadMe();
        setCompanyEpoch((n) => n + 1);
      } finally {
        setSwitchingCompany(false);
      }
    },
    [loadMe],
  );

  const registerPasskey = useCallback(async () => {
    const options = await api.post<PublicKeyCredentialCreationOptionsJSON>(
      '/auth/webauthn/register/options',
    );
    const response = await startRegistration({ optionsJSON: options });
    await api.post('/auth/webauthn/register/verify', response);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Mesmo se o servidor recusar, o cliente esquece a sessao: manter a tela
      // logada depois de um "sair" e mentir para quem esta na frente do device.
      setCsrfToken(null);
      setUser(null);
      setStatus('anonymous');
      setSuspended(false);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      await loadMe();
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, [loadMe]);

  /*
   * A suspensao e conhecida no LOGIN, e nao so depois de um erro.
   *
   * A primeira versao daqui acendia a faixa de somente-leitura apenas quando
   * uma escrita voltava 402 `ACCOUNT_SUSPENDED`. Na pratica: a pessoa entrava
   * numa conta suspensa, navegava por um app aparentemente normal, preenchia
   * um cadastro inteiro e so descobria o estado da assinatura ao apertar
   * "Salvar" e perder o que digitou. O dado sempre esteve em `/auth/me`
   * (`company.tenantStatus`); ninguem olhava.
   *
   * O evento vindo da API continua valendo — cobre a suspensao que acontece
   * com a sessao ja aberta, sem esperar o proximo `reload()`.
   */
  const suspensaoConhecida = user?.company?.tenantStatus === 'SUSPENDED';

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      suspended: suspended || suspensaoConhecida,
      companies: user?.companies ?? [],
      currentCompanyId: user?.tenantId ?? null,
      switchingCompany,
      companyEpoch,
      login,
      loginWithTwoFactor,
      loginWithPasskey,
      selectCompany,
      switchCompany,
      registerPasskey,
      logout,
      reload,
      hasRole: (...roles: Role[]) => (user ? roles.includes(user.role) : false),
      // Esconder menu por permissao e UX. A negacao que vale e a do servidor.
      hasPermission: (flag: PermissionFlag) => Boolean(user?.permissions?.[flag]),
    }),
    [
      user,
      status,
      suspended,
      suspensaoConhecida,
      switchingCompany,
      companyEpoch,
      login,
      loginWithTwoFactor,
      loginWithPasskey,
      selectCompany,
      switchCompany,
      registerPasskey,
      logout,
      reload,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
