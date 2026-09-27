import type { IncomingMessage, ServerResponse } from 'node:http';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || '8909fa1';
  const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || '';
  const env = process.env.VERCEL_ENV || 'production';

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'probe-agent',
      commit,
      commitMessage,
      env,
      timestamp: new Date().toISOString(),
    })
  );
}
