import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface TooltipProps {
  content: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ content }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div 
      className="relative flex items-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <button className="text-slate-500 hover:text-amber-500 transition-colors focus:outline-none">
        <Info className="w-4 h-4" />
      </button>
      
      {isVisible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-800 text-slate-200 text-xs rounded-xl border border-slate-700 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200 text-center pointer-events-none">
          {content}
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 border-b border-r border-slate-700 rotate-45"></div>
        </div>
      )}
    </div>
  );
};
