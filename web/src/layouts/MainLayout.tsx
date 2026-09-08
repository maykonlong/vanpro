import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Bus, SteeringWheel, Users, LogOut, Map, Bot } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const MainLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-r border-slate-800 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
            VANOS
          </h1>
          <p className="text-xs text-slate-400 mt-1">Sistema Operacional</p>
        </div>

        <nav className="flex-1 px-4 space-y-2 pb-6 md:pb-0 overflow-x-auto md:overflow-visible flex md:block">
          <NavLink
            to="owner"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${
                isActive ? 'bg-emerald-600/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
              }`
            }
          >
            <Bus className="w-5 h-5" /> Painel do Gestor
          </NavLink>

          {(user?.role === 'OWNER' || user?.role === 'MANAGER') && (
            <NavLink
              to="charters"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${
                  isActive ? 'bg-emerald-600/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
                }`
              }
            >
              <Map className="w-5 h-5" /> Fretamentos
            </NavLink>
          )}

          {(user?.role === 'OWNER') && (
            <NavLink
              to="marketing"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${
                  isActive ? 'bg-purple-600/10 text-purple-400 border border-purple-500/30' : 'text-slate-400 hover:bg-slate-800'
                }`
              }
            >
              <Bot className="w-5 h-5 text-purple-400" /> CRM de IA
            </NavLink>
          )}

          <NavLink
            to="driver"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${
                isActive ? 'bg-emerald-600/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
              }`
            }
          >
            <SteeringWheel className="w-5 h-5" /> App Motorista
          </NavLink>
          <NavLink
            to="assistant"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${
                isActive ? 'bg-emerald-600/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
              }`
            }
          >
            <Users className="w-5 h-5" /> App Monitora
          </NavLink>
          <NavLink
            to="parent"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${
                isActive ? 'bg-emerald-600/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
              }`
            }
          >
            <Users className="w-5 h-5" /> App Pais (Tracking)
          </NavLink>
        </nav>

        <div className="p-4 mt-auto border-t border-slate-800 hidden md:block">
          <div className="flex items-center justify-between">
            <div className="text-xs">
              <p className="text-white font-bold truncate max-w-[120px]">{user?.name}</p>
              <p className="text-emerald-400 font-medium">{user?.role}</p>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default MainLayout;
