import { useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { Button } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

/**
 * Conta suspensa (`ACCOUNT_SUSPENDED`, HTTP 402).
 *
 * A leitura continua liberada no servidor; o que para e a escrita. A tela diz
 * exatamente isso em vez de deixar o usuario descobrir clicando em cada botao.
 */
export function Suspended() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthShell
      title="Conta suspensa"
      subtitle={
        user?.company
          ? `A empresa "${user.company.name}" está com o acesso suspenso.`
          : 'Esta empresa está com o acesso suspenso.'
      }
    >
      <p className="text-sm text-ink-200">
        Enquanto a situação não for regularizada, os dados continuam visíveis, mas nenhuma alteração
        é aceita: cadastros, lançamentos financeiros e batidas de ponto ficam bloqueados.
      </p>
      <p className="text-sm text-ink-400">
        Fale com o proprietário da conta para regularizar o plano. Se você é o proprietário, o canal
        de cobrança está no e-mail do contrato.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={() => navigate('/app')}>
          Voltar ao sistema (somente leitura)
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void logout().then(() => navigate('/entrar', { replace: true }));
          }}
        >
          Sair da conta
        </Button>
      </div>
    </AuthShell>
  );
}
