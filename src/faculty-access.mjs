import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const scope = new AsyncLocalStorage();
export const facultyId = () => scope.getStore() ?? null;
export const asFaculty = (id, work) => scope.run(id, work);
export function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200)
    throw new Error('Use a password of 12–200 characters.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
export function passwordMatches(password, encoded) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [salt, digest] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(digest, 'hex'));
}
export function assertOwner(owner) {
  if (facultyId() && owner !== facultyId())
    throw Object.assign(new Error('Resource not found.'), { code: 'NOT_FOUND', status: 404 });
}
