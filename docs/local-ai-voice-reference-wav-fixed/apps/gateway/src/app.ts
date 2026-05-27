import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { ConfigStore } from './config-store.js';
import { registerApiRoutes } from './routes/api.js';
import { registerCompatRoutes } from './routes/compat.js';
import { ensureRuntimeDirectories } from './storage.js';
import { WorkerClient } from './worker-client.js';

export interface BuildAppOptions {
  config?: AppConfig;
  sttClient?: WorkerClient;
  ttsClient?: WorkerClient;
}

function safeBasicAuthEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseBasicAuth(request: FastifyRequest): { username: string; password: string } | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  await ensureRuntimeDirectories(config);

  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: config.maxUploadBytes
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? false : config.corsOrigin,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS']
  });
  await app.register(formbody);
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 4,
      fields: 50
    }
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Local AI Voice Gateway API',
        version: '0.1.0',
        description: 'Compatibility and management API for local GPU-first STT/TTS workers.'
      },
      servers: [{ url: `http://${config.publicHost}:${config.publicPort}` }]
    }
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  if (config.authEnabled) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url === '/health' || request.url === '/api/health') return;
      if (!config.basicAuthPassword) {
        reply.code(503).send({ ok: false, error: 'AUTH_ENABLED=true but BASIC_AUTH_PASSWORD is empty.' });
        return;
      }
      const credentials = parseBasicAuth(request);
      const valid =
        credentials !== null &&
        safeBasicAuthEquals(credentials.username, config.basicAuthUsername) &&
        safeBasicAuthEquals(credentials.password, config.basicAuthPassword);
      if (!valid) {
        reply.header('www-authenticate', 'Basic realm="local-ai-voice"').code(401).send({ ok: false });
      }
    });
  }

  const configStore = new ConfigStore(config);
  const sttClient =
    options.sttClient ??
    new WorkerClient({
      role: 'stt',
      provider: config.defaultSttProvider,
      baseUrl: config.sttWorkerUrl,
      timeoutMs: config.workerTimeoutMs
    });
  const ttsClient =
    options.ttsClient ??
    new WorkerClient({
      role: 'tts',
      provider: config.defaultTtsProvider,
      baseUrl: config.ttsWorkerUrl,
      timeoutMs: config.workerTimeoutMs
    });

  await registerApiRoutes(app, { config, configStore, sttClient, ttsClient });
  await registerCompatRoutes(app, { config, configStore, sttClient, ttsClient });

  if (config.portalEnabled && existsSync(config.portalDistDir)) {
    await app.register(fastifyStatic, {
      root: config.portalDistDir,
      prefix: '/',
      decorateReply: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !path.extname(request.url)) {
        reply.sendFile('index.html');
        return;
      }
      reply.code(404).send({ ok: false, error: 'Not found' });
    });
  } else {
    app.get('/', async () => ({
      name: 'local-ai-voice-gateway',
      portal: config.portalEnabled ? 'not-built' : 'disabled',
      apiDocs: '/api/docs',
      health: '/api/health'
    }));
  }

  return app;
}
