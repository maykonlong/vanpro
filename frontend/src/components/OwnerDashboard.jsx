import React, { useState } from 'react';
import { 
  Bus, Users, MapPin, DollarSign, AlertCircle, Wrench, Package, 
  TrendingUp, Calendar, ArrowUpRight, ArrowDownRight, CheckCircle2, Clock, Sparkles
} from 'lucide-react';

export default function OwnerDashboard({ onOpenAiSimulator, onOpenFreightCalc }) {
  const [selectedVan, setSelectedVan] = useState('ALL');

  const summary = {
    activeVans: 3,
    totalStudents: 42,
    totalRoutes: 5,
    driversCount: 4,
    monthlyRevenue: 17200,
    pendingPayments: 3,
    maintenanceAlerts: 1,
    freightsCount: 2,
  };

  const actionableTasks = [
    { id: 1, type: 'RED', icon: AlertCircle, title: 'Inadimplência', desc: 'João (Aluno) está inadimplente há 12 dias - Enviar lembrete via WhatsApp' },
    { id: 2, type: 'YELLOW', icon: Clock, title: 'CNH Vencendo', desc: 'CNH de Carlos Oliveira vence em 20 dias (Renovação D necessária)' },
    { id: 3, type: 'BLUE', icon: Wrench, title: 'Manutenção Preventiva', desc: 'Van 01 (Ford Transit) próxima da troca de óleo em 800 km' },
    { id: 4, type: 'GREEN', icon: Package, title: 'Frete Confirmado', desc: 'TechCorp - Viagem Corporativa Sábado às 14:00 (R$ 1.100)' },
  ];

  const vansData = [
    { id: 'van01', name: 'Van 01 - Ford Transit 2024', plate: 'ABC-1D23', driver: 'Carlos Oliveira', revenue: 14800, expenses: 7150, profit: 7650, margin: 51.6, km: 42800, status: 'Em Rota' },
    { id: 'van02', name: 'Van 02 - Mercedes Sprinter', plate: 'XYZ-9E87', driver: 'Pedro Santos', revenue: 12400, expenses: 5200, profit: 7200, margin: 58.0, km: 78500, status: 'Livre / Frete' },
    { id: 'van03', name: 'Van 03 - Renault Master', plate: 'KRM-4F55', driver: 'Marcos Lima', revenue: 9800, expenses: 6100, profit: 3700, margin: 37.7, km: 112000, status: 'Revisão' },
  ];

  const filteredVans = selectedVan === 'ALL' ? vansData : vansData.filter(v => v.id === selectedVan);

  return (
    <div className="space-y-6">
      {/* Top Header & Fast Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass-panel p-6 rounded-2xl">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Operação Ativa de Hoje
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white">
            Painel do Frotista — TransVan
          </h1>
          <p className="text-slate-400 text-sm">
            Gerenciamento integrado de veículos, escolar, fretes e resultado financeiro DRE.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onOpenAiSimulator}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-4 py-2.5 rounded-xl font-medium shadow-lg glow-emerald transition-all"
          >
            <Sparkles className="w-4 h-4" />
            Simular Novos Alunos (IA)
          </button>
          <button
            onClick={onOpenFreightCalc}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2.5 rounded-xl font-medium transition-all"
          >
            <Package className="w-4 h-4 text-emerald-400" />
            Cotar Frete Avulso
          </button>
        </div>
      </div>

      {/* Grid de KPIs do Dia */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Vans Ativas</span>
            <Bus className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">{summary.activeVans}</div>
          <div className="text-xs text-emerald-400 flex items-center gap-1 mt-1 font-medium">
            <CheckCircle2 className="w-3 h-3" /> 100% da frota operando
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Alunos Transportados</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">{summary.totalStudents}</div>
          <div className="text-xs text-slate-400 mt-1">Distribuídos em 5 rotas</div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Faturamento Mês</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">R$ {summary.monthlyRevenue.toLocaleString('pt-BR')}</div>
          <div className="text-xs text-emerald-400 flex items-center gap-1 mt-1 font-medium">
            <ArrowUpRight className="w-3.5 h-3.5" /> +12% vs mês anterior
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Fretes Agendados</span>
            <Package className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">{summary.freightsCount}</div>
          <div className="text-xs text-purple-400 mt-1 font-medium">R$ 3.500 em receitas extras</div>
        </div>
      </div>

      {/* Assistente Operacional - O que resolver hoje */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-400" />
            O que preciso resolver hoje? (Assistente de Operação)
          </h2>
          <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-full font-semibold">
            {actionableTasks.length} Pendências
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {actionableTasks.map((task) => (
            <div key={task.id} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start gap-3 hover:border-slate-700 transition-all">
              <div className={`p-2 rounded-lg ${
                task.type === 'RED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                task.type === 'YELLOW' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                task.type === 'BLUE' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                <task.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-400 uppercase">{task.title}</div>
                <div className="text-sm font-medium text-slate-200 mt-0.5">{task.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Módulo DRE por Van */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Demonstrativo de Resultado (DRE por Van)
            </h2>
            <p className="text-xs text-slate-400">Descubra quanto cada van gera de receita, custo e margem líquida.</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Filtrar por Veículo:</span>
            <select
              value={selectedVan}
              onChange={(e) => setSelectedVan(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">Todas as Vans (Visão Geral)</option>
              <option value="van01">Van 01 - Ford Transit</option>
              <option value="van02">Van 02 - Mercedes Sprinter</option>
              <option value="van03">Van 03 - Renault Master</option>
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {filteredVans.map((van) => (
            <div key={van.id} className="glass-card p-5 rounded-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-white text-sm">{van.name}</h3>
                  <p className="text-xs text-slate-400">Placa: {van.plate} • Driver: {van.driver}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                  van.status === 'Em Rota' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                  van.status === 'Livre / Frete' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                  'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                }`}>
                  {van.status}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>Receita Total:</span>
                  <span className="font-bold text-emerald-400">R$ {van.revenue.toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Despesas Totais:</span>
                  <span className="font-bold text-red-400">R$ {van.expenses.toLocaleString('pt-BR')}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                  <span className="font-semibold text-slate-200">Resultado Operacional:</span>
                  <span className="text-sm font-extrabold text-emerald-400">
                    R$ {van.profit.toLocaleString('pt-BR')} ({van.margin}%)
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
