import type { ReactNode } from 'react';
import { ClipboardList } from 'lucide-react';
export const statuses = ['全部客户', '待评估', '试戴中', '已验配', '长期随访'];

export function Badge({ status }: { status: string }) {
  return (
    <span className={'badge status-' + statuses.indexOf(status)}>
      <i />
      {status}
    </span>
  );
}
export function Empty({ text = '还没有记录', action }: { text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <ClipboardList size={30} />
      <p>{text}</p>
      {action}
    </div>
  );
}
export function LoadingRows({
  lines = 3,
  label = '正在读取数据',
}: {
  lines?: number;
  label?: string;
}) {
  return (
    <div className="loading-rows" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div className="loading-row" key={index}>
          <span className="skeleton-mark" />
          <span className="skeleton-line" style={{ width: `${68 - index * 9}%` }} />
          <span className="skeleton-line skeleton-end" />
        </div>
      ))}
    </div>
  );
}

export function Stat({
  onClick,
  label,
  value,
  unit,
  detail,
  icon,
  warning = false,
  loading = false,
}: {
  onClick?: () => void;
  label: string;
  value: number;
  unit: string;
  detail: string;
  icon: ReactNode;
  warning?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={'stat ' + (warning ? 'warning' : '')}
    >
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {loading ? (
          <span
            className="skeleton-line skeleton-number"
            role="status"
            aria-label={`${label}正在加载`}
          />
        ) : (
          <>
            {value}
            <small>{unit}</small>
          </>
        )}
      </div>
      <p>{detail}</p>
    </button>
  );
}
