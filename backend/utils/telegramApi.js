const https = require('node:https');

function telegramApi(method, body, timeoutMs = 7000) {
  const token = String(process.env.SECURITY_TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return Promise.reject(new Error('Token de Telegram no configurado'));
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', family: 4, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, response => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        output += chunk;
        if (output.length > 65536) request.destroy(new Error('Respuesta de Telegram demasiado grande'));
      });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, ...JSON.parse(output) }); }
        catch { reject(new Error(`Respuesta inválida de Telegram (HTTP ${response.statusCode})`)); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Tiempo de espera de Telegram'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end(data);
  });
}

module.exports = { telegramApi };
