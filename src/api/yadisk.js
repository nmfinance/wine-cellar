import { YA_CLIENT_ID } from './config.js';

// Яндекс.Диск REST API, папка приложения (app:/). Токен — implicit flow,
// живёт только в localStorage этого устройства и уходит только в API Яндекса.
const KEY = 'ya_token';
const API = 'https://cloud-api.yandex.net/v1/disk';

export function getToken() {
  try {
    const { token, expiresAt } = JSON.parse(localStorage.getItem(KEY));
    return token && expiresAt > Date.now() ? token : null;
  } catch {
    return null;
  }
}

export function authorize() {
  window.location.href = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${YA_CLIENT_ID}`;
}

export function logout() {
  localStorage.removeItem(KEY);
}

class DiskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(token, path, { method = 'GET' } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new DiskError(401, 'unauthorized');
  if (!res.ok && res.status !== 409) {
    // 409 «уже существует» для mkdir — не ошибка, разбирает вызывающий
    throw new DiskError(res.status, `disk ${res.status}`);
  }
  return res;
}

export async function mkdir(token, path) {
  await call(token, `/resources?path=${encodeURIComponent(path)}`, { method: 'PUT' });
}

export async function uploadFile(token, path, blob) {
  const res = await call(
    token,
    `/resources/upload?path=${encodeURIComponent(path)}&overwrite=true`
  );
  const { href } = await res.json();
  const put = await fetch(href, {
    method: 'PUT',
    body: blob,
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok && put.status !== 201 && put.status !== 202) {
    throw new DiskError(put.status, `upload ${put.status}`);
  }
}

export async function downloadFile(token, path) {
  const res = await call(token, `/resources/download?path=${encodeURIComponent(path)}`);
  const { href } = await res.json();
  const file = await fetch(href, { signal: AbortSignal.timeout(120_000) });
  if (!file.ok) throw new DiskError(file.status, `download ${file.status}`);
  return file;
}

export async function listDir(token, path) {
  const res = await call(
    token,
    `/resources?path=${encodeURIComponent(path)}&limit=100&sort=name`
  );
  if (res.status === 409) return [];
  const json = await res.json();
  return json._embedded?.items ?? [];
}

export async function deleteResource(token, path) {
  const res = await fetch(
    `${API}/resources?path=${encodeURIComponent(path)}&permanently=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (res.status === 401) throw new DiskError(401, 'unauthorized');
  if (!res.ok && res.status !== 404 && res.status !== 202 && res.status !== 204) {
    throw new DiskError(res.status, `delete ${res.status}`);
  }
}
