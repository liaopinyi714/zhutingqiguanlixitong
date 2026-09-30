import { useState } from 'react';
import { Search } from 'lucide-react';
import { api } from './api';
import { useDebounced, usePagedResource } from './useReadResource';
import { PageNavigation } from './PageNavigation';
import { deviceName, deviceSerial } from './workspace';

// The native select stays small; searching and paging reach the whole store.
export function RecordPicker({
  scope,
  kind = 'customers',
  value,
  onChange,
  selectedLabel = '',
  disabled = false,
}: {
  scope: string;
  kind?: 'customers' | 'devices';
  value: string;
  onChange: (id: string, row?: any) => void;
  selectedLabel?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(''),
    q = useDebounced(query);
  const list = usePagedResource<any>(
    scope ? `/${kind}?paged=1&limit=30&q=${encodeURIComponent(q)}` : null,
    scope,
  );
  const label = (row: any) =>
    kind === 'devices'
      ? `${row.name} · ${deviceName(row)} · ${deviceSerial(row)}`
      : `${row.name}${row.phone ? ' · ' + row.phone : ''}`;
  const [chosen, setChosen] = useState<any>(null),
    [error, setError] = useState('');
  return (
    <div>
      <div className="search">
        <Search size={15} />
        <input
          aria-label="搜索候选客户或设备"
          placeholder={kind === 'devices' ? '搜索客户、型号或序列号' : '搜索客户姓名、电话或编号'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
      </div>
      <select
        required
        value={value}
        disabled={disabled}
        onChange={async (e) => {
          const id = e.target.value;
          const row = list.items.find((row) => row.id === id);
          setChosen(row);
          setError('');
          if (kind === 'customers' && id && !row) {
            try {
              const profile = await api('/customers/' + encodeURIComponent(id));
              onChange(id, profile);
            } catch (reason) {
              setError((reason as Error).message);
            }
          } else onChange(id, row);
        }}
      >
        <option value="">{list.loading ? '正在读取…' : '请选择'}</option>
        {value && !list.items.some((row) => row.id === value) && (
          <option value={value}>
            {chosen?.id === value ? label(chosen) : selectedLabel || value}
          </option>
        )}
        {list.items.map((row) => (
          <option key={row.id} value={row.id}>
            {label(row)}
          </option>
        ))}
      </select>
      {(error || list.error) && <small role="alert">{error || list.error}</small>}
      <PageNavigation resource={list} />
    </div>
  );
}
