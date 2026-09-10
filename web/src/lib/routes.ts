import type { Role } from './types';

/** Cada papel entra pela tela que ele realmente usa. */
export function homeForRole(role: Role): string {
  switch (role) {
    case 'OWNER':
    case 'MANAGER':
      return '/app/painel';
    case 'DRIVER':
      return '/app/rota';
    case 'ASSISTANT':
      return '/app/embarque';
    case 'PARENT':
      return '/app/acompanhamento';
    case 'SUPER_ADMIN':
      return '/app/plataforma';
    default:
      return '/app/configuracoes';
  }
}
