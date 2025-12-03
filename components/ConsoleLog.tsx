
import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, XCircle, CheckCircle, Info, AlertTriangle, Cpu } from 'lucide-react';

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
      case 'success': return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
      case 'error': return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
      default: return <Info className="w-3.5 h-3.5 text-blue-500" />;
    }
  };

  const getColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-emerald-400 bg-emerald-500/10 border-l-2 border-emerald-500 pl-2';
      case 'error': return 'text-red-400 bg-red-500/5 pl-2 border-l-2 border-red-500/50';
      case 'warning': return 'text-amber-400';
      default: return 'text-zinc-400';
    }
  };

  // Helper to highlight Session IDs in the message
  // Assumes format "Some text [SID: xxxxx] some text"
  const formatMessage = (msg: string) => {
    if (!msg.includes('[SID:')) return msg;

    const parts = msg.split(/(\[SID:.*?\])/);
    return parts.map((part, i) => {
        if (part.startsWith('[SID:')) {
            const cleanId = part.replace('[SID:', '').replace(']', '').trim();
            return (
                <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded mx-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] tracking-wider font-semibold">
                    {cleanId}
                </span>
            );
        }
        return part;
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] border border-zinc-800/60 rounded-xl overflow-hidden shadow-2xl relative">
      {/* Glossy overlay effect */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/5 to-transparent pointer-events-none mix-blend-overlay"></div>
      
      <div className="bg-[#121214] px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest font-bold">Terminal Output</span>
        </div>
        <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-zinc-700"></div>
            <div className="w-2 h-2 rounded-full bg-zinc-700"></div>
            <div className="w-2 h-2 rounded-full bg-zinc-700"></div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-1.5 custom-scrollbar">
        {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-700 space-y-2">
                <Cpu className="w-8 h-8 opacity-20" />
                <span className="italic">System idle. Awaiting command...</span>
            </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className={`flex items-start gap-2.5 py-0.5 animate-in fade-in slide-in-from-left-2 duration-200 ${log.type === 'success' ? 'my-2 rounded' : ''}`}>
            <span className="text-zinc-600 shrink-0 select-none text-[10px] pt-0.5">{log.timestamp}</span>
            <div className="shrink-0 mt-0.5">{getIcon(log.type)}</div>
            <div className={`${getColor(log.type)} break-all flex-1`}>
                {formatMessage(log.message)}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default ConsoleLog;
