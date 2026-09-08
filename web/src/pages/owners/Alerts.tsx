import React, { useState } from 'react';
import { AlertTriangle, Send, CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const Alerts: React.FC = () => {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'IDLE' | 'SENDING' | 'SENT'>('IDLE');

  if (user?.role !== 'OWNER') {
    return <div className="p-8 text-red-500 font-bold">Acesso restrito ao Dono da Frota.</div>;
  }

  const handleSendAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setStatus('SENDING');
    // Simula disparo via WhatsApp/Push Notification pelo backend
    setTimeout(() => {
      setStatus('SENT');
      setMessage('');
      setTimeout(() => setStatus('IDLE'), 3000);
    }, 1500);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <MessageSquareWarning className="text-amber-500 w-8 h-8" />
        <h1 className="text-3xl font-bold text-white">Alertas em Massa</h1>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex gap-3 text-amber-200">
        <AlertTriangle className="w-6 h-6 flex-shrink-0" />
        <p className="text-sm">
          Este aviso será disparado imediatamente via <strong>WhatsApp</strong> para todos os Pais associados à sua frota. Use com responsabilidade.
        </p>
      </div>

      <form onSubmit={handleSendAlert} className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
        <div className="space-y-4">
          <label className="block text-slate-300 font-medium mb-2">Mensagem do Alerta</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[150px]"
            placeholder="Ex: Pneu furado na Van 2. Teremos um atraso de 30 minutos na rota da tarde..."
            disabled={status === 'SENDING' || status === 'SENT'}
            required
          />

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={status !== 'IDLE' || !message.trim()}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-8 py-3 rounded-xl flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {status === 'SENDING' ? (
                'Disparando Alertas...'
              ) : status === 'SENT' ? (
                <><CheckCircle2 className="w-5 h-5" /> Alertas Enviados</>
              ) : (
                <><Send className="w-5 h-5" /> Disparar para Todos</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default Alerts;
