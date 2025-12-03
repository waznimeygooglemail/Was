

export interface ScanStats {
  attempts: number;
  validFound: number;
  sessionsActive: number;
  startTime: number | null;
}

export interface Config {
  targetUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  threadCount: number;
  simulationMode: boolean; // To allow UI testing without CORS issues
  // Code Generation Config
  useNumbers: boolean;
  useLowercase: boolean;
  useUppercase: boolean;
  codeLength: number;
  codePrefix: string;
  loginUrl: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface ValidCode {
  code: string;
  timestamp: string;
  sessionId: string;
}

export interface SessionSlot {
  id: string;
  sessionId: string;
  remainingUses: number;
}