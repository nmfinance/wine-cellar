// GigaChat: OAuth + files + chat/completions.
// Сертификат Минцифры не входит в системное хранилище YC — читаем pem и
// передаём в https.Agent (нативный fetch не принимает agent, поэтому для
// хостов Сбера используем node:https напрямую).
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CA = fs.readFileSync(path.join(__dirname, 'certs', 'russiantrustedca.pem'));
const agent = new https.Agent({ ca: CA });

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_BASE = 'https://gigachat.devices.sberbank.ru/api/v1';

function fail(code, detail) {
  const err = new Error(code);
  err.code = code;
  err.detail = detail;
  return err;
}

function request(url, { method = 'GET', headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })
      );
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Токен кэшируется в module-scope: тёплые инстансы функции переживают вызовы
let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const body = 'scope=GIGACHAT_API_PERS';
  const res = await request(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${process.env.GIGACHAT_AUTH_KEY}`,
      RqUID: crypto.randomUUID(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  if (res.status === 401 || res.status === 400) throw fail('gigachat_auth', `oauth ${res.status}`);
  if (res.status !== 200) throw fail('gigachat_error', `oauth ${res.status} ${res.text.slice(0, 200)}`);
  const json = JSON.parse(res.text);
  cached = { token: json.access_token, expiresAt: json.expires_at ?? Date.now() + 25 * 60_000 };
  return cached.token;
}

async function uploadImage(token, base64jpeg) {
  const boundary = '----pogreb' + crypto.randomUUID().replace(/-/g, '');
  const image = Buffer.from(base64jpeg, 'base64');
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="label.jpg"\r\n' +
      'Content-Type: image/jpeg\r\n\r\n'
  );
  const tail = Buffer.from(
    `\r\n--${boundary}\r\n` +
      'Content-Disposition: form-data; name="purpose"\r\n\r\n' +
      `general\r\n--${boundary}--\r\n`
  );
  const body = Buffer.concat([head, image, tail]);
  const res = await request(`${API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
  if (res.status !== 200) throw fail('gigachat_error', `files ${res.status} ${res.text.slice(0, 200)}`);
  return JSON.parse(res.text).id;
}

async function chat(token, { model, temperature, prompt, attachments = [], timeout = 50_000 }) {
  const payload = JSON.stringify({
    model,
    temperature,
    stream: false,
    messages: [
      { role: 'user', content: prompt, ...(attachments.length ? { attachments } : {}) },
    ],
  });
  const res = await request(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Connection: 'close',
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
    timeout,
  });
  if (res.status !== 200) throw fail('gigachat_error', `chat ${res.status} ${res.text.slice(0, 200)}`);
  return JSON.parse(res.text).choices?.[0]?.message?.content ?? '';
}

module.exports = { getToken, uploadImage, chat, request };
