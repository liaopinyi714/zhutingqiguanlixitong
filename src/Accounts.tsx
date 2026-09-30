import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  ChevronRight,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { AccountAvatar, avatarThumbnail } from './AccountAvatar';
import { RequestOrder } from './requestOrder';
import { refreshAfterWrite } from './refreshAfterWrite';
import { BUSINESS_TIME_ZONE, DAY_MS, RETENTION_DAYS, timestamp } from '../shared/calendar';

type Account = {
  email: string;
  name: string;
  enabled: boolean;
  self: boolean;
  online: boolean;
  lastSeenAt: number | null;
  avatar?: string;
  leftAt?: string | null;
};
type Store = { id: string; name: string; current: boolean };
type Identity = {
  name: string;
  email: string;
  demo: boolean;
  storeName: string;
  tenant_id: string;
  avatar?: string;
};
type Api = (path: string, method?: string, data?: unknown) => Promise<any>;

function AccountRowsSkeleton({ kind, count = 2 }: { kind: 'store' | 'account'; count?: number }) {
  return (
    <div role="status" aria-label={kind === 'store' ? '正在读取门店' : '正在读取账户'}>
      {Array.from({ length: count }, (_, index) => (
        <div className={kind === 'store' ? '' : 'account-row-wrap'} key={index}>
          <div className={kind === 'store' ? 'account-store-row' : 'account-row'}>
            {kind === 'store' ? (
              <span className="account-store-icon">
                <Building2 size={18} strokeWidth={1.6} />
              </span>
            ) : (
              <span className="account-avatar skeleton-mark" />
            )}
            <div className={kind === 'store' ? 'account-skeleton-copy' : 'account-identity'}>
              <strong>
                <span className="skeleton-line account-skeleton-title" />
              </strong>
              <span className="skeleton-line account-skeleton-subtitle" />
            </div>
            {kind === 'store' ? (
              <>
                <button className="icon-button" disabled aria-label="修改门店名称">
                  <Pencil size={16} />
                </button>
                <button className="button small" disabled>
                  <LogOut size={15} />
                  退出
                </button>
                <button className="icon-button" disabled aria-label="删除门店">
                  <Trash2 size={16} />
                </button>
              </>
            ) : (
              <>
                <span className="skeleton-line account-skeleton-action" />
                <button className="icon-button" disabled aria-label="账户操作">
                  <Pencil size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AccountsSkeleton() {
  return (
    <>
      <div className="page-heading">
        <h1>账户管理</h1>
        <button className="button primary" disabled>
          <Plus size={17} />
          添加已有店主
        </button>
      </div>
      <section className="panel accounts-stores">
        <div className="account-section-heading">
          <h2>门店</h2>
          <button className="button" disabled>
            <Plus size={16} />
            新建门店
          </button>
        </div>
        <div className="account-store-list">
          <AccountRowsSkeleton kind="store" count={1} />
        </div>
      </section>
      <section className="panel accounts-panel">
        <div className="account-section-heading">
          <h2>
            <span className="skeleton-line account-skeleton-title" />
          </h2>
          <span className="skeleton-line account-skeleton-action" />
        </div>
        <AccountRowsSkeleton kind="account" count={2} />
      </section>
    </>
  );
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
    api('/accounts/stores')
      .then(setStores)
      .catch(() => {});
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
        <AccountAvatar avatar={identity.avatar} name={identity.name} />
        <div>
          <strong>{identity.name || '店主'}</strong>
          <small>{identity.email}</small>
        </div>
      </div>
      {stores.length > 1 && (
        <div className="account-menu-stores">
          <small>切换门店</small>
          {stores.map((store) => (
            <button
              key={store.id}
              className={store.current ? 'current' : ''}
              disabled={store.current}
              onClick={() => {
                close();
                void switchStore(store.id);
              }}
            >
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
    [removedStores, setRemovedStores] = useState<(Store & { deleted_at: string })[]>([]),
    [leftStores, setLeftStores] = useState<(Store & { left_at: string })[]>([]),
    [deleteStoreName, setDeleteStoreName] = useState<string | null>(null),
    [avatarBusy, setAvatarBusy] = useState(false),
    [draft, setDraft] = useState<Account | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const initial = useRef('');
  const requestOrder = useRef(new RequestOrder());
  const loadAccounts = async () => {
    const isLatest = requestOrder.current.begin('accounts');
    setRowsError(false);
    try {
      const accounts = await api('/accounts');
      if (!isLatest()) return;
      setRows(accounts);
      setRowsLoaded(true);
    } catch (reason) {
      if (isLatest()) setRowsError(true);
      throw reason;
    }
  };
  const loadStores = async () => {
    const isLatest = requestOrder.current.begin('stores');
    setStoresError(false);
    try {
      const [active, removed, left] = await Promise.all([
        api('/accounts/stores'),
        api('/accounts/stores/removed'),
        api('/accounts/stores/left'),
      ]);
      if (!isLatest()) return;
      setStores(active);
      setRemovedStores(removed);
      setLeftStores(left);
      setStoresLoaded(true);
    } catch (reason) {
      if (isLatest()) setStoresError(true);
      throw reason;
    }
  };
  const load = async () => {
    await Promise.all([loadAccounts(), loadStores()]);
  };
  useEffect(() => {
    void loadAccounts().catch(() => {});
    void loadStores().catch(() => {});
    return () => {
      requestOrder.current.begin('accounts');
      requestOrder.current.begin('stores');
      dirty(false);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load().catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () =>
      dirty(
        (!!draft && JSON.stringify(draft) !== initial.current) ||
          deleteStoreName !== null ||
          (!!storeMode && storeDraft.trim() !== (storeMode === 'rename' ? identity.storeName : '')),
      ),
    [draft, storeDraft, storeMode, identity.storeName, deleteStoreName],
  );
  async function removeStore(event: React.FormEvent) {
    event.preventDefault();
    if (avatarBusy) return;
    setBusy(true);
    saving(true);
    setError('');
    try {
      const result = await api(
        '/accounts/stores/' + encodeURIComponent(identity.tenant_id),
        'DELETE',
        { name: deleteStoreName },
      );
      setDeleteStoreName(null);
      setDraft(null);
      setStoreMode('');
      dirty(false);
      saving(false);
      await switchStore(result.nextStoreId);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      saving(false);
    }
  }
  async function restoreStore(store: Store) {
    setBusy(true);
    saving(true);
    setError('');
    try {
      await api('/accounts/stores/' + encodeURIComponent(store.id) + '/restore', 'POST');
      await refreshAfterWrite(loadStores, setError);
      setNotice('门店已恢复');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      saving(false);
    }
  }
  async function leaveStore() {
    if (
      draft &&
      JSON.stringify(draft) !== initial.current &&
      !window.confirm('放弃尚未保存的个人资料修改？')
    )
      return;
    if (
      !window.confirm(
        `退出“${identity.storeName}”？30 天内可自行恢复加入；若所有成员都退出，门店也将在 30 天后清理。`,
      )
    )
      return;
    setBusy(true);
    saving(true);
    setError('');
    try {
      const result = await api(
        '/accounts/stores/' + encodeURIComponent(identity.tenant_id) + '/leave',
        'POST',
      );
      setDraft(null);
      setStoreMode('');
      setDeleteStoreName(null);
      dirty(false);
      saving(false);
      await switchStore(result.nextStoreId);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      saving(false);
    }
  }
  async function rejoinStore(store: Store) {
    if (
      draft &&
      JSON.stringify(draft) !== initial.current &&
      !window.confirm('放弃尚未保存的个人资料修改？')
    )
      return;
    setBusy(true);
    saving(true);
    setError('');
    try {
      await api('/accounts/stores/' + encodeURIComponent(store.id) + '/rejoin', 'POST');
      dirty(false);
      window.location.reload();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
      saving(false);
    }
  }
  function expiresAt(date: string) {
    return new Date(timestamp(date).getTime() + RETENTION_DAYS * DAY_MS).toLocaleDateString(
      'zh-CN',
      { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' },
    );
  }
  async function saveStore(event: React.FormEvent) {
    event.preventDefault();
    if (avatarBusy) return;
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
        await refreshAfterWrite(async () => {
          await updated();
          await load();
        }, setError);
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
    if (!isNew && !value.self) return;
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
    if (avatarBusy) return;
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
      await api(
        '/accounts',
        'PUT',
        value.self
          ? { email: value.email, name: value.name, enabled: true, avatar: value.avatar }
          : { email: value.email, enabled: value.enabled },
      );
      setDraft(null);
      dirty(false);
      await refreshAfterWrite(async () => {
        await load();
        await updated();
      }, setError);
      setNotice(
        adding ? '已有店主已加入当前门店' : value.self ? '个人资料已保存' : '门店访问权限已更新',
      );
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
      {!adding && (
        <div className="account-avatar-editor">
          <AccountAvatar avatar={draft.avatar} name={draft.name} />
          <label className={'button small avatar-upload' + (busy || avatarBusy ? ' disabled' : '')}>
            <Upload size={15} />
            {avatarBusy ? '处理图片…' : draft.avatar ? '更换头像' : '添加头像'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || avatarBusy}
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                setAvatarBusy(true);
                saving(true);
                setError('');
                try {
                  const avatar = await avatarThumbnail(file);
                  setDraft((current) => (current ? { ...current, avatar } : current));
                } catch (reason) {
                  setError((reason as Error).message);
                } finally {
                  setAvatarBusy(false);
                  saving(false);
                }
              }}
            />
          </label>
          {draft.avatar && (
            <button
              type="button"
              className="icon-button"
              disabled={busy || avatarBusy}
              title="移除头像"
              aria-label="移除头像"
              onClick={() => setDraft({ ...draft, avatar: '' })}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
      {!adding && (
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
      )}
      <label>
        登录邮箱
        <input
          type="email"
          autoFocus={adding}
          required
          maxLength={254}
          readOnly={!adding}
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        />
      </label>
      <div className="account-form-actions">
        <button type="button" className="button" disabled={busy || avatarBusy} onClick={cancel}>
          取消
        </button>
        <button className="button primary" disabled={busy || avatarBusy}>
          {busy ? '保存中…' : adding ? '添加到门店' : '保存'}
        </button>
      </div>
    </form>
  );
  return (
    <>
      <div className="page-heading">
        <h1>账户管理</h1>
        {identity.tenant_id && (
          <button
            className="button primary"
            disabled={busy || avatarBusy}
            onClick={() =>
              edit(
                {
                  email: '',
                  name: '',
                  enabled: true,
                  self: false,
                  online: false,
                  lastSeenAt: null,
                },
                true,
              )
            }
          >
            <Plus size={17} />
            添加已有店主
          </button>
        )}
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
          <button
            className="button"
            disabled={busy || avatarBusy}
            onClick={() => {
              setStoreDraft('');
              setStoreMode('new');
              setDeleteStoreName(null);
              setNotice('');
            }}
          >
            <Plus size={16} />
            新建门店
          </button>
        </div>
        <div className="account-store-list">
          {storesLoaded && stores.length === 0 && (
            <p className="account-empty-stores">
              尚未加入门店。可新建门店，或请店主添加你的登录邮箱。
            </p>
          )}
          {!storesLoaded ? (
            storesError ? (
              <div className="data-retry" role="alert">
                <span>门店列表暂时无法读取</span>
                <button className="button small" onClick={() => void loadStores().catch(() => {})}>
                  重试
                </button>
              </div>
            ) : (
              <AccountRowsSkeleton kind="store" count={1} />
            )
          ) : (
            stores.map((store) => (
              <div className="account-store-row" key={store.id}>
                <span className="account-store-icon">
                  <Building2 size={18} strokeWidth={1.6} />
                </span>
                <div>
                  <strong>{store.name}</strong>
                  <small>{store.current ? '当前门店' : '独立客户档案'}</small>
                </div>
                {store.current ? (
                  <button
                    className="icon-button"
                    aria-label="修改门店名称"
                    title="修改门店名称"
                    disabled={busy || avatarBusy}
                    onClick={() => {
                      setStoreDraft(store.name);
                      setStoreMode('rename');
                      setDeleteStoreName(null);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                ) : (
                  <button
                    className="button"
                    disabled={busy || avatarBusy}
                    onClick={() => void switchStore(store.id)}
                  >
                    切换
                  </button>
                )}
                {store.current && (
                  <button
                    className="button small"
                    disabled={busy || avatarBusy}
                    onClick={() => void leaveStore()}
                  >
                    <LogOut size={15} />
                    退出
                  </button>
                )}
                {store.current && (
                  <button
                    className="icon-button"
                    title="删除门店"
                    aria-label="删除门店"
                    disabled={busy || avatarBusy}
                    onClick={() => {
                      setDeleteStoreName('');
                      setStoreMode('');
                      setError('');
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
        {deleteStoreName !== null && (
          <form className="account-store-delete" onSubmit={removeStore}>
            <p>
              删除后，所有账户将无法进入这家门店。客户和业务资料保留 30
              天，可在下方恢复门店；到期后自动清理。
            </p>
            <label>
              输入“{identity.storeName}”确认删除
              <input
                autoFocus
                value={deleteStoreName}
                maxLength={80}
                disabled={busy || avatarBusy}
                onChange={(event) => setDeleteStoreName(event.target.value)}
              />
            </label>
            <div className="account-form-actions">
              <button
                type="button"
                className="button"
                disabled={busy || avatarBusy}
                onClick={() => setDeleteStoreName(null)}
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={busy || avatarBusy || deleteStoreName.trim() !== identity.storeName}
              >
                {busy ? '删除中…' : '删除门店'}
              </button>
            </div>
          </form>
        )}
        {storeMode && (
          <form className="account-store-form" onSubmit={saveStore}>
            <label>
              {storeMode === 'new' ? '新门店名称' : '门店名称'}
              <input
                autoFocus
                maxLength={80}
                required
                value={storeDraft}
                onChange={(event) => setStoreDraft(event.target.value)}
              />
            </label>
            <button
              className="button"
              type="button"
              disabled={busy || avatarBusy}
              onClick={() => {
                setStoreMode('');
                dirty(false);
              }}
            >
              取消
            </button>
            <button className="button primary" disabled={busy || avatarBusy}>
              {busy ? '保存中…' : storeMode === 'new' ? '创建并进入' : '保存名称'}
            </button>
          </form>
        )}
        {removedStores.length > 0 && (
          <details className="account-removed-stores">
            <summary>
              已删除门店 <span className="muted">{removedStores.length}</span>
            </summary>
            {removedStores.map((store) => (
              <div className="account-store-row" key={store.id}>
                <span className="account-store-icon">
                  <Building2 size={18} />
                </span>
                <div>
                  <strong>{store.name}</strong>
                  <small>{expiresAt(store.deleted_at)} 前可恢复</small>
                </div>
                <button
                  className="button small"
                  disabled={busy || avatarBusy}
                  onClick={() => void restoreStore(store)}
                >
                  <RotateCcw size={15} />
                  恢复
                </button>
              </div>
            ))}
          </details>
        )}
        {leftStores.length > 0 && (
          <section className="account-left-stores">
            <h3>已退出门店</h3>
            {leftStores.map((store) => (
              <div className="account-store-row" key={store.id}>
                <span className="account-store-icon">
                  <Building2 size={18} />
                </span>
                <div>
                  <strong>{store.name}</strong>
                  <small>{expiresAt(store.left_at)} 前可恢复加入</small>
                </div>
                <button
                  className="button small"
                  disabled={busy || avatarBusy}
                  onClick={() => void rejoinStore(store)}
                >
                  <RotateCcw size={15} />
                  恢复加入
                </button>
              </div>
            ))}
          </section>
        )}
      </section>
      <section className="panel accounts-panel">
        <div className="account-section-heading">
          <h2>{identity.storeName || '个人资料'}</h2>
          {rowsLoaded ? (
            <span className="muted">{rows.length} 个账户</span>
          ) : (
            <span className="skeleton-line account-skeleton-action" />
          )}
        </div>
        {adding && (
          <div>
            <p className="account-new-hint">
              填写系统提供者已开通的登录邮箱，添加至 {identity.storeName}。
            </p>
            {form}
          </div>
        )}
        {!rowsLoaded ? (
          rowsError ? (
            <div className="data-retry" role="alert">
              <span>账户列表暂时无法读取</span>
              <button className="button small" onClick={() => void loadAccounts().catch(() => {})}>
                重试
              </button>
            </div>
          ) : (
            <AccountRowsSkeleton kind="account" count={2} />
          )
        ) : (
          rows.map((row) => (
            <div className="account-row-wrap" key={row.email}>
              <div className="account-row">
                <AccountAvatar avatar={row.avatar} name={row.name} />
                {row.self ? (
                  <button
                    className="account-identity"
                    disabled={busy || avatarBusy}
                    onClick={() => edit(row)}
                  >
                    <strong>
                      {row.name}
                      {row.self && <small>我</small>}
                    </strong>
                    <span>{row.email}</span>
                  </button>
                ) : (
                  <div className="account-identity account-identity-readonly">
                    <strong>{row.name}</strong>
                    <span>{row.email}</span>
                  </div>
                )}
                <span
                  className={
                    'account-state' +
                    (row.leftAt
                      ? ' left'
                      : !row.enabled
                        ? ' disabled'
                        : row.online
                          ? ' online'
                          : '')
                  }
                >
                  <i />
                  {row.leftAt ? '已退出' : !row.enabled ? '已停用' : row.online ? '在线' : '离线'}
                </span>
                {row.self && (
                  <button
                    className="icon-button"
                    aria-label={`编辑${row.name}`}
                    disabled={busy || avatarBusy}
                    onClick={() => edit(row)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {!row.self && (
                  <button
                    className="button"
                    disabled={busy || avatarBusy}
                    onClick={() => {
                      if (
                        window.confirm(
                          row.leftAt
                            ? `取消 ${row.name} 自行恢复加入门店的资格？`
                            : `${row.enabled ? '停用' : '启用'} ${row.name} 的门店访问权限？`,
                        )
                      )
                        save({ ...row, enabled: row.leftAt ? false : !row.enabled });
                    }}
                  >
                    {row.leftAt ? '取消恢复资格' : row.enabled ? '停用' : '启用'}
                  </button>
                )}
              </div>
              {!adding && draft?.email === row.email && form}
            </div>
          ))
        )}
      </section>
      <p className="account-help">
        {identity.demo
          ? '演示账户仅用于本地体验。'
          : '登录账户由系统提供者开通。在线表示最近 2 分半钟内在当前门店有活动。'}
      </p>
    </>
  );
}
