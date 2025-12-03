import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface ConsoleLogProps {
  logs: LogEntry[];
}

const ConsoleLog: React.FC<ConsoleLogProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLogStyle = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-emerald-400 bg-emerald-500/5 border-l-2 border-emerald-500';
      case 'error': return 'text-red-400 border-l-2 border-red-500/50';
      case 'warning': return 'text-amber-400 border-l-2 border-amber-500/50';
      default: return 'text-slate-400 border-l-2 border-slate-700';
    }
  };

  const formatMessage = (msg: string) => {
    const parts = msg.split(/(\[SID:.*?\])/);
    return parts.map((part, i) => {
        if (part.startsWith('[SID:')) {
            const cleanId = part.replace('[SID:', '').replace(']', '').trim();
            return (
                <span key={i} className="text-blue-400 font-bold mx-1">
                    {cleanId}
                </span>
            );
        }
        return part;
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#020617] border border-slate-800 rounded-lg overflow-hidden font-mono text-xs">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
        <span className="text-slate-400 font-semibold uppercase tracking-wider">System Activity</span>
        <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-700"></span>
            <span className="w-2 h-2 rounded-full bg-slate-700"></span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {logs.length === 0 && (
            <div className="h-full flex items-center justify-center text-slate-700">
                // System ready. Waiting for input...
            </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className={`py-1 px-2 ${getLogStyle(log.type)}`}>
            <span className="opacity-50 mr-3 text-[10px]">{log.timestamp}</span>
            <span>{formatMessage(log.message)}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default ConsoleLog;