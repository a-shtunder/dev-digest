import { loadConfig } from '@server/platform/config.js';
import { createDb, type DbHandle } from '@server/db/client.js';
import { Container } from '@server/platform/container.js';

/**
 * MCP-specific bootstrap: builds the same `Container` the Fastify app uses
 * (`server/src/app.ts`), but standalone — no Fastify, no HTTP listener. One
 * instance per process (this stdio server is spawned fresh per MCP session).
 */
let handle: DbHandle | undefined;
let container: Container | undefined;

export function getContainer(): Container {
  if (container) return container;
  const config = loadConfig();
  handle = createDb(config.databaseUrl);
  container = new Container(config, handle.db);
  return container;
}

export async function closeContainer(): Promise<void> {
  await handle?.close();
  handle = undefined;
  container = undefined;
}
