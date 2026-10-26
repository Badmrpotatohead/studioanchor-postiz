import { json, RequestHandler } from 'express';

// Mastra wraps the SDK server without exposing maxToolInputElements. Enforce
// the budget before either its schema validator or the SDK sees tool inputs.
export function createMcpInputLimits(): RequestHandler[] {
  const parse = json({ limit: '256kb', strict: true });
  return [
    (req, res, next) => {
      const hasBody =
        Boolean(req.headers['transfer-encoding']) ||
        Number(req.headers['content-length'] ?? 0) > 0;
      // Mastra can buffer the raw stream before the SDK checks Content-Type.
      // Never pass an unparsed body through to that fallback reader.
      if ((req.method === 'POST' || hasBody) && !req.is('application/json')) {
        res.status(415).json({ error: 'invalid_request' });
        return;
      }
      parse(req, res, (error) => {
        if (!error) return next();
        const status = error.status === 413 ? 413 : 400;
        res.status(status).json({ error: 'invalid_request' });
      });
    },
    (req, res, next) => {
      const pending = [{ value: req.body as unknown, depth: 0 }];
      let elements = 0;
      while (pending.length) {
        const { value, depth } = pending.pop()!;
        if (depth > 64) {
          res.status(413).json({ error: 'invalid_request' });
          return;
        }
        if (!value || typeof value !== 'object') continue;
        const children = Object.values(value);
        elements += children.length;
        if (elements > 10_000) {
          res.status(413).json({ error: 'invalid_request' });
          return;
        }
        for (const child of children)
          pending.push({ value: child, depth: depth + 1 });
      }
      next();
    },
  ];
}
