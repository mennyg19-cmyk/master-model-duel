import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { DB_PORT } from './db-server';

const TIMEOUT_MS = 60_000;

function isPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: DB_PORT });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function main() {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isPortOpen()) {
      console.log(`Postgres is accepting connections on ${DB_PORT}.`);
      return;
    }
    await sleep(500);
  }

  console.error(`Postgres did not open port ${DB_PORT} within ${TIMEOUT_MS / 1000}s.`);
  process.exitCode = 1;
}

void main();
