import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, MapPin, Bus, Activity, FileWarning, CheckSquare } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { useGpsStore } from '../store/useGpsStore';

const ParentDashboard: React.FC = () => {
  const { lat, lng, lastUpdated, setCoordinates } = useGpsStore();
  const socketRef = useRef<Socket | null>(null);
  const [hasConsented, setHasConsented] = useState(false); // Simulação do DB: lgpdConsent

  useEffect(() => {
    // Conectar ao socket e inscrever na sala da Van (v1 mock)
    socketRef.current = io('http://localhost:3000');
    socketRef.current.emit('join_vehicle_room', 'v1');

    socketRef.current.on('gps_update', (data: { lat: number; lng: number }) => {
      setCoordinates(data.lat, data.lng);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [setCoordinates, hasConsented]);

  if (!hasConsented) {
    return (
      <div className="max-w-md mx-auto min-h-[600px] flex flex-col justify-center">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-500 to-amber-600"></div>
          
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FileWarning className="w-8 h-8 text-amber-500" />
          </div>
          
          <div className="text-center space-y-3">
            <h1 className="text-2xl font-extrabold text-white">Termo de Consentimento</h1>
            <p className="text-sm text-slate-400">
              Para a segurança do seu filho(a) e em conformidade com o <strong>ECA</strong> e a <strong>LGPD</strong> (Lei Geral de Proteção de Dados), precisamos da sua autorização para ativar o rastreamento GPS em tempo real durante o trajeto escolar.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-2 h-32 overflow-y-auto">
            <p>1. Os dados de localização são criptografados.</p>
            <p>2. O rastreio só ocorre durante a rota escolar.</p>
            <p>3. Você pode revogar este acesso a qualquer momento junto à coordenação da frota.</p>
            <p>4. Nenhuma informação de geolocalização é vendida a terceiros.</p>
          </div>

          <button 
            onClick={() => setHasConsented(true)}
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold p-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <CheckSquare className="w-5 h-5" /> Autorizar e Acessar o App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mb-4 relative">
            <ShieldCheck className="w-6 h-6" />
            {lat !== null && (
              <span className="absolute top-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full animate-pulse"></span>
            )}
          </div>
          <h1 className="text-xl font-extrabold text-white">App dos Pais</h1>
          <p className="text-slate-400 text-sm">Acompanhe seu filho com segurança.</p>
        </div>

        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center space-y-3">
          <Bus className={`w-8 h-8 mx-auto ${lat ? 'text-emerald-400' : 'text-slate-500'}`} />
          
          <div>
            <h3 className="font-bold text-white">
              {lat ? 'Van em Movimento' : 'Van Parada / Desconectada'}
            </h3>
            <p className="text-xs text-slate-400">Previsão de chegada: 10 minutos</p>
          </div>

          {lat !== null && lng !== null && (
            <div className="pt-3 border-t border-slate-800 flex flex-col items-center gap-1">
              <span className="text-[10px] uppercase font-bold text-emerald-500 flex items-center gap-1">
                <Activity className="w-3 h-3" /> Transmissão ao vivo
              </span>
              <p className="text-xs font-mono text-slate-300">
                Lat: {lat.toFixed(5)} | Lng: {lng.toFixed(5)}
              </p>
            </div>
          )}
        </div>

        <button className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-2xl flex items-center justify-center gap-2 font-bold shadow-lg shadow-blue-900/20">
          <MapPin className="w-5 h-5" /> Abrir Mapa de Rastreio
        </button>
      </div>
    </div>
  );
};

export default ParentDashboard;
