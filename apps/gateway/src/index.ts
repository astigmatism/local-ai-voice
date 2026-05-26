import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ config });

const address = await app.listen({ host: config.publicHost, port: config.publicPort });
app.log.info({ address }, 'Local AI Voice gateway listening');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down gateway');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
