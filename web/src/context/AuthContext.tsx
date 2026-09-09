import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { api, onApiEvent, setCsrfToken } from '../lib/api';
import type { Me, PermissionFlag, Role } from '../lib/types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface LoginResult {
  /** Login com 2FA para na primeira etapa e devolve o desafio. */
  requires2FA?: boolean;
  challengeId?: string;
}

interface AuthValue {
  user: Me | null;
  status: Status;
  suspended: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  loginWithTwoFactor: (challengeId: string, code: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
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

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const data = await api.post<SessionResponse & LoginResult>('/auth/login', {
        email,
        password,
      });
      if (data.requires2FA) return { requires2FA: true, challengeId: data.challengeId };
      setCsrfToken(data.csrfToken);
      // `/auth/login` devolve so o usuario publico; permissoes e empresa vem do
      // `/auth/me`, que le o vinculo atual no banco.
      await loadMe();
      return {};
    },
    [loadMe],
  );

  const loginWithTwoFactor = useCallback(
    async (challengeId: string, code: string) => {
      const data = await api.post<SessionResponse>('/auth/2fa/login', { challengeId, code });
      setCsrfToken(data.csrfToken);
      await loadMe();
    },
    [loadMe],
  );

  const loginWithPasskey = useCallback(async () => {
    const challenge = await api.post<{
      options: PublicKeyCredentialRequestOptionsJSON;
      challengeId: string;
    }>('/auth/webauthn/login/options');
    const response = await startAuthentication({ optionsJSON: challenge.options });
    const data = await api.post<SessionResponse>('/auth/webauthn/login/verify', {
      challengeId: challenge.challengeId,
      response,
    });
    setCsrfToken(data.csrfToken);
    await loadMe();
  }, [loadMe]);

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

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      suspended,
      login,
      loginWithTwoFactor,
      loginWithPasskey,
      registerPasskey,
      logout,
      reload,
      hasRole: (...roles: Role[]) => (user ? roles.includes(user.role) : false),
      // Esconder menu por permissao e UX. A negacao que vale e a do servidor.
      hasPermission: (flag: PermissionFlag) => Boolean(user?.permissions?.[flag]),
    }),
    [user, status, suspended, login, loginWithTwoFactor, loginWithPasskey, registerPasskey, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
