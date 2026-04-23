import fetch from 'node-fetch';

export default async function keepBridgeAlive() {
  const BRIDGE_URL = 'https://jessica-nexa-bridge.onrender.com/health';
  const timestamp = new Date().toISOString();
  
  try {
    const response = await fetch(BRIDGE_URL, { timeout: 5000 });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ [${timestamp}] Bridge health check passed`, data);
      return { status: 'ok', message: 'Bridge is healthy', timestamp };
    } else {
      const error = `HTTP ${response.status}`;
      console.error(`❌ [${timestamp}] Bridge health check failed: ${error}`);
      return { status: 'error', message: `Bridge returned ${response.status}`, timestamp };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ [${timestamp}] Bridge ping failed: ${errorMsg}`);
    return { status: 'error', message: `Ping failed: ${errorMsg}`, timestamp };
  }
}
