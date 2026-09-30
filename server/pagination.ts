import { z } from 'zod';

export class ListInputError extends Error {}
const input = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().default(''),
  filter: z.string().default('全部'),
  cursor: z.string().max(2048).optional(),
  paged: z.enum(['0', '1']).optional(),
});
export function listInput(query: Record<string, string>, filters: readonly string[]) {
  const parsed = input.safeParse(query);
  if (!parsed.success || !filters.includes(parsed.data.filter))
    throw new ListInputError('列表参数无效，请刷新列表后重试');
  const pattern = `%${parsed.data.q.replace(/[!%_]/g, (char) => `!${char}`)}%`;
  if (new TextEncoder().encode(pattern).length > 50)
    throw new ListInputError('搜索关键词过长，请缩短后重试');
  return { ...parsed.data, pattern };
}
type Key = string | number;
export function encodeCursor(scope: string, keys: Key[]) {
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ v: 1, scope, keys }))),
  )
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
export function decodeCursor(
  token: string | undefined,
  scope: string,
  keyCount: number,
): Key[] | null {
  if (!token) return null;
  try {
    if (!/^[a-zA-Z0-9_-]{1,2048}$/.test(token)) throw new Error();
    const raw = token.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')), (char) =>
      char.charCodeAt(0),
    );
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      parsed.v !== 1 ||
      parsed.scope !== scope ||
      !Array.isArray(parsed.keys) ||
      parsed.keys.length !== keyCount ||
      parsed.keys.some((key: unknown) =>
        typeof key === 'string'
          ? key.length > 160
          : typeof key !== 'number' || !Number.isFinite(key),
      )
    )
      throw new Error();
    return parsed.keys;
  } catch {
    throw new ListInputError('分页位置已失效，请从第一页重新加载');
  }
}

// The cursor is a position, never an authorization token. Every query still
// binds the verified store and checks active parents before applying LIMIT.
export function pageResult(
  rows: any[],
  limit: number,
  scope: string,
  columns: string[],
  map: (row: any) => any,
) {
  const items = rows.slice(0, limit);
  return {
    items: items.map(map),
    nextCursor:
      rows.length > limit
        ? encodeCursor(
            scope,
            columns.map((column) => items.at(-1)![column]),
          )
        : null,
  };
}
