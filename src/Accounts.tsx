import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronRight, LogOut, Pencil, Plus, UserRound, Users } from 'lucide-react';

type Account = {
  email: string; name: string; enabled: boolean; self: boolean;
  online: boolean; lastSeenAt: number | null;
};
type Store = { id: string; name: string; current: boolean };
type Identity = { name: string; email: string; demo: boolean; storeName: string; tenant_id: string };
type Api = (path: string, method?: string, data?: unknown) => Promise<any>;

function AccountRowsSkeleton({ kind, count = 2 }: { kind: 'store' | 'account'; count?: number }) {
  return <div role="status" aria-label={kind === 'store' ? '正在读取门店' : '正在读取账户'}>
    {Array.from({ length: count }, (_, index) => (
      <div className={kind === 'store' ? 'account-store-row' : 'account-row'} key={index}>
        <span className="skeleton-mark account-skeleton-icon" />
        <div className="account-skeleton-copy">
          <span className="skeleton-line account-skeleton-title" />
          <span className="skeleton-line account-skeleton-subtitle" />
        </div>
        <span className="skeleton-line account-skeleton-action" />
      </div>
    ))}
  </div>;
}

export function AccountsSkeleton() {
  return <>
    <div className="page-heading"><h1>账户管理</h1><button className="button primary" disabled><Plus size={17} />添加店主</button></div>
    <section className="panel accounts-stores">
      <div className="account-section-heading"><h2>门店</h2><button className="button" disabled><Plus size={16} />新建门店</button></div>
      <div className="account-store-list"><AccountRowsSkeleton kind="store" count={1} /></div>
    </section>
    <section className="panel accounts-panel">
      <div className="account-section-heading"><h2><span className="skeleton-line account-skeleton-title" /></h2><span className="skeleton-line account-skeleton-action" /></div>
      <AccountRowsSkeleton kind="account" count={2} />
    </section>
  </>;
}

export function AccountMenu({
  anchor,
  identity,
  api,
  switchStore,
  close,
  manage,
  logout,
}: {
  anchor: HTMLElement;
  identity: Identity;
  api: Api;
  switchStore: (storeId: string) => Promise<void>;
  close: () => void;
  manage: () => void;
  logout: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const rect = anchor.getBoundingClientRect();
  const bottom = rect.top > window.innerHeight / 2;
  useEffect(() => {
    api('/accounts/stores').then(setStores).catch(() => {});
    ref.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node))
        close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        anchor.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node))
        close();
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [anchor, close]);
  return (
    <div
      ref={ref}
      className="account-menu"
      role="dialog"
      aria-label="我的账户"
      style={{
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 292)),
        ...(bottom ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      }}
    >
      <div className="account-menu-heading">
        <span className="account-avatar">
          <UserRound size={18} />
        </span>
        <div>
          <strong>{identity.name || '店主'}</strong>
          <small>{identity.email}</small>
        </div>
      </div>
      {stores.length > 1 && (
        <div className="account-menu-stores">
          <small>切换门店</small>
          {stores.map((store) => (
            <button key={store.id} className={store.current ? 'current' : ''}
              disabled={store.current}
              onClick={() => { close(); void switchStore(store.id); }}>
              <Building2 size={16} />
              <span>{store.name}</span>
              {store.current && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
      <button onClick={manage}>
        <Users size={17} />
        <span>账户管理</span>
        <ChevronRight size={15} />
      </button>
      <button onClick={logout}>
        <LogOut size={17} />
        <span>退出登录</span>
      </button>
    </div>
  );
}

export function Accounts({
  api,
  identity,
  updated,
  switchStore,
  dirty,
  saving,
}: {
  api: Api;
  identity: Identity;
  updated: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
  dirty: (value: boolean) => void;
  saving: (value: boolean) => void;
}) {
  const [rows, setRows] = useState<Account[]>([]),
    [stores, setStores] = useState<Store[]>([]),
    [rowsLoaded, setRowsLoaded] = useState(false),
    [storesLoaded, setStoresLoaded] = useState(false),
    [rowsError, setRowsError] = useState(false),
    [storesError, setStoresError] = useState(false),
    [storeDraft, setStoreDraft] = useState(''),
    [storeMode, setStoreMode] = useState<'new' | 'rename' | ''>(''),
    [draft, setDraft] = useState<Account | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const initial = useRef('');
  const loadAccounts = async () => {
    setRowsError(false);
    try {
      setRows(await api('/accounts'));
      setRowsLoaded(true);
    } catch (reason) {
      setRowsError(true);
      throw reason;
    }
  };
  const loadStores = async () => {
    setStoresError(false);
    try {
      setStores(await api('/accounts/stores'));
      setStoresLoaded(true);
    } catch (reason) {
      setStoresError(true);
      throw reason;
    }
  };
  const load = async () => {
    await Promise.all([loadAccounts(), loadStores()]);
  };
  useEffect(() => {
    void loadAccounts().catch(() => {});
    void loadStores().catch(() => {});
    return () => dirty(false);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load().catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => dirty(
    (!!draft && JSON.stringify(draft) !== initial.current) ||
    (!!storeMode && storeDraft.trim() !== (storeMode === 'rename' ? identity.storeName : '')),
  ), [draft, storeDraft, storeMode, identity.storeName]);
  async function saveStore(event: React.FormEvent) {
    event.preventDefault();
    const name = storeDraft.trim();
    if (!name) return;
    if (storeMode === 'new' && draft && JSON.stringify(draft) !== initial.current) {
      if (!window.confirm('放弃尚未保存的账户修改并进入新门店？')) return;
      setDraft(null);
    }
    setBusy(true);
    saving(true);
    setError('');
    try {
      if (storeMode === 'new') {
        const created = await api('/accounts/stores', 'POST', { name });
        setStoreMode('');
        dirty(false);
        saving(false);
        setBusy(false);
        await switchStore(created.id);
      } else {
        await api('/accounts/stores/' + encodeURIComponent(identity.tenant_id), 'PATCH', { name });
        setStoreMode('');
        dirty(false);
        await updated();
        await load();
        setNotice('门店名称已更新');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      saving(false);
    }
  }
  function edit(value: Account, isNew = false) {
    if (
      draft &&
      JSON.stringify(draft) !== initial.current &&
      !window.confirm('放弃尚未保存的账户修改？')
    )
      return;
    initial.current = JSON.stringify(value);
    setDraft(value);
    setAdding(isNew);
    setError('');
    setNotice('');
  }
  function cancel() {
    if (
      draft &&
      JSON.stringify(draft) !== initial.current &&
      !window.confirm('放弃尚未保存的账户修改？')
    )
      return;
    setDraft(null);
    dirty(false);
  }
  async function save(value: Account) {
    if (
      value !== draft &&
      draft &&
      JSON.stringify(draft) !== initial.current &&
      !window.confirm('放弃尚未保存的账户修改？')
    )
      return;
    setBusy(true);
    saving(true);
    setError('');
    setNotice('');
    try {
      await api('/accounts', 'PUT', value);
      setDraft(null);
      dirty(false);
      await load();
      await updated();
      setNotice('账户已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      saving(false);
    }
  }
  const form = draft && (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault();
        save(draft);
      }}
    >
      <label>
        名称
        <input
          autoFocus
          required
          maxLength={60}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        登录邮箱
        <input
          type="email"
          required
          maxLength={254}
          readOnly={!adding}
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        />
      </label>
      <div className="account-form-actions">
        <button type="button" className="button" disabled={busy} onClick={cancel}>
          取消
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
  return (
    <>
      <div className="page-heading">
        <h1>账户管理</h1>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => edit({ email: '', name: '', enabled: true, self: false, online: false, lastSeenAt: null }, true)}
        >
          <Plus size={17} />
          添加店主
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="panel accounts-stores">
        <div className="account-section-heading">
          <h2>门店</h2>
          <button className="button" disabled={busy} onClick={() => {
            setStoreDraft('');
            setStoreMode('new');
            setNotice('');
          }}><Plus size={16} />新建门店</button>
        </div>
        <div className="account-store-list">
          {!storesLoaded ? storesError ? <div className="data-retry" role="alert"><span>门店列表暂时无法读取</span><button className="button small" onClick={() => void loadStores().catch(() => {})}>重试</button></div> : <AccountRowsSkeleton kind="store" count={1} /> : stores.map((store) => (
            <div className="account-store-row" key={store.id}>
              <span className="account-store-icon"><Building2 size={18} strokeWidth={1.6} /></span>
              <div><strong>{store.name}</strong><small>{store.current ? '当前门店' : '独立客户档案'}</small></div>
              {store.current
                ? <button className="icon-button" aria-label="修改门店名称" title="修改门店名称"
                    disabled={busy} onClick={() => {
                      setStoreDraft(store.name);
                      setStoreMode('rename');
                    }}><Pencil size={16} /></button>
                : <button className="button" disabled={busy} onClick={() => void switchStore(store.id)}>切换</button>}
            </div>
          ))}
        </div>
        {storeMode && <form className="account-store-form" onSubmit={saveStore}>
          <label>{storeMode === 'new' ? '新门店名称' : '门店名称'}
            <input autoFocus maxLength={80} required value={storeDraft}
              onChange={(event) => setStoreDraft(event.target.value)} />
          </label>
          <button className="button" type="button" disabled={busy} onClick={() => {
            setStoreMode('');
            dirty(false);
          }}>取消</button>
          <button className="button primary" disabled={busy}>
            {busy ? '保存中…' : storeMode === 'new' ? '创建并进入' : '保存名称'}
          </button>
        </form>}
      </section>
      <section className="panel accounts-panel">
        <div className="account-section-heading">
          <h2>{identity.storeName}</h2>
          {rowsLoaded ? <span className="muted">{rows.length} 个账户</span> : <span className="skeleton-line account-skeleton-action" />}
        </div>
        {adding && form}
        {!rowsLoaded ? rowsError ? <div className="data-retry" role="alert"><span>账户列表暂时无法读取</span><button className="button small" onClick={() => void loadAccounts().catch(() => {})}>重试</button></div> : <AccountRowsSkeleton kind="account" count={2} /> : rows.map((row) => (
          <div className="account-row-wrap" key={row.email}>
            <div className="account-row">
              <span className="account-avatar">
                <UserRound size={19} />
              </span>
              <button className="account-identity" disabled={busy} onClick={() => edit(row)}>
                <strong>
                  {row.name}
                  {row.self && <small>我</small>}
                </strong>
                <span>{row.email}</span>
              </button>
              <span className={'account-state' + (!row.enabled ? ' disabled' : row.online ? ' online' : '')}>
                <i />{!row.enabled ? '已停用' : row.online ? '在线' : '离线'}
              </span>
              <button
                className="icon-button"
                aria-label={`编辑${row.name}`}
                disabled={busy}
                onClick={() => edit(row)}
              >
                <Pencil size={16} />
              </button>
              {!row.self && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `${row.enabled ? '停用' : '启用'} ${row.name} 的门店访问权限？`,
                      )
                    )
                      save({ ...row, enabled: !row.enabled });
                  }}
                >
                  {row.enabled ? '停用' : '启用'}
                </button>
              )}
            </div>
            {!adding && draft?.email === row.email && form}
          </div>
        ))}
      </section>
      <p className="account-help">
        {identity.demo
          ? '演示账户仅用于本地体验。'
          : '新增账户需同时加入 Cloudflare Access 的允许登录名单。在线表示最近 2 分半钟内在当前门店有活动。'}
      </p>
    </>
  );
}
