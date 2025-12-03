import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  color?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, trend, color = "zinc" }) => {
  const getBorderColor = () => {
    switch(color) {
        case 'emerald': return 'border-emerald-500/30';
        case 'red': return 'border-red-500/30';
        case 'blue': return 'border-blue-500/30';
        default: return 'border-zinc-700';
    }
  };

  return (
    <div className={`bg-zinc-900/50 border ${getBorderColor()} rounded-lg p-4 backdrop-blur-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-zinc-400 text-xs uppercase font-semibold tracking-wider">{label}</span>
        <div className={`p-1.5 rounded-md bg-zinc-800 text-zinc-300`}>
            {icon}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold font-mono text-white">{value}</span>
        {trend && <span className="text-xs text-zinc-500 mb-1 font-mono">{trend}</span>}
      </div>
    </div>
  );
};

export default StatCard;