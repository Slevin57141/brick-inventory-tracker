// A small HTTP client for testing the server (M8). Unlike fetch, it sends exactly the headers
// it is given, Host included, so tests can check the Host and Origin rules.

import { request } from 'node:http';

/**
 * Sends one request to 127.0.0.1:port. `headers.Host` defaults to 127.0.0.1:port; pass
 * `Host: null` to send the default from Node instead. A `chunks` array is sent with chunked
 * transfer encoding instead of `body`.
 * @returns {Promise<{ status: number, headers: object, text: string, json: any }>}
 */
export function send(port, method, path, { headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const all = { Host: `127.0.0.1:${port}`, ...headers };
    for (const [name, value] of Object.entries(all)) {
      if (value === null) delete all[name];
    }
    const req = request({ host: '127.0.0.1', port, method, path, headers: all }, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (chunks) {
      for (const chunk of chunks) req.write(chunk);
    } else if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}
