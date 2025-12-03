import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, XCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface ConsoleLogProps {
  logs: LogEntry[];
}

const ConsoleLog: React.FC<ConsoleLogProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  const getColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-emerald-400';
      case 'error': return 'text-red-400';
      case 'warning': return 'text-amber-400';
      default: return 'text-zinc-300';
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-xl">
      <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
        <Terminal className="w-4 h-4 text-zinc-400" />
        <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">System Log</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
        {logs.length === 0 && (
            <div className="text-zinc-600 italic text-center mt-10">System ready. Initialize scan to begin...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-3 animate-in fade-in duration-300">
            <span className="text-zinc-500 shrink-0 select-none">[{log.timestamp}]</span>
            <span className="shrink-0 mt-0.5">{getIcon(log.type)}</span>
            <span className={`${getColor(log.type)} break-all`}>{log.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default ConsoleLog;