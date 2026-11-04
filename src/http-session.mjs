const roles = {
  instructor: { name: 'gotit_faculty', path: '/api/instructor' },
  candidate: { name: 'gotit_student', path: '/api/me' },
  proctor: { name: 'gotit_proctor', path: '/api/proctor' }
};
function cookieSettings(req, role) {
  const settings = roles[role];
  const id = req.headers['x-session-id'];
  if (id !== undefined && !/^[a-f0-9-]{36}$/.test(id))
    throw Object.assign(new Error('Browser session identifier is invalid.'), { code: 'INVALID_SESSION', status: 400 });
  return { ...settings, name: settings.name + (id ? `_${id}` : '') };
}

export function accessToken(req, role) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (bearer) return bearer;
  const { name } = cookieSettings(req, role);
  return String(req.headers.cookie ?? '').split(';').map(value => value.trim())
    .find(value => value.startsWith(name + '='))?.slice(name.length + 1);
}

export function browserSession(req, res, role, result, publicOrigin) {
  if (req.headers['x-session-mode'] !== 'cookie') return result;
  const { name, path } = cookieSettings(req, role);
  const secure = req.socket.encrypted || publicOrigin?.startsWith('https:');
  res.setHeader('Set-Cookie', `${name}=${result.token}; Path=${path}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
  const { token, ...safeResult } = result;
  return safeResult;
}

export function clearBrowserSession(req, res, role, publicOrigin) {
  const { name, path } = cookieSettings(req, role);
  const secure = req.socket.encrypted || publicOrigin?.startsWith('https:');
  res.setHeader('Set-Cookie', `${name}=; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}

export function checkRequestOrigin(req, publicOrigin) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const expected = publicOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
  if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== expected))
    throw Object.assign(new Error('Request origin is not allowed.'), { code: 'INVALID_ORIGIN', status: 403 });
}
