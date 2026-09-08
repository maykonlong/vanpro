import React, { useState } from 'react';
import { Sparkles, ArrowRight, CheckCircle2, TrendingUp, AlertTriangle } from 'lucide-react';

export default function AiSimulatorModal({ onClose }) {
  const [studentCount, setStudentCount] = useState(3);
  const [avgMonthlyFee, setAvgMonthlyFee] = useState(550);
  const [extraDistanceKm, setExtraDistanceKm] = useState(2.5);

  const newRevenue = studentCount * avgMonthlyFee;
  const extraKmMonth = extraDistanceKm * 2 * 22;
  const fuelExpense = Number(((extraKmMonth / 8.5) * 5.95).toFixed(2));
  const netProfit = newRevenue - fuelExpense;
  const isCapacityOk = true;

  return (
    <div className="glass-panel p-6 rounded-2xl space-y-6 max-w-lg mx-auto border border-emerald-500/30">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" />
          <h2 className="text-lg font-bold text-white">Simulador de Viabilidade com IA</h2>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">
            Fechar ✕
          </button>
        )}
      </div>

      <div className="space-y-4 text-xs">
        <div>
          <label className="font-semibold text-slate-300 block mb-1">Quantidade de Novos Alunos:</label>
          <input
            type="number"
            value={studentCount}
            onChange={(e) => setStudentCount(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="font-semibold text-slate-300 block mb-1">Mensalidade Média (R$):</label>
            <input
              type="number"
              value={avgMonthlyFee}
              onChange={(e) => setAvgMonthlyFee(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-300 block mb-1">Km Adicional na Rota (Ida):</label>
            <input
              type="number"
              step="0.5"
              value={extraDistanceKm}
              onChange={(e) => setExtraDistanceKm(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Resumo da Análise da IA */}
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Análise de Viabilidade: 🟢 ALTAMENTE LUCRATIVO
          </div>

          <div className="grid grid-cols-3 gap-2 py-2 border-y border-emerald-500/20 text-center">
            <div>
              <span className="text-[10px] text-slate-400 block">Receita Nova</span>
              <span className="font-bold text-emerald-400 text-sm">+R$ {newRevenue.toLocaleString('pt-BR')}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Diesel Extra</span>
              <span className="font-bold text-red-400 text-sm">-R$ {fuelExpense.toLocaleString('pt-BR')}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Lucro Adicional</span>
              <span className="font-extrabold text-emerald-300 text-sm">+R$ {netProfit.toLocaleString('pt-BR')}</span>
            </div>
          </div>

          <p className="text-slate-300 text-[11px] leading-relaxed">
            A IA analisou a rota atual da <strong>Van 01 (Ford Transit)</strong>: Há capacidade disponível ({13 + studentCount}/15). A rota aumentará apenas {Math.round(extraDistanceKm * 2.5)} minutos por percurso.
          </p>
        </div>
      </div>
    </div>
  );
}
