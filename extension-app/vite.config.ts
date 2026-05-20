import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const AUDIT_ENDPOINT_PATH = '/audit';
const AUDIT_FEED_PATH = '/audit-feed';
const HOST_APP_ORIGIN = 'https://localhost:4000';

type AuditEnvelope = Record<string, unknown>;
type AuditFeedEntry = {
  sequence: number;
  event: AuditEnvelope;
};
type MiddlewareNext = () => void;
type MiddlewareStack = {
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: MiddlewareNext) => void | Promise<void>) => void;
};

const auditFeedState: {
  latestSequence: number;
  entries: AuditFeedEntry[];
} = {
  latestSequence: 0,
  entries: [],
};

function readHttpsOptions() {
  const certPath = path.resolve(projectRoot, '../.tmp/localhost.crt');
  const keyPath = path.resolve(projectRoot, '../.tmp/localhost.key');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    return undefined;
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

function extensionStaticFilesPlugin(): Plugin {
  const staticFiles = ['bundle.json', 'controller.config.json', 'icon.svg'];

  return {
    name: 'extension-static-files',
    generateBundle() {
      staticFiles.forEach((fileName) => {
        this.emitFile({
          type: 'asset',
          fileName,
          source: fs.readFileSync(path.resolve(projectRoot, fileName), 'utf8'),
        });
      });
    },
  };
}

function extensionAuditApiPlugin(): Plugin {
  return {
    name: 'extension-audit-api',
    configureServer(server) {
      installAuditApi(server.middlewares);
    },
    configurePreviewServer(server) {
      installAuditApi(server.middlewares);
    },
  };
}

function installAuditApi(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'https://localhost:4001');

    if (requestUrl.pathname === AUDIT_ENDPOINT_PATH) {
      if (req.method === 'OPTIONS') {
        writeCorsHeaders(req, res);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        writeJson(req, res, 405, {
          error: 'Method Not Allowed',
          allowedMethods: ['POST', 'OPTIONS'],
        });
        return;
      }

      const body = await readJsonBody(req);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        writeJson(req, res, 400, {
          error: 'Invalid audit payload',
        });
        return;
      }

      auditFeedState.latestSequence += 1;
      auditFeedState.entries.push({
        sequence: auditFeedState.latestSequence,
        event: body,
      });

      writeJson(req, res, 202, {
        accepted: true,
        sequence: auditFeedState.latestSequence,
      });
      return;
    }

    if (requestUrl.pathname === AUDIT_FEED_PATH) {
      if (req.method === 'OPTIONS') {
        writeCorsHeaders(req, res);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeJson(req, res, 405, {
          error: 'Method Not Allowed',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        });
        return;
      }

      const after = Number.parseInt(requestUrl.searchParams.get('after') || '0', 10);
      const events = auditFeedState.entries.filter((entry) => entry.sequence > (Number.isFinite(after) ? after : 0));

      writeJson(req, res, 200, {
        events,
        latestSequence: auditFeedState.latestSequence,
      });
      return;
    }

    next();
  });
}

async function readJsonBody(req: IncomingMessage): Promise<AuditEnvelope | null> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as AuditEnvelope;
  } catch {
    return null;
  }
}

function writeJson(req: IncomingMessage, res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  writeCorsHeaders(req, res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function writeCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const requestOrigin = req.headers.origin;
  const allowOrigin = requestOrigin === HOST_APP_ORIGIN ? requestOrigin : HOST_APP_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

export default defineConfig({
  base: './',
  plugins: [extensionStaticFilesPlugin(), extensionAuditApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 4001,
    strictPort: true,
    https: readHttpsOptions(),
    cors: {
      origin: HOST_APP_ORIGIN,
      credentials: true,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4001,
    strictPort: true,
    https: readHttpsOptions(),
    cors: {
      origin: HOST_APP_ORIGIN,
      credentials: true,
    },
  },
  build: {
    outDir: path.resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        controller: path.resolve(projectRoot, 'controller.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
