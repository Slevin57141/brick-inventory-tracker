// The HTTP routes and request rules of docs/plan.md section 7 (M8). The server answers only
// requests addressed to this machine by name (the Host check stops DNS rebinding), accepts
// changes only from its own page (the Origin check stops other websites), and serves files
// only from public/. Error responses carry only the fixed messages from src/errors.js.

import { createServer as createHttpServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { AppError, createError } from './errors.js';
import { normalizeKey } from './key-store.js';

const HOST = '127.0.0.1';
const BODY_LIMIT = 10 * 1024;
const CONTENT_SECURITY_POLICY = "default-src 'self'; img-src 'self' https://cdn.rebrickable.com; "
  + "object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
// .js must be text/javascript: under nosniff the browser refuses module scripts otherwise.
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function createServer({ collection, keyStore, client, logger, publicDir, port }) {
  const root = resolve(publicDir);
  let realRoot = null;
  // Tests listen on port 0, so the checks use the port actually in use.
  const currentPort = () => server.address()?.port ?? port;
  // Key changes take effect in the order they arrived: each PUT and DELETE of the key gets a
  // number, and a PUT whose check ends after a later change has taken effect is dropped.
  // Otherwise a "Forget key" sent during the check would be undone when the check ends.
  let keyArrived = 0;
  let keyApplied = 0;

  const server = createHttpServer((request, response) => {
    const started = process.hrtime.bigint();
    const path = pathOf(request.url);
    response.on('finish', () => {
      // Method, path, status and time only: never the query, headers or body (R16).
      const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
      logger.info('request', { method: request.method, path, status: response.statusCode, ms });
    });
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    if (path === '/api' || path.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store');
    }
    handle(request, response, path).catch((error) => fail(request, response, error));
  });

  async function handle(request, response, path) {
    const ports = currentPort();
    const host = String(request.headers.host ?? '').toLowerCase();
    if (host !== `${HOST}:${ports}` && host !== `localhost:${ports}`) {
      throw createError('forbidden');
    }
    const { method } = request;
    const changes = method !== 'GET' && method !== 'HEAD';
    if (changes) {
      const origin = request.headers.origin;
      if (origin !== `http://${HOST}:${ports}` && origin !== `http://localhost:${ports}`) {
        throw createError('forbidden');
      }
    }
    const body = changes ? await readBody(request) : null;

    if (path === '/api' || path.startsWith('/api/')) {
      await api(request, response, path, body);
    } else if (changes) {
      throw createError('not_found');
    } else {
      await serveFile(response, path);
    }
  }

  async function api(request, response, path, body) {
    const { method } = request;
    if (path === '/api/status' && method === 'GET') {
      return sendJson(response, 200, { hasKey: keyStore.has() });
    }
    if (path === '/api/key' && method === 'PUT') {
      const candidate = normalizeKey(jsonObject(body).key);
      const change = ++keyArrived;
      await client.checkKey(candidate);
      if (change > keyApplied) {
        keyStore.set(candidate);
        keyApplied = change;
      }
      return sendJson(response, 200, { hasKey: keyStore.has() });
    }
    if (path === '/api/key' && method === 'DELETE') {
      keyStore.clear();
      keyApplied = ++keyArrived;
      return sendJson(response, 200, { hasKey: false });
    }
    if (path === '/api/sets' && method === 'GET') {
      return sendJson(response, 200, { sets: collection.listSets() });
    }
    if (path === '/api/sets' && method === 'POST') {
      const keySeen = keyApplied;
      try {
        const set = await collection.addSet(jsonObject(body).setNumber);
        return sendJson(response, 200, { set });
      } catch (error) {
        // R18, D12: Rebrickable rejected the stored key. A key set or forgotten while the add
        // ran is left alone, since the rejection may have been for the key it replaced.
        if (error instanceof AppError && error.code === 'key_invalid' && keySeen === keyApplied) {
          keyStore.clear();
        }
        throw error;
      }
    }
    const one = /^\/api\/sets\/([^/]+)$/.exec(path);
    if (one && (method === 'GET' || method === 'DELETE')) {
      let setNum;
      try {
        setNum = decodeURIComponent(one[1]);
      } catch {
        throw createError('bad_request');
      }
      if (method === 'GET') {
        return sendJson(response, 200, collection.getSet(setNum));
      }
      return sendJson(response, 200, { set: await collection.removeSet(setNum) });
    }
    if (path === '/api/inventory' && method === 'GET') {
      return sendJson(response, 200, { rows: collection.getInventory() });
    }
    throw createError('not_found');
  }

  async function serveFile(response, path) {
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw createError('not_found');
    }
    if (decoded.includes('\0')) {
      throw createError('not_found');
    }
    const file = resolve(root, decoded === '/' ? 'index.html' : `.${decoded}`);
    if (!file.startsWith(root + sep)) {
      throw createError('not_found');
    }
    let real;
    try {
      realRoot ??= await realpath(root);
      real = await realpath(file);
    } catch {
      throw createError('not_found');
    }
    // A link inside public/ must not lead outside it either.
    if (!real.startsWith(realRoot + sep) || !(await stat(real)).isFile()) {
      throw createError('not_found');
    }
    const content = await readFile(real);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': content.length,
    });
    response.end(content);
  }

  function fail(request, response, error) {
    if (!(error instanceof AppError)) {
      // The real error goes to the log only, through the logger's redact.
      logger.error('internal error', { name: error?.name, stack: String(error?.stack ?? error) });
    }
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (!request.complete) {
      // The rest of an unread body would otherwise be taken as the next request.
      response.setHeader('Connection', 'close');
    }
    const shown = error instanceof AppError ? error : createError('internal_error');
    const { code, status, message } = shown;
    sendJson(response, status, { error: { code, message } }, { redact: keyStore.redact });
  }

  return server;
}

/** Starts the server on 127.0.0.1 only (R19) and resolves with its address. */
export function listen(server, port) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen({ port, host: HOST }, () => {
      server.off('error', reject);
      resolvePromise(server.address());
    });
  });
}

// Reads a request body of at most BODY_LIMIT bytes. A body must be JSON (section 7).
async function readBody(request) {
  const length = request.headers['content-length'];
  const hasBody = request.headers['transfer-encoding'] !== undefined
    || (length !== undefined && length !== '0');
  if (!hasBody) {
    return null;
  }
  const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw createError('forbidden');
  }
  if (Number(length) > BODY_LIMIT) {
    throw createError('payload_too_large');
  }
  // Read with events rather than `for await`: leaving that loop early destroys the
  // request, and with it the socket the error response has to go out on.
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        settled = true;
        reject(createError('payload_too_large'));
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (!settled) {
        settled = true;
        resolvePromise(Buffer.concat(chunks).toString('utf8'));
      }
    });
    request.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function jsonObject(body) {
  let value;
  try {
    value = JSON.parse(body ?? '');
  } catch {
    throw createError('bad_request');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw createError('bad_request');
  }
  return value;
}

function sendJson(response, status, value, { redact = (text) => text } = {}) {
  const text = redact(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  response.end(text);
}

function pathOf(url) {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
