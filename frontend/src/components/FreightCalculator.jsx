import React, { useState } from 'react';
import { Package, Calculator, DollarSign, Fuel, MapPin, CheckCircle, ArrowRight } from 'lucide-react';

export default function FreightCalculator({ onClose }) {
  const [distanceKm, setDistanceKm] = useState(45);
  const [hasToll, setHasToll] = useState(true);
  const [clientName, setClientName] = useState('Empresa Eventos BR');

  const fuelPrice = 5.95;
  const avgKmPerLiter = 8.5;

  const estimatedFuelCost = Number(((distanceKm / avgKmPerLiter) * fuelPrice).toFixed(2));
  const tollCost = hasToll ? 42.00 : 0;
  const baseCost = estimatedFuelCost + tollCost + 90.00;
  const suggestedPrice = Number((baseCost * 1.65).toFixed(2));
  const netProfit = Number((suggestedPrice - baseCost).toFixed(2));

  return (
    <div className="glass-panel p-6 rounded-2xl space-y-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-bold text-white">Calculadora Inteligente de Frete Avulso</h2>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">
            Fechar ✕
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1">Nome do Cliente / Serviço:</label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Distância Total (Ida e Volta - km):</label>
            <input
              type="number"
              value={distanceKm}
              onChange={(e) => setDistanceKm(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Possui Pedágio no Percurso?</label>
            <button
              onClick={() => setHasToll(!hasToll)}
              className={`w-full py-2 rounded-xl text-xs font-bold border transition-all ${
                hasToll ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              {hasToll ? 'Sim (R$ 42,00 est.)' : 'Não'}
            </button>
          </div>
        </div>

        {/* Resumo da Cotação Calculada */}
        <div className="glass-card p-4 rounded-xl space-y-2 border border-slate-800">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Composição de Custo e Preço</div>

          <div className="flex justify-between text-xs text-slate-300">
            <span>Combustível Estimado (Diesel):</span>
            <span className="font-bold text-slate-200">R$ {estimatedFuelCost.toLocaleString('pt-BR')}</span>
          </div>

          <div className="flex justify-between text-xs text-slate-300">
            <span>Pedágio + Taxa Operacional:</span>
            <span className="font-bold text-slate-200">R$ {(tollCost + 90).toLocaleString('pt-BR')}</span>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-xs font-semibold text-slate-400 block">Preço Sugerido (65% Margem):</span>
              <span className="text-xl font-extrabold text-emerald-400">R$ {suggestedPrice.toLocaleString('pt-BR')}</span>
            </div>

            <div className="text-right">
              <span className="text-xs font-semibold text-slate-400 block">Lucro Líquido:</span>
              <span className="text-sm font-bold text-emerald-300">R$ {netProfit.toLocaleString('pt-BR')}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => alert(`Frete confirmado para ${clientName} por R$ ${suggestedPrice}!`)}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-lg glow-emerald transition-all flex items-center justify-center gap-2"
        >
          <CheckCircle className="w-4 h-4" />
          Aprovar e Agendar Frete
        </button>
      </div>
    </div>
  );
}
