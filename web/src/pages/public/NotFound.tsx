import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell';

export function NotFound() {
  return (
    <AuthShell
      title="404 — página não encontrada"
      subtitle="O endereço digitado não existe neste sistema."
      footer={
        <Link to="/" className="inline-flex min-h-[44px] items-center text-brand-400 underline">
          Voltar para a página inicial
        </Link>
      }
    >
      <p className="text-sm text-ink-400">
        Se você chegou aqui por um link do sistema, avise a equipe: é um link quebrado, não um erro
        seu.
      </p>
    </AuthShell>
  );
}
