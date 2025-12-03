import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  active?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, active }) => {
  return (
    <div className={`p-4 rounded-lg border transition-all duration-300 ${active ? 'bg-blue-500/10 border-blue-500/30' : 'bg-slate-900 border-slate-800'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
        <div className={`${active ? 'text-blue-400' : 'text-slate-600'}`}>
            {icon}
        </div>
      </div>
      <div className="text-2xl font-mono font-bold text-slate-100">
        {value}
      </div>
    </div>
  );
};

export default StatCard;