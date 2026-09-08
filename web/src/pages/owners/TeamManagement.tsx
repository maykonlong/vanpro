import React, { useState } from 'react';
import { Users, Link as LinkIcon, Ban, ArchiveX, ShieldAlert, CheckCircle2, ShieldPlus, X, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Tooltip } from '../../components/Tooltip';

type TeamMember = {
  id: string;
  name: string;
  role: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'ARCHIVED';
  joinedAt: string;
  permissions?: { finance: boolean; hr: boolean; routes: boolean };
};

export const TeamManagement: React.FC = () => {
  const { user } = useAuth();
  const [inviteLink, setInviteLink] = useState('');
  const [contractType, setContractType] = useState<'FULL_TIME' | 'FREELANCE'>('FULL_TIME');
  const [editingManager, setEditingManager] = useState<TeamMember | null>(null);
  
  // Mock Data
  const [members, setMembers] = useState<TeamMember[]>([
    { id: '1', name: 'João Motorista', role: 'DRIVER', status: 'ACTIVE', joinedAt: '2026-01-10' },
    { id: '2', name: 'Maria Secretária', role: 'MANAGER', status: 'ACTIVE', joinedAt: '2026-09-08', permissions: { finance: true, hr: true, routes: false } },
    { id: '3', name: 'Carlos Antigo', role: 'DRIVER', status: 'ARCHIVED', joinedAt: '2025-05-10' },
  ]);

  if (user?.role !== 'OWNER') {
    return <div className="p-8 text-red-500 font-bold">Acesso restrito ao Dono da Frota.</div>;
  }

  const handleGenerateInvite = () => {
    const token = Math.random().toString(36).substring(2, 15);
    setInviteLink(`https://app.vanpro.com/invite/${token}?type=${contractType}`);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    alert('Link copiado para a área de transferência!');
  };

  const handleChangeStatus = (id: string, newStatus: TeamMember['status']) => {
    if(window.confirm(`Tem certeza que deseja mudar este contrato para ${newStatus}?`)) {
      setMembers(members.map(m => m.id === id ? { ...m, status: newStatus } : m));
    }
  };

  const togglePermission = (key: 'finance' | 'hr' | 'routes') => {
    if (editingManager && editingManager.permissions) {
      setEditingManager({
        ...editingManager,
        permissions: { ...editingManager.permissions, [key]: !editingManager.permissions[key] }
      });
    }
  };

  const savePermissions = () => {
    if (editingManager) {
      setMembers(members.map(m => m.id === editingManager.id ? { ...editingManager, role: 'MANAGER' } : m));
      setEditingManager(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 relative">
      {/* Modal de Permissões (Manager) */}
      {editingManager && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full relative">
            <button onClick={() => setEditingManager(null)} className="absolute top-6 right-6 text-slate-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-purple-500/20 p-3 rounded-xl border border-purple-500/30">
                <ShieldPlus className="w-8 h-8 text-purple-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Delegar Acessos</h2>
                <p className="text-sm text-slate-400">{editingManager.name}</p>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <h3 className="font-bold text-white">Financeiro (DRE)</h3>
                  <p className="text-xs text-slate-400">Ver faturamento e despesas</p>
                </div>
                <button onClick={() => togglePermission('finance')} className={`w-12 h-6 rounded-full transition-colors relative ${editingManager.permissions?.finance ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${editingManager.permissions?.finance ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <h3 className="font-bold text-white">Recursos Humanos</h3>
                  <p className="text-xs text-slate-400">Admitir e suspender equipe</p>
                </div>
                <button onClick={() => togglePermission('hr')} className={`w-12 h-6 rounded-full transition-colors relative ${editingManager.permissions?.hr ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${editingManager.permissions?.hr ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <h3 className="font-bold text-white">Gestão de Rotas</h3>
                  <p className="text-xs text-slate-400">Criar itinerários e veículos</p>
                </div>
                <button onClick={() => togglePermission('routes')} className={`w-12 h-6 rounded-full transition-colors relative ${editingManager.permissions?.routes ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${editingManager.permissions?.routes ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            <button onClick={savePermissions} className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-4 rounded-xl transition-colors">
              Salvar Permissões
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Users className="w-8 h-8 text-amber-500" />
        <h1 className="text-3xl font-bold text-white">Gestão da Equipe (RH)</h1>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 lg:p-8 flex flex-col gap-6 justify-between">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              Convidar novo membro
              <Tooltip content="Envie este link para o WhatsApp do Motorista. Ele criará a senha dele lá." />
            </h2>
            <p className="text-slate-400">Gere um link seguro para o motorista ou auxiliar ingressar na sua frota. O convite expira em 48h.</p>
          </div>
          
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button 
              onClick={() => setContractType('FULL_TIME')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${contractType === 'FULL_TIME' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
            >
              Fixo (CLT)
            </button>
            <button 
              onClick={() => setContractType('FREELANCE')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${contractType === 'FREELANCE' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
            >
              Diarista (Bico)
            </button>
            <div className="ml-2 flex items-center">
              <Tooltip content="Fixo: Acesso exclusivo à sua frota. Diarista: Permite que ele trabalhe para você e outras empresas ao mesmo tempo." />
            </div>
          </div>
        </div>
        
        <div className="flex w-full gap-2">
          {inviteLink ? (
            <>
              <input 
                type="text" 
                readOnly 
                value={inviteLink} 
                className="bg-slate-950 border border-slate-800 text-amber-500 px-4 py-3 rounded-xl w-full text-sm font-mono"
              />
              <button 
                onClick={handleCopy}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-6 py-3 rounded-xl transition-colors"
              >
                Copiar
              </button>
            </>
          ) : (
            <button 
              onClick={handleGenerateInvite}
              className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-3 rounded-xl flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <LinkIcon className="w-5 h-5" /> Gerar Link de Convite
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">Contratos da Frota</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-950/50 text-slate-400 text-sm">
              <tr>
                <th className="px-6 py-4 font-medium">Nome</th>
                <th className="px-6 py-4 font-medium">Cargo</th>
                <th className="px-6 py-4 font-medium">Status do Contrato</th>
                <th className="px-6 py-4 font-medium">Data de Ingresso</th>
                <th className="px-6 py-4 font-medium text-right">Ações de RH</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {members.map(member => (
                <tr key={member.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{member.name}</td>
                  <td className="px-6 py-4">
                    {member.role === 'MANAGER' ? (
                      <span className="inline-flex items-center gap-1 text-purple-400 font-bold"><Lock className="w-3 h-3"/> GESTOR</span>
                    ) : (
                      <span className="text-slate-300">{member.role}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {member.status === 'ACTIVE' && <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full text-xs font-bold"><CheckCircle2 className="w-3 h-3"/> ATIVO</span>}
                    {member.status === 'INVITED' && <span className="inline-flex items-center gap-1 text-blue-400 bg-blue-400/10 px-3 py-1 rounded-full text-xs font-bold">PENDENTE</span>}
                    {member.status === 'SUSPENDED' && <span className="inline-flex items-center gap-1 text-red-400 bg-red-400/10 px-3 py-1 rounded-full text-xs font-bold"><Ban className="w-3 h-3"/> SUSPENSO</span>}
                    {member.status === 'ARCHIVED' && <span className="inline-flex items-center gap-1 text-slate-400 bg-slate-800 px-3 py-1 rounded-full text-xs font-bold"><ArchiveX className="w-3 h-3"/> ARQUIVADO</span>}
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-sm">{member.joinedAt}</td>
                  <td className="px-6 py-4 flex gap-2 justify-end">
                    {member.status === 'ACTIVE' && (
                      <>
                        <button 
                          title="Promover a Gestor / Configurar Acessos"
                          onClick={() => setEditingManager(member.permissions ? member : { ...member, permissions: { finance: false, hr: false, routes: false } })}
                          className="p-2 text-purple-400 hover:bg-purple-400/10 rounded-lg transition-colors mr-4"
                        >
                          <ShieldPlus className="w-5 h-5" />
                        </button>
                        <button 
                          title="Suspender Temporariamente"
                          onClick={() => handleChangeStatus(member.id, 'SUSPENDED')}
                          className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        >
                          <Ban className="w-5 h-5" />
                        </button>
                        <button 
                          title="Arquivar / Desligar da Empresa"
                          onClick={() => handleChangeStatus(member.id, 'ARCHIVED')}
                          className="p-2 text-slate-400 hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          <ArchiveX className="w-5 h-5" />
                        </button>
                      </>
                    )}
                    {member.status === 'SUSPENDED' && (
                      <button 
                        title="Reativar Contrato"
                        onClick={() => handleChangeStatus(member.id, 'ACTIVE')}
                        className="text-emerald-400 hover:bg-emerald-400/10 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                      >
                        REATIVAR
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-xl flex gap-3 text-blue-300">
        <ShieldAlert className="w-6 h-6 flex-shrink-0" />
        <div className="text-sm">
          <strong>Modo Arquivo (Grace Period):</strong> Quando um membro é <em>Arquivado</em>, ele perde o acesso para enviar ou editar qualquer dado na sua frota. No entanto, por razões trabalhistas (CLT/PJ), ele retém acesso <strong>somente-leitura</strong> às planilhas (Timecards) e recibos gerados enquanto o contrato estava <em>ATIVO</em>.
        </div>
      </div>
    </div>
  );
};

export default TeamManagement;
