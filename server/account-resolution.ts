import { AuthError, readStaffAccounts, type AuthEnv, type Session } from './auth';
import { retentionCutoff } from './retention';
import { measureTiming, type RequestTimings } from './timing';

type Env = AuthEnv & { DB: D1Database };
type Account = {
  email: string;
  tenant_id: string;
  name: string;
  store_name: string;
  enabled: number;
  source: 'config' | 'managed';
  avatar?: string;
};
export type Store = { id: string; name: string; enabled: number; source: string };
export type AccountResolution = {
  session: Session;
  stores?: Store[];
  recoveredStore: boolean;
};
type Options = {
  includeStores?: boolean;
  recoverStore?: boolean;
  me?: boolean;
};
type Snapshot = {
  profile_email: string | null;
  profile_name: string | null;
  avatar: string | null;
  initial_member: string | null;
  initial_deleted_at: string | null;
  initial_abandoned_at: string | null;
  store_id: string | null;
  store_name: string | null;
  stores_json: string | null;
};

export function configuredAccounts(env: AuthEnv, demo: boolean): Account[] {
  if (demo)
    return [
      {
        email: 'owner@demo.invalid',
        tenant_id: 'demo-store',
        name: '演示店主',
        store_name: '聆讯听力 · 演示门店',
        enabled: 1,
        source: 'config',
      },
    ];
  return readStaffAccounts(env.STAFF_ACCOUNTS)
    .filter((a) => a.role === '店主')
    .map((a) => ({
      email: a.email,
      tenant_id: a.tenantId || '',
      name: a.name,
      store_name: a.storeName || '',
      enabled: 1,
      source: 'config' as const,
    }));
}

// One statement, one D1 snapshot/round trip. A known store uses both components
// of the membership primary key. Only the store-list endpoint asks for all stores.
export function accountSnapshotQuery(
  email: string,
  initialStore: string,
  selectedStore: string | undefined,
  mode: 'current' | 'stores' | 'profile',
  recoverStore = false,
) {
  const values: string[] = [];
  let cte = '',
    currentJoin = '',
    storeColumns = 'NULL AS store_id,NULL AS store_name,NULL AS stores_json';
  if (mode !== 'profile') {
    const where = [
      'm.email=?',
      'm.enabled=1',
      's.deleted_at IS NULL',
      '(s.abandoned_at IS NULL OR s.abandoned_at>?)',
    ];
    values.push(email, retentionCutoff());
    let order = 's.created_at,s.name';
    if (mode === 'current') {
      if (selectedStore === '') where.push('0'); // Explicit account-only context.
      if (selectedStore && !recoverStore) {
        where.push('m.tenant_id=?');
        values.push(selectedStore);
        order = ''; // Unique membership; no sorting or full store list.
      } else {
        order = 'CASE WHEN s.id=? THEN 0 ELSE 1 END,' + order;
        if (selectedStore) {
          order = 'CASE WHEN s.id=? THEN 0 ELSE 1 END,' + order;
          // Placeholder order follows SQL: requested store precedes initial store.
          values.push(selectedStore);
        }
        values.push(initialStore);
      }
    }
    cte = `WITH eligible_stores AS (
      SELECT s.id,s.name,m.enabled,m.source FROM store_memberships m JOIN stores s ON s.id=m.tenant_id
      WHERE ${where.join(' AND ')} ${order ? 'ORDER BY ' + order : ''} ${mode === 'current' ? 'LIMIT 1' : ''}
    )`;
    if (mode === 'stores') {
      storeColumns = `NULL AS store_id,NULL AS store_name,
        (SELECT json_group_array(json_object('id',id,'name',name,'enabled',enabled,'source',source))
         FROM eligible_stores) AS stores_json`;
    } else {
      storeColumns = 'e.id AS store_id,e.name AS store_name,NULL AS stores_json';
      currentJoin = 'LEFT JOIN eligible_stores e ON 1';
    }
  }
  const sql = `${cte}
    SELECT a.email AS profile_email,a.name AS profile_name,a.avatar,
      i.email AS initial_member,t.deleted_at AS initial_deleted_at,t.abandoned_at AS initial_abandoned_at,
      ${storeColumns}
    FROM (SELECT 1) request
    LEFT JOIN accounts a ON a.email=?
    LEFT JOIN store_memberships i ON i.email=? AND i.tenant_id=?
    LEFT JOIN stores t ON t.id=?
    ${currentJoin}`;
  values.push(email, email, initialStore, initialStore);
  return { sql, values };
}

async function loadAccount(
  env: Env,
  email: string,
  demo: boolean,
  selectedStore: string | undefined,
  mode: 'current' | 'stores' | 'profile',
  timings?: RequestTimings,
  options: Options = {},
) {
  const config = configuredAccounts(env, demo);
  const configured = config.find((a) => a.email === email);
  // Re-check the current provider allowlist on every request, before querying D1.
  if (!configured) throw new AuthError('此账户未由系统提供者授权，请联系系统提供者', 403);
  const read = () =>
    measureTiming(timings, options.me ? 'me_resolve_d1' : 'account_resolve_d1', async () => {
      const query = accountSnapshotQuery(
        email,
        configured.tenant_id,
        selectedStore,
        mode,
        options.recoverStore,
      );
      const snapshot = await env.DB.prepare(query.sql)
        .bind(...query.values)
        .first<Snapshot>();
      if (!snapshot) throw new Error('Missing account snapshot');
      return snapshot;
    });
  let snapshot = await read();
  const bootstrap: D1PreparedStatement[] = [];
  if (!snapshot.profile_email) {
    bootstrap.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO accounts(email,tenant_id,name,store_name,enabled,source) VALUES(?,?,?,?,1,'config')",
      ).bind(email, configured.tenant_id, configured.name, configured.store_name),
    );
  }
  // Disabled/left memberships and deleted/expired stores are tombstones, not
  // missing provisioning. They must never be recreated by the initial secret.
  if (
    configured.tenant_id &&
    !snapshot.initial_member &&
    !snapshot.initial_deleted_at &&
    (!snapshot.initial_abandoned_at || snapshot.initial_abandoned_at > retentionCutoff())
  ) {
    const peers = config.filter((a) => a.tenant_id === configured.tenant_id);
    bootstrap.push(
      env.DB.prepare('INSERT OR IGNORE INTO stores(id,name) VALUES(?,?)').bind(
        configured.tenant_id,
        configured.store_name,
      ),
      // Four bounded initial-store statements, independent of roster size.
      env.DB.prepare(
        `INSERT OR IGNORE INTO accounts(email,tenant_id,name,store_name,enabled,source)
        SELECT json_extract(value,'$.email'),json_extract(value,'$.tenant_id'),
          json_extract(value,'$.name'),json_extract(value,'$.store_name'),1,'config'
        FROM json_each(?)`,
      ).bind(JSON.stringify(peers)),
      env.DB.prepare(
        `INSERT OR IGNORE INTO store_memberships(email,tenant_id,name,enabled,source)
        SELECT json_extract(p.value,'$.email'),json_extract(p.value,'$.tenant_id'),
          json_extract(p.value,'$.name'),1,'config' FROM json_each(?) p
        JOIN stores t ON t.id=json_extract(p.value,'$.tenant_id') WHERE t.deleted_at IS NULL
          AND (t.abandoned_at IS NULL OR t.abandoned_at>datetime('now','-30 days'))`,
      ).bind(JSON.stringify(peers)),
      env.DB.prepare(
        "UPDATE stores SET abandoned_at=NULL WHERE id=? AND deleted_at IS NULL AND abandoned_at>datetime('now','-30 days')",
      ).bind(configured.tenant_id),
    );
  }
  if (bootstrap.length) {
    await measureTiming(timings, options.me ? 'me_bootstrap_d1' : 'account_bootstrap_d1', () =>
      env.DB.batch(bootstrap),
    );
    // Refresh authoritative state after bootstrap; no guessed profile or grant.
    snapshot = await read();
  }
  const account = {
    ...configured,
    name: snapshot.profile_name || configured.name,
    avatar: snapshot.avatar || '',
  };
  return { account, configured, snapshot };
}

export async function accountProfile(env: Env, email: string, demo: boolean) {
  const { account, configured } = await loadAccount(env, email, demo, undefined, 'profile');
  return { account, configured };
}

// Called after mutations, when a fresh list is required. GET /accounts/stores
// instead reuses its own authentication snapshot, never a cross-request cache.
export async function storesForAccount(env: Env, email: string): Promise<Store[]> {
  return (
    await env.DB.prepare(
      `SELECT m.tenant_id id,s.name,m.enabled,m.source
    FROM store_memberships m JOIN stores s ON s.id=m.tenant_id
    WHERE m.email=? AND m.enabled=1 AND s.deleted_at IS NULL AND (s.abandoned_at IS NULL OR s.abandoned_at>?)
    ORDER BY s.created_at,s.name`,
    )
      .bind(email, retentionCutoff())
      .all<Store>()
  ).results;
}

export async function resolveAccountRequest(
  env: Env,
  email: string,
  demo = false,
  selectedStore?: string,
  timings?: RequestTimings,
  options: Options = {},
): Promise<AccountResolution> {
  const { account, configured, snapshot } = await loadAccount(
    env,
    email,
    demo,
    selectedStore,
    options.includeStores ? 'stores' : 'current',
    timings,
    options,
  );
  const stores: Store[] | undefined = options.includeStores
    ? JSON.parse(snapshot.stores_json || '[]')
    : undefined;
  const defaultStore = () => stores?.find((r) => r.id === configured.tenant_id) || stores?.[0];
  const store = stores
    ? selectedStore === ''
      ? undefined
      : selectedStore
        ? stores.find((r) => r.id === selectedStore) ||
          (options.recoverStore ? defaultStore() : undefined)
        : defaultStore()
    : snapshot.store_id
      ? { id: snapshot.store_id, name: snapshot.store_name! }
      : undefined;
  const recoveredStore = !!selectedStore && store?.id !== selectedStore;
  if (recoveredStore && !options.recoverStore)
    throw new AuthError('此账户没有当前门店的访问权限', 403);
  return {
    session: {
      role: '店主',
      tenant_id: store?.id || '',
      name: account.name,
      email,
      storeName: store?.name || '',
      actor: `${account.name} <${email}>`,
      avatar: account.avatar,
    },
    stores,
    recoveredStore,
  };
}

export async function resolveAccount(
  env: Env,
  email: string,
  demo = false,
  selectedStore?: string,
): Promise<Session> {
  return (await resolveAccountRequest(env, email, demo, selectedStore)).session;
}
