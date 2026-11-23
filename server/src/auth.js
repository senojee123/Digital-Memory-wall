import crypto from 'node:crypto';

const secret = () => process.env.AUTH_SECRET || 'dev-secret';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function issueToken(hours = 12) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + hours * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token = '') {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

export function passwordMatches(input = '') {
  const a = Buffer.from(String(input));
  const b = Buffer.from(process.env.ADMIN_PASSWORD || 'change-me');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
