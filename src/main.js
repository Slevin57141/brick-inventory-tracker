// Starts the app (docs/plan.md M8): builds every module, loads the data file and listens on
// 127.0.0.1 only. PORT and DATA_FILE override the defaults (D11), and LDRAW_DIR the folder of
// the LDraw parts library the user downloads (D31).

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollection } from './collection.js';
import { AppError } from './errors.js';
import { createKeyStore } from './key-store.js';
import { createLdrawLibrary } from './ldraw-library.js';
import { createLogger } from './logger.js';
import { createRebrickableClient } from './rebrickable-client.js';
import { createServer, listen } from './server.js';
import { createSetImporter } from './set-importer.js';
import { createStorage } from './storage.js';

const DEFAULT_PORT = 3000;

async function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) {
    console.error('PORT must be a whole number from 0 to 65535.');
    process.exitCode = 1;
    return;
  }
  const filePath = process.env.DATA_FILE
    ? resolve(process.env.DATA_FILE)
    : fileURLToPath(new URL('../data/inventory.json', import.meta.url));
  const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
  const ldraw = createLdrawLibrary({ root: process.env.LDRAW_DIR
    ? resolve(process.env.LDRAW_DIR)
    : fileURLToPath(new URL('../ldraw/', import.meta.url)) });

  const keyStore = createKeyStore();
  const logger = createLogger({ redact: keyStore.redact });
  const client = createRebrickableClient({ keyStore });
  const importer = createSetImporter({ client });
  const storage = createStorage({ filePath });
  const collection = createCollection({ storage, importer });

  try {
    await collection.init();
  } catch (error) {
    if (error instanceof AppError) {
      console.error(error.message); // the fixed data_file_invalid text; the file is unchanged
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const server = createServer({ collection, keyStore, client, logger, publicDir, port, ldraw });
  try {
    const address = await listen(server, port);
    logger.info(`Brick Inventory Tracker is running at http://127.0.0.1:${address.port}`);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Set PORT to use another one.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function parsePort(value) {
  if (value === undefined || value === '') {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  return /^\d+$/.test(value) && port <= 65535 ? port : null;
}

main();
