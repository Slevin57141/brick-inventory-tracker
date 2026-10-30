import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const VENDOR_DIR = new URL('../public/vendor/', import.meta.url);
const ROW = /^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|$/;

test('every vendored file is listed in its README with a matching SHA-256', async (t) => {
  const libraries = await readdir(VENDOR_DIR, { withFileTypes: true });
  for (const library of libraries.filter((entry) => entry.isDirectory())) {
    await t.test(library.name, async () => {
      const dir = new URL(`${library.name}/`, VENDOR_DIR);
      const readme = await readFile(new URL('README.md', dir), 'utf8');
      const listed = new Map();
      for (const line of readme.split(/\r?\n/)) {
        const match = ROW.exec(line);
        if (match) listed.set(match[1], match[2]);
      }

      const files = (await readdir(dir)).filter((name) => name !== 'README.md').sort();
      assert.deepEqual(files, [...listed.keys()].sort(), 'files on disk and README rows differ');
      for (const [name, expected] of listed) {
        const actual = createHash('sha256')
          .update(await readFile(new URL(name, dir)))
          .digest('hex');
        assert.equal(actual, expected, `${library.name}/${name} has changed`);
      }
    });
  }
});
