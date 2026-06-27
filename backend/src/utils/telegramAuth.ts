import crypto from 'crypto';

export function validateWebAppData(initData: string, botToken: string): any {
  if (!initData) return false;

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  
  if (!hash) return false;

  urlParams.delete('hash');
  
  // Sort keys alphabetically
  const keys = Array.from(urlParams.keys()).sort();
  
  // Create data check string
  const dataCheckString = keys.map(key => `${key}=${urlParams.get(key)}`).join('\n');

  // Create secret key
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

  // Calculate signature
  const signature = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (signature === hash) {
    // Parse user data if available
    const userStr = urlParams.get('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch (e) {
        return true; // Valid signature, but user data isn't parseable
      }
    }
    return true; // Valid signature, no user data
  }

  return false;
}
