import { useEffect, useRef, useState } from 'react';
import { ChevronRight, LogOut, Pencil, Plus, UserRound, Users } from 'lucide-react';

type Account = { email: string; name: string; enabled: boolean; self: boolean };
type Identity = { name: string; email: string; demo: boolean; storeName: string };
type Api = (path: string, method?: string, data?: unknown) => Promise<any>;

export function AccountMenu({
  anchor,
  identity,
  close,
  manage,
  logout,
}: {
  anchor: HTMLElement;
  identity: Identity;
  close: () => void;
  manage: () => void;
  logout: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();
  const bottom = rect.top > window.innerHeight / 2;
  useEffect(() => {
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
  dirty,
  saving,
}: {
  api: Api;
  identity: Identity;
  updated: () => Promise<void>;
  dirty: (value: boolean) => void;
  saving: (value: boolean) => void;
}) {
  const [rows, setRows] = useState<Account[]>([]),
    [draft, setDraft] = useState<Account | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const initial = useRef('');
  const load = async () => setRows(await api('/accounts'));
  useEffect(() => {
    load().catch((e) => setError(e.message));
    return () => dirty(false);
  }, []);
  useEffect(() => dirty(!!draft && JSON.stringify(draft) !== initial.current), [draft]);
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
          onClick={() => edit({ email: '', name: '', enabled: true, self: false }, true)}
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
      <section className="panel accounts-panel">
        <div className="account-section-heading">
          <h2>{identity.storeName}</h2>
          <span className="muted">{rows.length} 个账户 · 店主</span>
        </div>
        {adding && form}
        {rows.map((row) => (
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
              <span className={'account-state' + (!row.enabled ? ' disabled' : '')}>
                {row.enabled ? '已启用' : '已停用'}
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
          : '所有账户均为店主，可管理完整档案和其他账户。新增邮箱还需加入 Cloudflare Access 的允许登录名单。登录验证由 Cloudflare Access 提供。'}
      </p>
    </>
  );
}
