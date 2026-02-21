import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export class CursorPaginationDto {
  cursor?: string;
  limit?: number | string = 10;
}

export interface CursorPaginatedResponse<T> {
  data: T[];
  meta: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

type CursorPayload = {
  createdAt: string;
  id: string;
};

export function normalizePaginationLimit(
  limit: number | string | undefined,
): number {
  if (typeof limit === 'number') {
    if (!Number.isFinite(limit)) return 10;
    return Math.max(1, Math.min(Math.floor(limit), 100));
  }

  if (typeof limit === 'string') {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.max(1, Math.min(parsed, 100));
  }

  return 10;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as CursorPayload;

    if (!decoded?.createdAt || !decoded?.id) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function applyCursorPagination<
  TEntity extends ObjectLiteral & { id: string; createdAt: Date },
>(
  qb: SelectQueryBuilder<TEntity>,
  options: {
    cursor?: string;
    limit?: number | string;
    createdAtField?: string;
    idField?: string;
  },
): Promise<CursorPaginatedResponse<TEntity>> {
  const take = normalizePaginationLimit(options.limit);
  const createdAtField = options.createdAtField ?? 'createdAt';
  const idField = options.idField ?? 'id';

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      qb.andWhere(
        `(${qb.alias}.${createdAtField} < :cursorCreatedAt OR (${qb.alias}.${createdAtField} = :cursorCreatedAt AND ${qb.alias}.${idField} < :cursorId))`,
        {
          cursorCreatedAt: decoded.createdAt,
          cursorId: decoded.id,
        },
      );
    }
  }

  qb.orderBy(`${qb.alias}.${createdAtField}`, 'DESC');
  qb.addOrderBy(`${qb.alias}.${idField}`, 'DESC');
  qb.take(take + 1);

  const items = await qb.getMany();
  const hasNextPage = items.length > take;
  const data = hasNextPage ? items.slice(0, take) : items;
  const lastItem = data[data.length - 1];

  return {
    data,
    meta: {
      nextCursor:
        hasNextPage && lastItem
          ? encodeCursor({
              createdAt: lastItem.createdAt.toISOString(),
              id: lastItem.id,
            })
          : null,
      hasNextPage,
    },
  };
}
