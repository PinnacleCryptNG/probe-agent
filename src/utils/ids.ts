import { randomUUID } from 'node:crypto';

export type IdPrefix =
  | 'inv'
  | 'evi'
  | 'msg'
  | 'fnd'
  | 'hyp'
  | 'chl'
  | 'evnt'
  | 'req'
  | 'exec'
  | 'usr'
  | 'plan'
  | 'turn';

/**
 * Generates a collision-resistant prefixed identifier.
 * Example: inv_8b7f8c14-2c35-4318-971c-3c872412803b
 */
export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}

export function isValidId(id: string, prefix?: IdPrefix): boolean {
  if (!id || typeof id !== 'string') return false;
  if (prefix) {
    return id.startsWith(`${prefix}_`) && id.length > prefix.length + 1;
  }
  const parts = id.split('_');
  return parts.length >= 2 && parts[0].length >= 2;
}
