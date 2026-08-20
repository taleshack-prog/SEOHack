import { clearCookie } from '../../lib/auth.mjs';
export default function handler(req, res) {
  clearCookie(res);
  res.statusCode = 302;
  res.setHeader('Location', '/login');
  res.end();
}
