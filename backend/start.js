const localtunnel = require('localtunnel');
const fs = require('fs');
const { spawn } = require('child_process');

(async () => {
  console.log('Requesting tunnel...');
  const tunnel = await localtunnel({ port: 3000 });
  console.log('Tunnel URL:', tunnel.url);

  // Update .env file
  let envContent = fs.readFileSync('.env', 'utf8');
  if (envContent.includes('WEBAPP_URL')) {
    envContent = envContent.replace(/WEBAPP_URL=.*/g, `WEBAPP_URL="${tunnel.url}"`);
  } else {
    envContent += `\nWEBAPP_URL="${tunnel.url}"`;
  }
  
  const botToken = "8834346652:AAH0Fts8AwA0lhbrhxmxE2ncN7yIabtiS0M";
  if (envContent.includes('BOT_TOKEN')) {
    envContent = envContent.replace(/BOT_TOKEN=.*/g, `BOT_TOKEN="${botToken}"`);
  } else {
    envContent += `\nBOT_TOKEN="${botToken}"`;
  }
  
  fs.writeFileSync('.env', envContent);

  console.log('Starting server...');
  const server = spawn('npx', ['ts-node', 'src/index.ts'], { stdio: 'inherit', shell: true });
  
  tunnel.on('close', () => {
    console.log('Tunnel closed');
  });
})();
