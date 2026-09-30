import { useState } from 'react';
import { ArrowRight, Headphones, Plus, Search, ShieldCheck, Users, Wrench, X } from 'lucide-react';
import { deviceName, deviceSerial, warrantyDays, warrantyLabel } from './workspace';
import { useDebounced, usePagedResource } from './useReadResource';
import { PageNavigation } from './PageNavigation';
import { RecordPicker } from './RecordPicker';
import { today } from '../shared/calendar';

type Props = {
  kind: 'devices' | 'repairs' | 'warranties';
  scope: string;
  total: number | undefined;
  customerCount: number;
  deviceCount: number;
  canEdit: boolean;
  create: (kind: string, customer: string, device?: string) => void;
  open: (customer: string, tab?: string, record?: string, device?: string) => void;
};
export function ServiceDirectory({
  kind,
  scope,
  total,
  customerCount,
  deviceCount,
  canEdit,
  create,
  open,
}: Props) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState('');
  const [targetRow, setTargetRow] = useState<any>(null);
  const [filter, setFilter] = useState(kind === 'warranties' ? '需关注' : '全部');
  const repairView = kind === 'repairs';
  const warrantyView = kind === 'warranties';
  const options = repairView
    ? ['全部', '待送修', '维修中', '已完成', '无法修复']
    : warrantyView
      ? ['需关注', '90 天内到期', '已到期', '保修中', '未填写', '全部']
      : ['全部', '双耳', '左耳', '右耳'];
  const q = useDebounced(query);
  const list = usePagedResource<any>(
    scope
      ? '/' + kind + '?paged=1&filter=' + encodeURIComponent(filter) + '&q=' + encodeURIComponent(q)
      : null,
    kind === 'warranties' ? scope + ':' + today() : scope,
  );
  const rows = list.items,
    loading = list.loading || !scope;
  const loadError = list.error ? (
    <div className="data-retry" role="alert">
      <span>{list.error}</span>
      <button className="button small" onClick={() => void list.reload().catch(() => {})}>
        重试
      </button>
    </div>
  ) : null;
  const Icon = repairView ? Wrench : warrantyView ? ShieldCheck : Headphones;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{repairView ? '设备维修' : warrantyView ? '保修提醒' : '验配设备'}</h1>
          <p>
            {total === undefined ? (
              <span className="skeleton-line skeleton-table-main" />
            ) : (
              `${total} 条${repairView ? '维修记录' : '验配记录'}`
            )}
          </p>
        </div>
        {canEdit && !warrantyView && (
          <button
            className="button primary"
            disabled={repairView ? !deviceCount : !customerCount}
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
            const device = targetRow;
            if (repairView && device) create('repair', device.customer_id, device.id);
            else if (!repairView && target) create('fitting', target);
          }}
        >
          <label className="field">
            <span>{repairView ? '选择客户的设备' : '选择客户'}</span>
            <RecordPicker
              scope={scope}
              kind={repairView ? 'devices' : 'customers'}
              value={target}
              onChange={(id, row) => {
                setTarget(id);
                setTargetRow(row);
              }}
            />
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
          {loadError ||
            (loading ? (
              <div role="status" aria-label="正在读取记录">
                {Array.from({ length: 4 }, (_, index) => (
                  <article className="directory-row" key={index}>
                    <span className="resource-icon">
                      <Icon size={21} />
                    </span>
                    <div className="directory-primary skeleton-task-body">
                      <span className="skeleton-line skeleton-task-name" />
                      <span className="skeleton-line skeleton-task-description" />
                      <span className="skeleton-line skeleton-task-date" />
                    </div>
                    <div className="directory-status">
                      <span className="skeleton-line skeleton-table-status" />
                      <small>
                        <span className="skeleton-line skeleton-task-date" />
                      </small>
                    </div>
                    <div className="directory-actions">
                      {!repairView && (
                        <button className="button small" disabled>
                          <Wrench size={14} />
                          维修
                        </button>
                      )}
                      <button className="icon-action" disabled aria-label="查看详情">
                        <ArrowRight size={18} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              rows.map((row) => {
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
                              (device.warranty && warrantyDays(device.warranty) < 0
                                ? 'is-expired'
                                : '')
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
              })
            ))}
          {!loading && !loadError && !rows.length && (
            <div className="empty">
              <Icon size={26} />
              <p>{query ? '没有匹配的记录' : '暂无符合条件的记录'}</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          {loading ? (
            <span className="skeleton-line skeleton-task-date" />
          ) : (
            `本页 ${rows.length} 条`
          )}
          <PageNavigation resource={list} />
        </div>
      </section>
    </>
  );
}
