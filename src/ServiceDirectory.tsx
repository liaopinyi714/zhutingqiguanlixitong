import { useState, type ReactNode } from 'react';
import { ArrowRight, Headphones, Plus, Search, ShieldCheck, Users, Wrench, X } from 'lucide-react';
import { deviceName, deviceSerial, warrantyDays, warrantyLabel } from './workspace';

type Props = {
  kind: 'devices' | 'repairs' | 'warranties';
  devices: any[];
  repairs: any[];
  customers: { id: string; name: string }[];
  canEdit: boolean;
  loading?: boolean;
  loadError?: ReactNode;
  create: (kind: string, customer: string, device?: string) => void;
  open: (customer: string, tab?: string, record?: string, device?: string) => void;
};
export function ServiceDirectory({
  kind,
  devices,
  repairs,
  customers,
  canEdit,
  loading = false,
  loadError,
  create,
  open,
}: Props) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState('');
  const [filter, setFilter] = useState(kind === 'warranties' ? '需关注' : '全部');
  const repairView = kind === 'repairs';
  const warrantyView = kind === 'warranties';
  const options = repairView
    ? ['全部', '待送修', '维修中', '已完成', '无法修复']
    : warrantyView
      ? ['需关注', '90 天内到期', '已到期', '保修中', '未填写', '全部']
      : ['全部', '双耳', '左耳', '右耳'];
  const source = repairView ? repairs : devices;
  const matches = (row: any) => {
    if (filter === '全部') return true;
    if (repairView) return row.status === filter;
    if (!warrantyView) return row.side === filter;
    if (filter === '未填写') return !row.warranty;
    if (!row.warranty) return false;
    const days = warrantyDays(row.warranty);
    if (filter === '需关注') return days <= 90;
    return filter === '已到期'
      ? days < 0
      : filter === '保修中'
        ? days >= 0
        : days >= 0 && days <= 90;
  };
  const rows = source.filter(
    (row) =>
      matches(row) &&
      [
        row.name,
        row.phone,
        row.problem,
        row.parts,
        row.work_done,
        deviceName(row.device || row),
        deviceSerial(row.device || row),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  if (warrantyView) rows.sort((a, b) => (a.warranty || '9999').localeCompare(b.warranty || '9999'));
  const Icon = repairView ? Wrench : warrantyView ? ShieldCheck : Headphones;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{repairView ? '设备维修' : warrantyView ? '保修提醒' : '验配设备'}</h1>
          <p>
            {loading ? <span className="skeleton-line skeleton-table-main" /> : `${source.length} 条${repairView ? '维修记录' : '验配记录'}`}
          </p>
        </div>
        {canEdit && !warrantyView && (
          <button
            className="button primary"
            disabled={repairView ? !devices.length : !customers.length}
            onClick={() => setCreating(!creating)}
          >
            <Plus size={16} />
            {repairView ? '登记维修' : '新增验配'}
          </button>
        )}
      </div>
      {creating && (
        <form
          className="directory-create panel"
          onSubmit={(event) => {
            event.preventDefault();
            const device = devices.find((row) => row.id === target);
            if (repairView && device) create('repair', device.customer_id, device.id);
            else if (!repairView && target) create('fitting', target);
          }}
        >
          <label className="field">
            <span>{repairView ? '选择客户的设备' : '选择客户'}</span>
            <select required value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">请选择</option>
              {repairView
                ? devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} · {deviceName(device)} · {deviceSerial(device)}
                    </option>
                  ))
                : customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
            </select>
          </label>
          <button className="button primary" type="submit">
            继续
            <ArrowRight size={15} />
          </button>
          <button className="button" type="button" onClick={() => setCreating(false)}>
            取消
          </button>
        </form>
      )}
      <section className="panel directory-panel">
        <div className="directory-toolbar">
          <div className="filter-pills" aria-label="筛选记录">
            {options.map((option) => (
              <button
                key={option}
                className={filter === option ? 'active' : ''}
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="搜索设备与客户"
              placeholder={repairView ? '客户、设备、故障或零件' : '客户、型号或序列号'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            )}
          </label>
        </div>
        <div className="directory-list">
          {loadError || (loading ? <div role="status" aria-label="正在读取记录">{Array.from({ length: 4 }, (_, index) => (
            <article className="directory-row" key={index}>
              <span className="resource-icon"><Icon size={21} /></span>
              <div className="directory-primary skeleton-task-body"><span className="skeleton-line skeleton-task-name" /><span className="skeleton-line skeleton-task-description" /><span className="skeleton-line skeleton-task-date" /></div>
              <div className="directory-status"><span className="skeleton-line skeleton-task-action" /></div>
              <div className="directory-actions"><span className="skeleton-line skeleton-task-action" /></div>
            </article>
          ))}</div> : rows.map((row) => {
            const device = row.device || row;
            return (
              <article className="directory-row" key={row.id}>
                <span className="resource-icon">
                  <Icon size={21} />
                </span>
                <div className="directory-primary">
                  <button
                    className="resource-title"
                    onClick={() =>
                      open(row.customer_id, repairView ? '维修记录' : '验配记录', row.id)
                    }
                  >
                    {repairView ? row.problem || '维修详情' : deviceName(device)}
                    <ArrowRight size={15} />
                  </button>
                  <div className="resource-meta">
                    <button className="relation-link" onClick={() => open(row.customer_id)}>
                      <Users size={14} />
                      {row.name}
                    </button>
                    <span>{repairView ? row.occurred_date : row.date}</span>
                    <span>{device.side}</span>
                  </div>
                  {repairView ? (
                    <button
                      className="relation-link device-relation"
                      onClick={() => open(row.customer_id, '验配记录', row.fitting_id)}
                    >
                      <Headphones size={14} />
                      {deviceName(device)}
                    </button>
                  ) : (
                    <small className="serial-text">{deviceSerial(device)}</small>
                  )}
                </div>
                <div className="directory-status">
                  {repairView ? (
                    <>
                      <span
                        className={
                          'service-status ' + (row.status === '已完成' ? 'is-complete' : '')
                        }
                      >
                        {row.status}
                      </span>
                      <small>¥ {new Intl.NumberFormat('zh-CN').format(row.price)}</small>
                    </>
                  ) : (
                    <>
                      <span
                        className={
                          'service-status ' +
                          (device.warranty && warrantyDays(device.warranty) < 0 ? 'is-expired' : '')
                        }
                      >
                        {warrantyLabel(device.warranty)}
                      </span>
                      <small>{device.warranty || '—'}</small>
                    </>
                  )}
                </div>
                <div className="directory-actions">
                  {!repairView && (
                    <button
                      className="button small"
                      onClick={() => open(row.customer_id, '维修记录', '', row.id)}
                    >
                      <Wrench size={14} />
                      维修{row.repair_count > 0 ? ` · ${row.repair_count}` : ''}
                    </button>
                  )}
                  <button
                    className="icon-action"
                    aria-label={'查看' + (repairView ? '维修' : '验配') + '详情'}
                    onClick={() =>
                      open(row.customer_id, repairView ? '维修记录' : '验配记录', row.id)
                    }
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </article>
            );
          }))}
          {!loading && !loadError && !rows.length && (
            <div className="empty">
              <Icon size={26} />
              <p>{query ? '没有匹配的记录' : '暂无符合条件的记录'}</p>
            </div>
          )}
        </div>
        <div className="table-footer">{loading ? <span className="skeleton-line skeleton-task-date" /> : `共 ${rows.length} 条`}</div>
      </section>
    </>
  );
}
