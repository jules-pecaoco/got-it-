import Fastify from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Preserve established HTTP contracts while routes move into typed feature modules.
export function createHttpServer(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  const app = Fastify({ logger: false, bodyLimit: 15_000_000, requestTimeout: 30_000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.hijack();
    await handler(request.raw, reply.raw);
  });
  app.all('/*', async () => undefined);
  // Existing tests and supervisors use Node's listen/close API.
  const server = app.server;
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.setTimeout(30000);
  return { app, server, ready: app.ready() };
}
