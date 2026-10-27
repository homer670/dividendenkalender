// MessageFormat-like access to the Portfolio Performance UI texts

import { M } from './ppMessages';

export function msg(key: string, ...args: (string | number)[]): string {
  const text = M[key] ?? key;
  if (args.length === 0) return text.replace(/''/g, "'");
  return text.replace(/\{(\d+)(,[^}]*)?\}/g, (m, i) => {
    const v = args[Number(i)];
    return v === undefined ? m : String(v);
  }).replace(/''/g, "'");
}
