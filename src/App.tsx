import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  Clock3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Ear,
  FileText,
  Headphones,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Plus,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  Trash2,
  X,
} from 'lucide-react';
import { frequencies, pta } from '../server/domain';

type Customer = {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  phone: string;
  contact: string;
  contactPhone: string;
  address: string;
  source: string;
  status: string;
  history: string;
  needs: string;
  created_at: string;
  deleted_at?: string;
};
type Point = { frequency: number; value: number | null; noResponse: boolean; masked: boolean };
type Exam = {
  id?: string;
  date: string;
  right: Point[];
  left: Point[];
  boneRight: Point[];
  boneLeft: Point[];
  speech: string;
  other: string;
  conclusion: string;
};
type Follow = {
  id: string;
  customer_id: string;
  name: string;
  phone: string;
  due: string;
  type: string;
  note: string;
  completed: number;
  result: string;
};
type Detail = {
  exams: Exam[];
  fittings: any[];
  followups: Follow[];
  attachments: any[];
  audit: any[];
};
type DeviceCatalog = {
  brands: { id: string; name: string }[];
  series: { id: string; brand_id: string; name: string }[];
  models: { id: string; series_id: string; name: string }[];
};
const statuses = ['全部客户', '待评估', '试戴中', '已验配', '长期随访'];
const today = () => new Date().toLocaleDateString('sv-SE');
const age = (date: string) => {
  const d = new Date(date),
    n = new Date();
  return (
    n.getFullYear() -
    d.getFullYear() -
    (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())
      ? 1
      : 0)
  );
};
const money = (n: number) => new Intl.NumberFormat('zh-CN').format(n);
const daysUntil = (date: string) =>
  Math.round(
    (new Date(date + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000,
  );
const localTime = (value: string) =>
  new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', {
    hour12: false,
  });
async function api(path: string, method = 'GET', data?: unknown) {
  const response = await fetch('/api' + path, {
    method,
    headers: data instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function Badge({ status }: { status: string }) {
  return (
    <span className={'badge status-' + statuses.indexOf(status)}>
      <i />
      {status}
    </span>
  );
}
function Empty({ text = '还没有记录', action }: { text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <ClipboardList size={30} />
      <p>{text}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);
  useEffect(() => {
    const oldFocus = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = modalRef.current!;
    const elements = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select,textarea,a[href]',
        ),
      );
    elements()
      .find((e) => e.tagName === 'INPUT')
      ?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = elements(),
        first = all[0],
        last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = oldOverflow;
      node.removeEventListener('keydown', trap);
      oldFocus?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={modalRef}
        className={'modal ' + (wide ? 'large' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <small>聆序 · 客户服务</small>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Audiogram({ exam, previous }: { exam: Exam; previous?: Exam }) {
  const width = 550,
    height = 570,
    x = (f: number) => 55 + (Math.log2(f / 125) / 6) * 450,
    y = (n: number) => 30 + (n + 10) * 3.75;
  const symbol = (p: Point, key: string, color: string, bone: boolean, left: boolean) => {
    if (p.value === null) return null;
    const xx = x(p.frequency),
      yy = y(p.value);
    return (
      <g key={key} stroke={color} strokeWidth="2" fill="white">
        <title>{`${left ? '左耳' : '右耳'}${bone ? '骨导' : '气导'} ${p.frequency} Hz：${p.value} dB HL${p.masked ? '（掩蔽）' : ''}${p.noResponse ? '，无反应' : ''}`}</title>
        {bone ? (
          <path
            d={
              p.masked
                ? left
                  ? `M${xx - 5},${yy - 6}h7v12h-7`
                  : `M${xx + 5},${yy - 6}h-7v12h7`
                : left
                  ? `M${xx - 4},${yy - 6}l7,6l-7,6`
                  : `M${xx + 4},${yy - 6}l-7,6l7,6`
            }
            fill="none"
          />
        ) : p.masked ? (
          left ? (
            <rect x={xx - 5} y={yy - 5} width="10" height="10" />
          ) : (
            <path d={`M${xx},${yy - 6}l6,11h-12Z`} />
          )
        ) : left ? (
          <path d={`M${xx - 5},${yy - 5}l10,10m0,-10l-10,10`} fill="none" />
        ) : (
          <circle cx={xx} cy={yy} r="5" />
        )}
        {p.noResponse && (
          <path
            d={left ? `M${xx + 4},${yy + 5}l8,8m-6,0h6v-6` : `M${xx - 4},${yy + 5}l-8,8m0,-6v6h6`}
            fill="none"
          />
        )}
      </g>
    );
  };
  const line = (points: Point[], color: string, opacity = 1) => {
    let connect = false;
    const path = [...points]
      .sort((a, b) => a.frequency - b.frequency)
      .map((p) => {
        if (p.noResponse) {
          connect = false;
          return '';
        }
        if (p.value === null) return '';
        const command = connect ? 'L' : 'M';
        connect = true;
        return `${command}${x(p.frequency)},${y(p.value)}`;
      })
      .join(' ');
    return (
      <path
        d={path}
        stroke={color}
        strokeWidth="1.8"
        opacity={opacity}
        fill="none"
        strokeDasharray={opacity < 1 ? '5 4' : undefined}
      />
    );
  };
  return (
    <svg
      className="audiogram"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="左右耳纯音听力图，横轴频率，纵轴听阈"
    >
      <rect x="55" y="30" width="450" height="487.5" fill="#fff" />
      {Array.from({ length: 14 }, (_, i) => i * 10 - 10).map((n) => (
        <g key={n}>
          <line x1="55" x2="505" y1={y(n)} y2={y(n)} stroke={n === 20 ? '#d3dfdb' : '#e9edeb'} />
          <text x="43" y={y(n) + 4} textAnchor="end" className="chart-label">
            {n}
          </text>
        </g>
      ))}
      {frequencies.map((f) => (
        <g key={f}>
          <line
            x1={x(f)}
            x2={x(f)}
            y1="30"
            y2="517.5"
            stroke="#e9edeb"
            strokeDasharray={[750, 1500, 3000, 6000].includes(f) ? '3 3' : undefined}
          />
          {![750, 1500, 3000, 6000].includes(f) && (
            <text x={x(f)} y="541" textAnchor="middle" className="chart-label">
              {f >= 1000 ? f / 1000 + 'k' : f}
            </text>
          )}
        </g>
      ))}
      <text x="14" y="15" className="chart-label">
        dB HL
      </text>
      <text x="495" y="561" className="chart-label">
        Hz
      </text>
      {previous && (
        <>
          {line(previous.right, '#be6058', 0.28)}
          {line(previous.left, '#497fba', 0.28)}
        </>
      )}
      {line(exam.right, '#bd615c')}
      {line(exam.left, '#4a7faf')}
      {exam.right.map((p, i) => symbol(p, 'r' + i, '#bd615c', false, false))}
      {exam.left.map((p, i) => symbol(p, 'l' + i, '#4a7faf', false, true))}
      {exam.boneRight.map((p, i) => symbol(p, 'br' + i, '#bd615c', true, false))}
      {exam.boneLeft.map((p, i) => symbol(p, 'bl' + i, '#4a7faf', true, true))}
    </svg>
  );
}

function DeviceCatalogManager({
  catalog,
  role,
  reload,
}: {
  catalog: DeviceCatalog;
  role: string;
  reload: () => Promise<void>;
}) {
  const [brandChoice, setBrandChoice] = useState('');
  const [seriesChoice, setSeriesChoice] = useState('');
  const [names, setNames] = useState({ brands: '', series: '', models: '' });
  const [editing, setEditing] = useState<{ kind: string; id: string; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const brandId = catalog.brands.some((b) => b.id === brandChoice)
    ? brandChoice
    : catalog.brands[0]?.id || '';
  const visibleSeries = catalog.series.filter((s) => s.brand_id === brandId);
  const seriesId = visibleSeries.some((s) => s.id === seriesChoice)
    ? seriesChoice
    : visibleSeries[0]?.id || '';
  const visibleModels = catalog.models.filter((m) => m.series_id === seriesId);
  const levels = [
    { kind: 'brands', title: '品牌', rows: catalog.brands, parentId: '' },
    { kind: 'series', title: '系列', rows: visibleSeries, parentId: brandId },
    { kind: 'models', title: '型号', rows: visibleModels, parentId: seriesId },
  ] as const;
  async function create(kind: 'brands' | 'series' | 'models', parentId: string) {
    const name = names[kind].trim();
    if (!name || (kind !== 'brands' && !parentId)) return;
    setWorking(true);
    setMessage('');
    try {
      const created = await api(`/device-catalog/${kind}`, 'POST', {
        name,
        ...(kind === 'series'
          ? { brandId: parentId }
          : kind === 'models'
            ? { seriesId: parentId }
            : {}),
      });
      setNames((current) => ({ ...current, [kind]: '' }));
      if (kind === 'brands') setBrandChoice(created.id);
      if (kind === 'series') setSeriesChoice(created.id);
      await reload();
      setMessage(`${{ brands: '品牌', series: '系列', models: '型号' }[kind]}已添加`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function update(kind: string, id: string, name?: string) {
    if (working) return;
    const archive = name === undefined;
    if (
      archive &&
      !window.confirm('停用后将不再出现在新验配记录中，已有记录仍保留原名称。确定停用吗？')
    )
      return;
    setWorking(true);
    setMessage('');
    try {
      await api(
        `/device-catalog/${kind}/${id}`,
        archive ? 'DELETE' : 'PUT',
        archive ? undefined : { name: name?.trim() },
      );
      setEditing(null);
      await reload();
      setMessage(archive ? '字典项已停用' : '名称已更新');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="panel padded catalog-panel">
      <div className="section-title">
        <div>
          <h2>助听器型号字典</h2>
          <p className="muted">先建品牌，再建系列和型号；新验配记录可直接选择。</p>
        </div>
        <Headphones size={20} />
      </div>
      {message && (
        <p className="catalog-message" role="status">
          {message}
        </p>
      )}
      <div className="catalog-grid">
        {levels.map(({ kind, title, rows, parentId }) => (
          <div className="catalog-level" key={kind}>
            <h3>
              {title}
              <small>{rows.length}</small>
            </h3>
            <div className="catalog-items">
              {rows.length ? (
                rows.map((row) => (
                  <div
                    className={
                      'catalog-item ' +
                      ((kind === 'brands' ? brandId : kind === 'series' ? seriesId : '') === row.id
                        ? 'selected'
                        : '')
                    }
                    key={row.id}
                  >
                    {editing?.kind === kind && editing.id === row.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void update(kind, row.id, editing.name);
                        }}
                      >
                        <input
                          aria-label={`修改${title}名称`}
                          value={editing.name}
                          maxLength={kind === 'brands' ? 50 : 80}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          required
                        />
                        <button className="button small" disabled={working}>
                          保存
                        </button>
                        <button
                          type="button"
                          className="button small"
                          onClick={() => setEditing(null)}
                        >
                          取消
                        </button>
                      </form>
                    ) : (
                      <>
                        {kind === 'models' ? (
                          <span className="catalog-select" title={row.name}>
                            {row.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="catalog-select"
                            title={row.name}
                            onClick={() =>
                              kind === 'brands'
                                ? (setBrandChoice(row.id), setSeriesChoice(''))
                                : setSeriesChoice(row.id)
                            }
                          >
                            {row.name}
                          </button>
                        )}
                        {role === '店主' && (
                          <div className="catalog-actions">
                            <button
                              type="button"
                              disabled={working}
                              onClick={() => setEditing({ kind, id: row.id, name: row.name })}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              disabled={working}
                              onClick={() => void update(kind, row.id)}
                            >
                              停用
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted catalog-empty">暂无{title}</p>
              )}
            </div>
            {role === '店主' && (
              <form
                className="catalog-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create(kind, parentId);
                }}
              >
                <input
                  aria-label={`新建${title}`}
                  placeholder={`输入${title}名称`}
                  value={names[kind]}
                  maxLength={kind === 'brands' ? 50 : 80}
                  onChange={(e) => setNames((current) => ({ ...current, [kind]: e.target.value }))}
                  disabled={working || (kind !== 'brands' && !parentId)}
                  required
                />
                <button
                  className="button small"
                  disabled={working || (kind !== 'brands' && !parentId)}
                  type="submit"
                >
                  <Plus size={15} /> 添加
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
      <p className="muted catalog-footnote">
        停用字典项只影响今后的选择；已保存的验配记录保持原样。
      </p>
    </section>
  );
}

const blankCurve = () =>
  frequencies.map((frequency) => ({ frequency, value: null, masked: false, noResponse: false }));

function IntakePage({
  catalog,
  role,
  onSave,
  onCancel,
}: {
  catalog: DeviceCatalog;
  role: string;
  onSave: (payload: { customer: any; exam?: Exam; fitting?: any; followup?: any }) => Promise<void>;
  onCancel: () => void;
}) {
  const [profile, setProfile] = useState({
    name: '',
    gender: '未填写',
    birthDate: '',
    phone: '',
    address: '',
    contact: '',
    contactPhone: '',
    source: '自然到店',
    status: '待评估',
    history: '',
    needs: '',
  });
  const [examEnabled, setExamEnabled] = useState(false);
  const [exam, setExam] = useState<Exam>({
    date: today(),
    right: blankCurve(),
    left: blankCurve(),
    boneRight: blankCurve(),
    boneLeft: blankCurve(),
    speech: '',
    other: '',
    conclusion: '',
  });
  const [fittingEnabled, setFittingEnabled] = useState(false);
  const [brandId, setBrandId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [modelId, setModelId] = useState('');
  const [fitting, setFitting] = useState({
    date: today(),
    side: '双耳',
    serial: '',
    amount: 0,
    warranty: '',
    notes: '',
  });
  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [followup, setFollowup] = useState({ due: today(), type: '适应回访', note: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const series = catalog.series.filter((item) => item.brand_id === brandId);
  const models = catalog.models.filter((item) => item.series_id === seriesId);
  const setPoint = (
    key: 'right' | 'left' | 'boneRight' | 'boneLeft',
    index: number,
    patch: Partial<Point>,
  ) =>
    setExam((current) => ({
      ...current,
      [key]: current[key].map((point, i) => (i === index ? { ...point, ...patch } : point)),
    }));
  async function submitIntake(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const brand = catalog.brands.find((item) => item.id === brandId);
      const selectedSeries = catalog.series.find((item) => item.id === seriesId);
      const model = catalog.models.find((item) => item.id === modelId);
      if (fittingEnabled && (!brand || !selectedSeries || !model))
        throw new Error('请完整选择助听器品牌、系列和型号');
      await onSave({
        customer: profile,
        ...(examEnabled ? { exam } : {}),
        ...(fittingEnabled
          ? {
              fitting: {
                ...fitting,
                amount: Number(fitting.amount),
                deviceModelId: modelId,
                brand: brand!.name,
                series: selectedSeries!.name,
                model: model!.name,
              },
            }
          : {}),
        ...(followupEnabled ? { followup } : {}),
      });
    } catch (reason) {
      setFormError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="intake-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">客户建档</span>
          <h1>新建客户档案</h1>
          <p>在同一页完成基本资料、听力检查、验配与首次随访；未勾选的部分可稍后补充。</p>
        </div>
        <button className="button" type="button" onClick={onCancel}>
          返回客户列表
        </button>
      </div>
      <form onSubmit={submitIntake}>
        {formError && (
          <div className="error" role="alert">
            {formError}
          </div>
        )}
        <section className="panel padded intake-section">
          <div className="section-title">
            <div>
              <span className="eyebrow">01 · 必填</span>
              <h2>基本资料</h2>
            </div>
            <Users size={20} />
          </div>
          <div className="form-grid">
            <Field label="客户姓名 *">
              <input
                required
                maxLength={40}
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              />
            </Field>
            <Field label="性别">
              <select
                value={profile.gender}
                onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
              >
                {['未填写', '男', '女'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="出生日期 *">
              <input
                type="date"
                required
                min="1900-01-01"
                max={today()}
                value={profile.birthDate}
                onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })}
              />
            </Field>
            <Field label="客户电话">
              <input
                maxLength={30}
                value={profile.phone}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                placeholder="演示时请使用虚构号码"
              />
            </Field>
            <Field label="住址" wide>
              <input
                maxLength={300}
                value={profile.address}
                onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                placeholder="省、市、区及详细地址"
              />
            </Field>
            <Field label="其他联系人姓名 / 关系">
              <input
                maxLength={100}
                value={profile.contact}
                onChange={(e) => setProfile({ ...profile, contact: e.target.value })}
              />
            </Field>
            <Field label="其他联系人电话">
              <input
                maxLength={30}
                value={profile.contactPhone}
                onChange={(e) => setProfile({ ...profile, contactPhone: e.target.value })}
              />
            </Field>
            <Field label="客户来源">
              <select
                value={profile.source}
                onChange={(e) => setProfile({ ...profile, source: e.target.value })}
              >
                {['自然到店', '老客转介绍', '社区活动', '线上咨询', '其他'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="服务阶段">
              <select
                value={profile.status}
                onChange={(e) => setProfile({ ...profile, status: e.target.value })}
              >
                {statuses.slice(1).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="听力与健康情况" wide>
              <textarea
                value={profile.history}
                onChange={(e) => setProfile({ ...profile, history: e.target.value })}
                placeholder="主诉、耳部病史、既往助听器使用情况…"
              />
            </Field>
            <Field label="聆听需求与期望" wide>
              <textarea
                value={profile.needs}
                onChange={(e) => setProfile({ ...profile, needs: e.target.value })}
              />
            </Field>
          </div>
        </section>
        {role !== '前台' && (
          <section className="panel padded intake-section">
            <div className="section-title">
              <div>
                <span className="eyebrow">02 · 可选</span>
                <h2>听力检查与听力图</h2>
              </div>
              <label className="intake-toggle">
                <input
                  type="checkbox"
                  checked={examEnabled}
                  onChange={(e) => setExamEnabled(e.target.checked)}
                />{' '}
                同时录入
              </label>
            </div>
            {examEnabled ? (
              <>
                <div className="form-grid">
                  <Field label="检查日期 *">
                    <input
                      type="date"
                      required
                      max={today()}
                      value={exam.date}
                      onChange={(e) => setExam({ ...exam, date: e.target.value })}
                    />
                  </Field>
                </div>
                <p className="form-hint">
                  听阈范围 −10 至 120 dB HL。留空表示未测；掩蔽和无反应按测点单独标记。
                </p>
                <div className="threshold-scroll">
                  <table className="threshold-table">
                    <thead>
                      <tr>
                        <th>频率 Hz</th>
                        {frequencies.map((frequency) => (
                          <th key={frequency}>{frequency}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['right', '右耳气导'],
                          ['left', '左耳气导'],
                          ['boneRight', '右耳骨导'],
                          ['boneLeft', '左耳骨导'],
                        ] as const
                      ).map(([key, label]) => (
                        <tr key={key}>
                          <th
                            className={
                              key.toLowerCase().includes('right') ? 'ear-right' : 'ear-left'
                            }
                          >
                            {label}
                          </th>
                          {exam[key].map((point, index) => (
                            <td key={point.frequency}>
                              <input
                                aria-label={`${label} ${point.frequency} Hz`}
                                type="number"
                                min="-10"
                                max="120"
                                step="5"
                                value={point.value ?? ''}
                                onChange={(e) =>
                                  setPoint(key, index, {
                                    value: e.target.value === '' ? null : Number(e.target.value),
                                    noResponse: e.target.value === '' ? false : point.noResponse,
                                  })
                                }
                              />
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`${label} ${point.frequency} 掩蔽`}
                                  checked={point.masked}
                                  onChange={(e) =>
                                    setPoint(key, index, { masked: e.target.checked })
                                  }
                                />
                                掩蔽
                              </label>
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`${label} ${point.frequency} 无反应`}
                                  checked={point.noResponse}
                                  disabled={point.value === null}
                                  onChange={(e) =>
                                    setPoint(key, index, { noResponse: e.target.checked })
                                  }
                                />
                                无反应
                              </label>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="intake-chart">
                  <Audiogram exam={exam} />
                </div>
                <div className="form-grid">
                  <Field label="言语测听" wide>
                    <textarea
                      value={exam.speech}
                      onChange={(e) => setExam({ ...exam, speech: e.target.value })}
                    />
                  </Field>
                  <Field label="其他检查结果" wide>
                    <textarea
                      value={exam.other}
                      onChange={(e) => setExam({ ...exam, other: e.target.value })}
                    />
                  </Field>
                  <Field label="检查结论与建议 *" wide>
                    <textarea
                      required
                      value={exam.conclusion}
                      onChange={(e) => setExam({ ...exam, conclusion: e.target.value })}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <p className="muted">勾选后可输入左右耳气导、骨导，实时查看听力图并填写检查结果。</p>
            )}
          </section>
        )}
        {role !== '前台' && (
          <section className="panel padded intake-section">
            <div className="section-title">
              <div>
                <span className="eyebrow">03 · 可选</span>
                <h2>验配信息</h2>
              </div>
              <label className="intake-toggle">
                <input
                  type="checkbox"
                  checked={fittingEnabled}
                  onChange={(e) => setFittingEnabled(e.target.checked)}
                />{' '}
                同时录入
              </label>
            </div>
            {fittingEnabled ? (
              <div className="form-grid">
                <Field label="验配日期 *">
                  <input
                    type="date"
                    required
                    max={today()}
                    value={fitting.date}
                    onChange={(e) => setFitting({ ...fitting, date: e.target.value })}
                  />
                </Field>
                <Field label="佩戴耳侧">
                  <select
                    value={fitting.side}
                    onChange={(e) => setFitting({ ...fitting, side: e.target.value })}
                  >
                    {['双耳', '左耳', '右耳'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="品牌 *">
                  <select
                    required
                    value={brandId}
                    onChange={(e) => {
                      setBrandId(e.target.value);
                      setSeriesId('');
                      setModelId('');
                    }}
                  >
                    <option value="">选择品牌</option>
                    {catalog.brands.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="系列 *">
                  <select
                    required
                    value={seriesId}
                    onChange={(e) => {
                      setSeriesId(e.target.value);
                      setModelId('');
                    }}
                  >
                    <option value="">选择系列</option>
                    {series.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="型号 *">
                  <select required value={modelId} onChange={(e) => setModelId(e.target.value)}>
                    <option value="">选择型号</option>
                    {models.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="设备序列号">
                  <input
                    maxLength={100}
                    value={fitting.serial}
                    onChange={(e) => setFitting({ ...fitting, serial: e.target.value })}
                  />
                </Field>
                <Field label="成交金额（元）">
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    value={fitting.amount}
                    onChange={(e) => setFitting({ ...fitting, amount: Number(e.target.value) })}
                  />
                </Field>
                <Field label="保修截止日期">
                  <input
                    type="date"
                    value={fitting.warranty}
                    onChange={(e) => setFitting({ ...fitting, warranty: e.target.value })}
                  />
                </Field>
                <Field label="调试、验证与交付说明 *" wide>
                  <textarea
                    required
                    value={fitting.notes}
                    onChange={(e) => setFitting({ ...fitting, notes: e.target.value })}
                  />
                </Field>
              </div>
            ) : (
              <p className="muted">勾选后从门店型号字典选择设备，并填写保修、调试和交付信息。</p>
            )}
          </section>
        )}
        <section className="panel padded intake-section">
          <div className="section-title">
            <div>
              <span className="eyebrow">04 · 可选</span>
              <h2>首次随访计划</h2>
            </div>
            <label className="intake-toggle">
              <input
                type="checkbox"
                checked={followupEnabled}
                onChange={(e) => setFollowupEnabled(e.target.checked)}
              />{' '}
              同时安排
            </label>
          </div>
          {followupEnabled ? (
            <div className="form-grid">
              <Field label="计划日期 *">
                <input
                  type="date"
                  required
                  value={followup.due}
                  onChange={(e) => setFollowup({ ...followup, due: e.target.value })}
                />
              </Field>
              <Field label="服务类型">
                <select
                  value={followup.type}
                  onChange={(e) => setFollowup({ ...followup, type: e.target.value })}
                >
                  {['适应回访', '听力复查', '清洁保养', '维修跟进', '到店预约'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="计划内容 *" wide>
                <textarea
                  required
                  value={followup.note}
                  onChange={(e) => setFollowup({ ...followup, note: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <p className="muted">可在建档时安排首次回访，也可稍后从客户档案中补充。</p>
          )}
        </section>
        <div className="intake-actions">
          <span>所有已勾选部分将一次保存到同一位客户档案。</span>
          <button type="button" className="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? '保存中…' : '保存完整档案'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState(''),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState('overview'),
    [customers, setCustomers] = useState<Customer[]>([]),
    [removedCustomers, setRemovedCustomers] = useState<Customer[]>([]),
    [showRemovedCustomers, setShowRemovedCustomers] = useState(false),
    [warranties, setWarranties] = useState<any[]>([]),
    [catalog, setCatalog] = useState<DeviceCatalog>({ brands: [], series: [], models: [] }),
    [followups, setFollowups] = useState<Follow[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [removed, setRemoved] = useState<{ exams: any[]; fittings: any[]; followups: Follow[] }>({
      exams: [],
      fittings: [],
      followups: [],
    }),
    [editingField, setEditingField] = useState(''),
    [editingValue, setEditingValue] = useState(''),
    [tab, setTab] = useState('概览'),
    [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [globalQuery, setGlobalQuery] = useState(''),
    [globalResults, setGlobalResults] = useState<Customer[]>([]),
    [searchBusy, setSearchBusy] = useState(false),
    [searchError, setSearchError] = useState(''),
    [searchActive, setSearchActive] = useState(0),
    [filter, setFilter] = useState('全部客户'),
    [modal, setModal] = useState(''),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>({}),
    [examIndex, setExamIndex] = useState(0),
    [compare, setCompare] = useState(false),
    [taskFilter, setTaskFilter] = useState('待完成'),
    [loginRole, setLoginRole] = useState('店主');
  const customer = customers.find((c) => c.id === selected),
    pending = followups.filter((f) => !f.completed),
    overdue = pending.filter((f) => f.due < today()),
    todayTasks = pending.filter((f) => f.due === today()),
    fitted = customers.filter((c) => ['已验配', '长期随访'].includes(c.status)),
    warrantyAlerts = warranties
      .filter((item) => item.warranty && daysUntil(item.warranty) <= 90)
      .sort((a, b) => a.warranty.localeCompare(b.warranty));
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };
  async function refresh(includeRemoved = role === '店主') {
    const [a, b, devices, warrantyRows, removedRows] = await Promise.all([
      api('/customers'),
      api('/followups'),
      api('/device-catalog'),
      api('/warranties'),
      includeRemoved ? api('/customers/removed') : Promise.resolve([]),
    ]);
    setCustomers(a);
    setFollowups(b);
    setCatalog(devices);
    setWarranties(warrantyRows);
    setRemovedCustomers(removedRows);
  }
  async function refreshCatalog() {
    setCatalog(await api('/device-catalog'));
  }
  async function loadDetail(key: string) {
    setDetail(null);
    try {
      const [data, removedRows] = await Promise.all([
        api(`/customers/${key}/detail`),
        api(`/customers/${key}/removed`),
      ]);
      setDetail(data);
      setRemoved(removedRows);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    api('/me')
      .then(async (r) => {
        setRole(r.role);
        await refresh(r.role === '店主');
      })
      .catch(() => {})
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (selected) {
      setDetail(null);
      Promise.all([api(`/customers/${selected}/detail`), api(`/customers/${selected}/removed`)])
        .then(([data, removedRows]) => {
          if (!cancelled) {
            setDetail(data);
            setRemoved(removedRows);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
      setExamIndex(0);
    }
    return () => {
      cancelled = true;
    };
  }, [selected]);
  useEffect(() => {
    if (!role || !searchOpen || !globalQuery.trim()) {
      setGlobalResults([]);
      setSearchBusy(false);
      setSearchError('');
      return;
    }
    let cancelled = false;
    const pattern = `%${globalQuery.trim().replace(/[!%_]/g, (char) => `!${char}`)}%`;
    if (new TextEncoder().encode(pattern).length > 50) {
      setGlobalResults([]);
      setSearchBusy(false);
      setSearchError('搜索关键词过长，请缩短后重试');
      return;
    }
    setGlobalResults([]);
    setSearchError('');
    setSearchBusy(true);
    const timer = setTimeout(() => {
      api('/search?q=' + encodeURIComponent(globalQuery.trim()))
        .then((rows) => {
          if (!cancelled) {
            setGlobalResults(rows);
            setSearchActive(0);
          }
        })
        .catch((e) => {
          if (!cancelled) setSearchError(e.message);
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [globalQuery, searchOpen, role]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (role) setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [role]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, selected]);
  function navigate(next: string) {
    setPage(next);
    setSelected(null);
    setSearch('');
    setError('');
  }
  function openCustomer(key: string) {
    setSearchOpen(false);
    setSelected(key);
    setTab('概览');
    setPage('customers');
    setError('');
    setEditingField('');
  }
  function closeModal() {
    if (!busy) {
      setModal('');
      setError('');
    }
  }
  function openForm(kind: string, record?: any) {
    if (kind === 'customer' && !record) {
      navigate('intake');
      return;
    }
    setError('');
    if (kind === 'customer')
      setDraft(
        record
          ? { ...record }
          : {
              name: '',
              gender: '未填写',
              birthDate: '1960-01-01',
              phone: '',
              contact: '',
              contactPhone: '',
              address: '',
              source: '自然到店',
              status: '待评估',
              history: '',
              needs: '',
            },
      );
    if (kind === 'exam') {
      const curve = () =>
        frequencies.map((f) => ({ frequency: f, value: null, noResponse: false, masked: false }));
      setDraft(
        record
          ? { ...record }
          : {
              date: today(),
              right: curve(),
              left: curve(),
              boneRight: curve(),
              boneLeft: curve(),
              speech: '',
              other: '',
              conclusion: '',
            },
      );
    }
    if (kind === 'fitting') {
      const brand = catalog.brands.find((item) => item.name === record?.brand);
      const series = catalog.series.find(
        (item) => item.brand_id === brand?.id && item.name === record?.series,
      );
      setDraft(
        record
          ? {
              ...record,
              deviceSelectionChanged: false,
              deviceBrandId: brand?.id || '',
              deviceSeriesId: series?.id || '',
              deviceModelId: record.deviceModelId || '',
            }
          : {
              date: today(),
              deviceSelectionChanged: true,
              deviceBrandId: '',
              deviceSeriesId: '',
              deviceModelId: '',
              brand: '',
              series: '',
              model: '',
              side: '双耳',
              serial: '',
              amount: 0,
              warranty: '',
              notes: '',
            },
      );
    }
    if (kind === 'followup')
      setDraft(
        record
          ? { ...record, customerId: record.customer_id }
          : {
              due: today(),
              type: '适应回访',
              note: '',
              customerId: selected || customers[0]?.id || '',
            },
      );
    if (kind === 'complete') setDraft({ ...record, result: '' });
    setModal(kind);
  }
  function change(key: string, value: any) {
    setDraft((d: any) => ({ ...d, [key]: value }));
  }
  async function saveIntake(payload: {
    customer: any;
    exam?: Exam;
    fitting?: any;
    followup?: any;
  }) {
    const created = await api('/intakes', 'POST', payload);
    await refresh();
    openCustomer(created.id);
    flash('客户档案及所选服务记录已保存');
  }
  async function changeRecord(
    kind: 'exams' | 'fittings' | 'followups',
    recordId: string,
    restore = false,
    customerId = selected,
  ) {
    if (!customerId) return;
    if (
      !restore &&
      !window.confirm('确认删除这条记录？删除后不会出现在档案和统计中，可在本页恢复。')
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/customers/${customerId}/${kind}/${recordId}${restore ? '/restore' : ''}`,
        restore ? 'POST' : 'DELETE',
      );
      await Promise.all([
        selected === customerId ? loadDetail(customerId) : Promise.resolve(),
        refresh(),
      ]);
      setExamIndex(0);
      flash(restore ? '记录已恢复' : '记录已删除，可在本页恢复');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeCustomer(recordId: string, restore = false) {
    if (
      !restore &&
      !window.confirm(
        '确认删除这位客户的档案？检查、验配、随访和附件会一起从普通列表中隐藏，可从已删除档案恢复。',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/customers/${recordId}${restore ? '/restore' : ''}`, restore ? 'POST' : 'DELETE');
      if (!restore && selected === recordId) setSelected(null);
      await refresh();
      flash(restore ? '客户档案已恢复' : '客户档案已删除，可从列表恢复');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveInlineField(field: keyof Customer) {
    if (!customer) return;
    setBusy(true);
    setError('');
    try {
      await api(`/customers/${customer.id}/profile`, 'PUT', { ...customer, [field]: editingValue });
      await refresh();
      setEditingField('');
      flash('资料已更新');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let key = selected;
      let latestDetail: Detail | null = null;
      if (modal === 'customer') {
        const r = await api(
          draft.id ? `/customers/${draft.id}/profile` : '/customers',
          draft.id ? 'PUT' : 'POST',
          draft,
        );
        key = draft.id || r.id;
      }
      if (modal === 'exam')
        await api(
          `/customers/${selected}/exams${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          draft,
        );
      if (modal === 'fitting')
        await api(
          `/customers/${selected}/fittings${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          {
            ...draft,
            amount: Number(draft.amount),
          },
        );
      if (modal === 'followup')
        await api(
          `/customers/${draft.customerId}/followups${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          draft,
        );
      if (modal === 'complete')
        await api(`/followups/${draft.id}`, 'PUT', { result: draft.result });
      await refresh();
      if (key) {
        setSelected(key);
        latestDetail = await api(`/customers/${key}/detail`);
        setDetail(latestDetail);
      }
      if (modal === 'exam') {
        setTab('听力检查');
        setExamIndex(
          draft.id && latestDetail
            ? Math.max(
                0,
                latestDetail.exams.findIndex((item) => item.id === draft.id),
              )
            : 0,
        );
      }
      if (modal === 'fitting') setTab('验配记录');
      if (modal === 'customer') {
        setPage('customers');
        setTab('概览');
      }
      setModal('');
      flash('记录已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file || !selected) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', file);
      await api(`/customers/${selected}/attachments`, 'POST', data);
      await loadDetail(selected);
      flash('报告已上传');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    try {
      const data = await api('/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `聆序-演示档案-${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash('档案已导出，附件请在档案中单独下载');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const filtered = customers.filter(
    (c) =>
      (filter === '全部客户' || c.status === filter) &&
      [c.name, c.phone, c.id].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  if (boot)
    return (
      <div className="loading">
        <Ear size={36} />
        <p>正在打开聆序工作台…</p>
      </div>
    );
  if (!role)
    return (
      <div className="cf-login">
        <header className="cf-login-header">
          <div className="brand">
            <span className="brand-icon">
              <Ear size={23} />
            </span>
            <div>
              <b>聆序</b>
              <small>HEARING CARE</small>
            </div>
          </div>
          <span className="cf-login-header-note">助听器门店客户服务工作空间</span>
        </header>
        <main className="cf-login-main">
          <div className="cf-login-intro">
            <span className="eyebrow">客户服务工作台</span>
            <h1>进入聆序工作台</h1>
            <p>选择演示角色，查看客户档案、听力检查、验配与随访记录。</p>
          </div>
          <section className="cf-login-card">
            <div className="cf-login-card-head">
              <span className="cf-login-pill">
                <i /> 演示空间
              </span>
              <span>选择体验角色</span>
            </div>
            <div className="cf-role-options">
              {['店主', '验配师', '前台'].map((r) => (
                <button
                  key={r}
                  className={loginRole === r ? 'selected' : ''}
                  aria-pressed={loginRole === r}
                  onClick={() => setLoginRole(r)}
                >
                  <span>{r}</span>
                  <small>
                    {r === '店主'
                      ? '全部档案、统计与导出'
                      : r === '验配师'
                        ? '听力检查、验配与随访'
                        : '客户建档、预约与回访'}
                  </small>
                  {loginRole === r && <CheckCircle2 size={18} />}
                </button>
              ))}
            </div>
            <button
              className="button primary full cf-login-submit"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api('/login', 'POST', { role: loginRole });
                  await refresh(loginRole === '店主');
                  setRole(loginRole);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在进入…' : '进入演示工作台'}
              <ArrowRight size={17} />
            </button>
            {error && <div className="error">{error}</div>}
            <p className="cf-login-note">
              <ShieldCheck size={16} />
              本演示含虚构客户资料，请勿录入真实个人信息。演示角色可公开切换。
            </p>
          </section>
        </main>
        <footer className="cf-login-footer">
          聆序 HEARING CARE <span>·</span> 让每一次服务，有迹可循。
        </footer>
      </div>
    );
  const navs = [
    ['overview', '工作台', LayoutDashboard],
    ['customers', '客户档案', Users],
    ['followups', '随访与预约', CalendarDays],
    ['reports', '统计分析', Activity],
    ['settings', '门店设置', Settings2],
  ] as const;
  const customerTable = (list: Customer[], compact = false) => (
    <div className="table-scroll">
      <table className="customer-table">
        <thead>
          <tr>
            <th>客户</th>
            <th>联系方式</th>
            <th>服务阶段</th>
            <th>客户来源</th>
            {!compact && <th>建档日期</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr
              key={c.id}
              onClick={() => openCustomer(c.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openCustomer(c.id)}
            >
              <td>
                <div className="person">
                  <span className={'avatar tone-' + (c.name.charCodeAt(0) % 4)}>
                    {c.name.slice(-2)}
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.gender} · {age(c.birthDate)} 岁
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <span>{c.phone || '未填写'}</span>
                <small className="subtext">
                  {[c.contact, c.contactPhone].filter(Boolean).join(' · ') || '暂无其他联系人'}
                </small>
              </td>
              <td>
                <Badge status={c.status} />
              </td>
              <td className="muted">{c.source}</td>
              {!compact && <td className="muted">{c.created_at.slice(0, 10)}</td>}
              <td>
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <Empty text="没有找到符合条件的客户" />}
    </div>
  );
  const taskRows = (list: Follow[]) =>
    list.length ? (
      <div className="task-list">
        {list.map((f) => (
          <div className="task-row" key={f.id}>
            <div className={'task-icon ' + (f.completed ? 'done' : f.due < today() ? 'late' : '')}>
              <CalendarDays size={18} />
            </div>
            <div className="task-body">
              <button className="text-link" onClick={() => openCustomer(f.customer_id)}>
                {f.name}
              </button>
              <span className="task-type">{f.type}</span>
              <p>{f.completed ? f.result : f.note}</p>
              <small className={f.due < today() && !f.completed ? 'danger' : 'muted'}>
                {f.due}
                {!f.completed && f.due < today() ? ' · 已逾期' : ''}
                {f.completed ? ' · 已完成' : ''}
              </small>
            </div>
            <div className="task-actions">
              {f.completed ? (
                <CheckCircle2 size={20} className="green" />
              ) : (
                <button className="button small" onClick={() => openForm('complete', f)}>
                  记录结果
                </button>
              )}
              <button
                className="icon-action"
                title="编辑随访"
                aria-label={`编辑 ${f.name} 的随访`}
                onClick={() => openForm('followup', f)}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-action danger-button"
                title="删除随访"
                aria-label={`删除 ${f.name} 的随访`}
                disabled={busy}
                onClick={() => changeRecord('followups', f.id, false, f.customer_id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Empty text="这个列表暂时没有随访任务" />
    );
  const profileField = (
    field: keyof Customer,
    label: string,
    options?: string[],
    multiline = false,
  ) => {
    if (!customer) return null;
    const value = String(customer[field] || '');
    return (
      <div className="inline-profile-field" key={field}>
        <dt>
          {label}
          <button
            type="button"
            className="inline-edit-icon"
            title={`编辑${label}`}
            aria-label={`编辑${label}`}
            onClick={() => {
              setEditingField(field);
              setEditingValue(value);
            }}
          >
            <Pencil size={13} />
          </button>
        </dt>
        <dd>
          {editingField === field ? (
            <form
              className="inline-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveInlineField(field);
              }}
            >
              {options ? (
                <select
                  autoFocus
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : multiline ? (
                <textarea
                  autoFocus
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                />
              ) : (
                <input
                  autoFocus
                  type={field === 'birthDate' ? 'date' : 'text'}
                  required={field === 'name' || field === 'birthDate'}
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                />
              )}
              <button type="submit" className="button small primary" disabled={busy}>
                保存
              </button>
              <button type="button" className="button small" onClick={() => setEditingField('')}>
                取消
              </button>
            </form>
          ) : (
            value || '未填写'
          )}
        </dd>
      </div>
    );
  };
  return (
    <div className="app-shell cf-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Ear size={24} />
          </span>
          <div>
            <b>聆序</b>
            <small>HEARING CARE</small>
          </div>
        </div>
        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={18} />
          <span>快速搜索客户...</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="store-switch">
          <div className="store-mark">聆</div>
          <div>
            <strong>聆序听力 · 演示门店</strong>
            <small>客户服务工作空间</small>
          </div>
        </div>
        <span className="nav-caption">门店管理</span>
        <nav>
          {navs.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => navigate(key)}
              className={page === key ? 'active' : ''}
            >
              <Icon size={19} />
              <span>{label}</span>
              {key === 'followups' && pending.length > 0 && <b>{pending.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-box">
            <span className="demo-dot" />
            演示空间
            <p>
              数据已保存至演示数据库
              <br />
              请勿录入真实客户资料
            </p>
          </div>
          <button
            className="profile"
            onClick={async () => {
              await api('/logout', 'POST');
              setRole('');
              setSelected(null);
            }}
          >
            <span className="profile-avatar">{role.slice(0, 1)}</span>
            <div>
              <strong>演示{role}</strong>
              <small>退出 / 切换角色</small>
            </div>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            门店管理 <ChevronRight size={14} />{' '}
            <strong>{page === 'intake' ? '新建客户' : navs.find((n) => n[0] === page)?.[1]}</strong>
            {customer && (
              <>
                <ChevronRight size={14} />
                <span>{customer.name}</span>
              </>
            )}
          </div>
          <div className="top-actions">
            <span>
              <i className="live-dot" />
              演示版
            </span>
            <button
              className="icon-button"
              aria-label="查看待办"
              onClick={() => navigate('followups')}
            >
              <Bell size={19} />
              {todayTasks.length > 0 && <i className="notification-dot" />}
            </button>
            <span className="top-avatar">{role.slice(0, 1)}</span>
          </div>
        </header>
        <div className="content">
          {error && !modal && (
            <div className="error dismiss">
              {error}
              <button onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === 'intake' && (
            <IntakePage
              catalog={catalog}
              role={role}
              onSave={saveIntake}
              onCancel={() => navigate('customers')}
            />
          )}
          {page === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">客户服务工作台</span>
                  <h1>今天要查找哪位客户？</h1>
                  <p>
                    {new Date().toLocaleDateString('zh-CN', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })}{' '}
                    <span className="dot-sep">·</span> 今日有 {todayTasks.length} 项服务待跟进
                  </p>
                </div>
              </div>
              <button className="home-search" onClick={() => setSearchOpen(true)}>
                <Search size={22} />
                <span>搜索客户姓名、电话、检查结果、设备或随访记录...</span>
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </button>
              <div className="home-shortcuts">
                <section>
                  <header>
                    <span>客户档案</span>
                    <MoreHorizontal size={18} />
                  </header>
                  <button onClick={() => openForm('customer')}>
                    <Plus size={17} />
                    录入新客户
                    <ChevronRight size={16} />
                  </button>
                </section>
                <section>
                  <header>
                    <span>快捷操作</span>
                    <MoreHorizontal size={18} />
                  </header>
                  <button onClick={() => navigate('customers')}>
                    <Users size={17} />
                    查看全部客户
                    <ChevronRight size={16} />
                  </button>
                </section>
                <section>
                  <header>
                    <span>最近建档</span>
                    <MoreHorizontal size={18} />
                  </header>
                  {customers.slice(0, 3).map((recent) => (
                    <button key={recent.id} onClick={() => openCustomer(recent.id)}>
                      <Clock3 size={16} />
                      {recent.name}
                      <small>{recent.status}</small>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
              </div>
              <div className="home-section-label">
                <h2>门店概况</h2>
                <span>客户与服务实时统计</span>
              </div>
              <div className="stats-grid">
                <Stat
                  label="客户总数"
                  value={customers.length}
                  unit="位"
                  detail="已建立服务档案"
                  icon={<Users />}
                />
                <Stat
                  label="已验配客户"
                  value={fitted.length}
                  unit="位"
                  detail="包含长期随访客户"
                  icon={<Headphones />}
                />
                <Stat
                  label="今日待办"
                  value={todayTasks.length}
                  unit="项"
                  detail="回访、复查与到店服务"
                  icon={<CalendarDays />}
                />
                <Stat
                  label="逾期未跟进"
                  value={overdue.length}
                  unit="项"
                  detail="建议优先安排联系"
                  icon={<Bell />}
                  warning
                />
              </div>
              <div className="dashboard-columns">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        服务待办 <span className="count">{pending.length}</span>
                      </h2>
                      <p>记录每一次反馈，跟进每一次变化</p>
                    </div>
                    <button className="text-link muted" onClick={() => navigate('followups')}>
                      查看全部 <ArrowRight size={15} />
                    </button>
                  </div>
                  {taskRows([...pending].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4))}
                </section>
                <div className="dashboard-side">
                  <section className="panel journey-panel">
                    <span className="eyebrow">客户服务进程</span>
                    <h2>从初次相识，到长期关怀</h2>
                    <div className="journey-bars">
                      {statuses.slice(1).map((s, i) => {
                        const count = customers.filter((c) => c.status === s).length;
                        return (
                          <button
                            key={s}
                            onClick={() => {
                              navigate('customers');
                              setFilter(s);
                            }}
                          >
                            <span>
                              <i
                                style={{
                                  background: ['#d5b777', '#79a59c', '#5c8c80', '#245d50'][i],
                                }}
                              />
                              {s}
                            </span>
                            <strong>
                              {count}
                              <small>位</small>
                            </strong>
                            <div className="bar-track">
                              <i
                                style={{
                                  width: (100 * count) / Math.max(customers.length, 1) + '%',
                                  background: ['#d5b777', '#79a59c', '#5c8c80', '#245d50'][i],
                                }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <div className="care-note">
                    <div>
                      <Ear size={23} />
                      <span>好服务，始于认真倾听</span>
                    </div>
                    <p>
                      将客户的真实感受写进回访记录，
                      <br />
                      让下一次服务更有依据。
                    </p>
                  </div>
                </div>
              </div>
              <section className="panel recent-panel">
                <div className="panel-heading">
                  <div>
                    <h2>最近建档</h2>
                    <p>及时了解新客户的聆听需求</p>
                  </div>
                  <button className="text-link muted" onClick={() => navigate('customers')}>
                    全部客户 <ArrowRight size={15} />
                  </button>
                </div>
                {customerTable(customers.slice(0, 4), true)}
              </section>
            </>
          )}
          {page === 'customers' && !customer && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">客户服务档案</span>
                  <h1>客户档案</h1>
                  <p>汇集检查、验配与随访，了解客户的每一步。</p>
                </div>
                <button className="button primary" onClick={() => openForm('customer')}>
                  <Plus size={18} />
                  新建客户
                </button>
              </div>
              <section className="panel">
                <div className="list-toolbar">
                  <div className="tabs">
                    {statuses.map((s) => (
                      <button
                        key={s}
                        className={filter === s ? 'active' : ''}
                        onClick={() => setFilter(s)}
                      >
                        {s}
                        <span>
                          {s === '全部客户'
                            ? customers.length
                            : customers.filter((c) => c.status === s).length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={17} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索姓名、电话或档案编号"
                    />
                  </label>
                </div>
                {customerTable(filtered)}
                <div className="table-footer">
                  共 {filtered.length} 位客户 <span>点击客户查看完整服务档案</span>
                </div>
              </section>
              {role === '店主' && (
                <section className="panel padded space-top">
                  <div className="section-title">
                    <h2>已删除档案</h2>
                    <button
                      className="button small"
                      onClick={() => setShowRemovedCustomers(!showRemovedCustomers)}
                    >
                      {showRemovedCustomers ? '收起' : `查看 ${removedCustomers.length} 位`}
                    </button>
                  </div>
                  {showRemovedCustomers &&
                    (removedCustomers.length ? (
                      <div className="removed-customer-list">
                        {removedCustomers.map((item) => (
                          <div key={item.id}>
                            <span>
                              <strong>{item.name}</strong>
                              <small>
                                {item.phone || '未填写电话'} · 删除于 {item.deleted_at || '—'}
                              </small>
                            </span>
                            <button
                              className="button small"
                              disabled={busy}
                              onClick={() => changeCustomer(item.id, true)}
                            >
                              <RotateCcw size={14} /> 恢复档案
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">没有已删除的客户档案</p>
                    ))}
                </section>
              )}
            </>
          )}
          {page === 'customers' && customer && (
            <>
              <button className="back" onClick={() => setSelected(null)}>
                <ArrowLeft size={16} />
                返回客户列表
              </button>
              <section className="customer-hero">
                <div className="person">
                  <span className="avatar large-avatar">{customer.name.slice(-2)}</span>
                  <div>
                    <div className="customer-title">
                      <h1>{customer.name}</h1>
                      <Badge status={customer.status} />
                    </div>
                    <p>
                      {customer.gender} · {age(customer.birthDate)} 岁{' '}
                      <span className="dot-sep">/</span> {customer.phone || '未填写电话'}{' '}
                      <span className="dot-sep">/</span> {customer.source}
                    </p>
                    <small>
                      档案编号{' '}
                      {customer.id.startsWith('demo')
                        ? 'LX-' + customer.id.slice(5).padStart(4, '0')
                        : customer.id.slice(0, 8).toUpperCase()}
                    </small>
                  </div>
                </div>
                <div className="button-row">
                  <button className="button" onClick={() => openForm('customer', customer)}>
                    编辑档案
                  </button>
                  {role === '店主' && (
                    <button
                      className="button danger-button"
                      disabled={busy}
                      onClick={() => changeCustomer(customer.id)}
                    >
                      <Trash2 size={16} />
                      删除档案
                    </button>
                  )}
                  <button className="button primary" onClick={() => openForm('followup')}>
                    <Plus size={17} />
                    安排随访
                  </button>
                </div>
              </section>
              <div className="detail-tabs">
                {['概览', '听力检查', '验配记录', '随访记录', '报告附件'].map((t) => (
                  <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                    {t}
                    {t === '听力检查' && detail && <span>{detail.exams.length}</span>}
                  </button>
                ))}
              </div>
              {!detail ? (
                <div className="loading-inline">正在读取档案…</div>
              ) : (
                <>
                  {tab === '概览' && (
                    <div className="detail-grid">
                      <div>
                        <section className="panel padded">
                          <div className="section-title">
                            <h2>基本资料</h2>
                            <FileText size={18} />
                          </div>
                          <dl className="info-grid">
                            {profileField('name', '客户姓名')}
                            {profileField('gender', '性别', ['未填写', '男', '女'])}
                            {profileField('birthDate', '出生日期')}
                            {profileField('phone', '客户电话')}
                            {profileField('source', '客户来源', [
                              '自然到店',
                              '老客转介绍',
                              '社区活动',
                              '线上咨询',
                              '其他',
                            ])}
                            {profileField('status', '服务阶段', statuses.slice(1))}
                            {profileField('contact', '其他联系人')}
                            {profileField('contactPhone', '其他联系人电话')}
                            {profileField('address', '住址')}
                            <div>
                              <dt>建档日期</dt>
                              <dd>{customer.created_at.slice(0, 10)}</dd>
                            </div>
                          </dl>
                          <dl className="note-block">
                            {profileField('history', '听力与健康情况', undefined, true)}
                          </dl>
                          <dl className="note-block">
                            {profileField('needs', '聆听需求与期望', undefined, true)}
                          </dl>
                        </section>
                        <section className="panel padded space-top">
                          <div className="section-title">
                            <h2>最近听力检查</h2>
                            <button className="text-link" onClick={() => setTab('听力检查')}>
                              完整检查 <ArrowRight size={14} />
                            </button>
                          </div>
                          {detail.exams.length ? (
                            <>
                              <div className="chart-summary">
                                <span>检查日期 {detail.exams[0].date}</span>
                                <div>
                                  <span className="ear-right">○ 右耳</span>
                                  <span className="ear-left">× 左耳</span>
                                </div>
                              </div>
                              <Audiogram exam={detail.exams[0]} />
                            </>
                          ) : (
                            <Empty
                              text="尚未录入听力检查"
                              action={
                                role !== '前台' && (
                                  <button className="button" onClick={() => openForm('exam')}>
                                    录入检查
                                  </button>
                                )
                              }
                            />
                          )}
                        </section>
                      </div>
                      <div>
                        <section className="panel padded">
                          <div className="section-title">
                            <h2>当前佩戴设备</h2>
                            <Headphones size={18} />
                          </div>
                          {detail.fittings[0] ? (
                            <>
                              <div className="device-card">
                                <div className="device-icon">
                                  <Headphones size={33} />
                                </div>
                                <small>
                                  {[detail.fittings[0].brand, detail.fittings[0].series]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </small>
                                <h3>{detail.fittings[0].model}</h3>
                                <span>{detail.fittings[0].side}佩戴</span>
                              </div>
                              <dl className="stacked-info">
                                <div>
                                  <dt>验配日期</dt>
                                  <dd>{detail.fittings[0].date}</dd>
                                </div>
                                <div>
                                  <dt>保修截止</dt>
                                  <dd>{detail.fittings[0].warranty || '未填写'}</dd>
                                </div>
                              </dl>
                              <button className="button full" onClick={() => setTab('验配记录')}>
                                查看验配记录
                              </button>
                            </>
                          ) : (
                            <Empty text="暂无验配设备记录" />
                          )}
                        </section>
                        <section className="panel padded space-top">
                          <h2>档案动态</h2>
                          <div className="timeline">
                            {detail.audit.slice(0, 8).map((a) => (
                              <div key={a.id}>
                                <i />
                                <strong>{a.action}</strong>
                                <p>
                                  {a.actor} · {localTime(a.created_at)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>
                      </div>
                    </div>
                  )}
                  {tab === '听力检查' && (
                    <section className="panel padded">
                      <div className="section-title">
                        <div>
                          <h2>纯音听力与检查结果</h2>
                          <p className="muted">保留每次原始检查，按日期对比听力变化。</p>
                        </div>
                        {role !== '前台' && (
                          <button className="button primary" onClick={() => openForm('exam')}>
                            <Plus size={16} />
                            录入检查
                          </button>
                        )}
                      </div>
                      {detail.exams.length ? (
                        (() => {
                          const ex = detail.exams[examIndex] || detail.exams[0];
                          return (
                            <>
                              <div className="exam-toolbar">
                                <select
                                  aria-label="检查日期"
                                  value={examIndex}
                                  onChange={(e) => setExamIndex(Number(e.target.value))}
                                >
                                  {detail.exams.map((ex, i) => (
                                    <option key={ex.id} value={i}>
                                      {ex.date} · 第 {detail.exams.length - i} 次检查
                                    </option>
                                  ))}
                                </select>
                                {detail.exams.length > 1 && (
                                  <label className="check-label">
                                    <input
                                      type="checkbox"
                                      checked={compare}
                                      onChange={(e) => setCompare(e.target.checked)}
                                    />
                                    叠加前次检查
                                  </label>
                                )}
                                <button className="button small" onClick={() => window.print()}>
                                  <ArrowDownToLine size={15} />
                                  打印 / PDF
                                </button>
                                {role !== '前台' && ex.id && (
                                  <button
                                    className="button small"
                                    onClick={() => openForm('exam', ex)}
                                  >
                                    <Pencil size={14} />
                                    编辑本次检查
                                  </button>
                                )}
                                {role !== '前台' && ex.id && (
                                  <button
                                    className="button small danger-button"
                                    disabled={busy}
                                    onClick={() => changeRecord('exams', ex.id!)}
                                  >
                                    删除本次检查
                                  </button>
                                )}
                              </div>
                              <div className="exam-layout">
                                <div>
                                  <Audiogram
                                    exam={ex}
                                    previous={compare ? detail.exams[examIndex + 1] : undefined}
                                  />
                                  <div className="legend">
                                    <span className="ear-right">○ / △ 右气导</span>
                                    <span className="ear-left">× / □ 左气导</span>
                                    <span>〈 / [ 右骨导</span>
                                    <span>〉 / ] 左骨导</span>
                                    <span>↘ 无反应</span>
                                  </div>
                                  <small className="muted">
                                    △、□、[、] 为掩蔽符号；淡虚线为前次检查。
                                  </small>
                                </div>
                                <div className="exam-readings">
                                  <div>
                                    <small>右耳平均听阈 · 四频</small>
                                    <strong className="ear-right">
                                      {pta(ex.right) ?? '—'} <span>dB HL</span>
                                    </strong>
                                  </div>
                                  <div>
                                    <small>左耳平均听阈 · 四频</small>
                                    <strong className="ear-left">
                                      {pta(ex.left) ?? '—'} <span>dB HL</span>
                                    </strong>
                                  </div>
                                  <p>
                                    按 500、1000、2000、4000 Hz 计算。缺测或无反应时不计算平均值。
                                  </p>
                                </div>
                              </div>
                              <div className="result-grid">
                                <div>
                                  <h3>言语测听</h3>
                                  <p>{ex.speech || '未记录'}</p>
                                </div>
                                <div>
                                  <h3>其他检查</h3>
                                  <p>{ex.other || '未记录'}</p>
                                </div>
                                <div className="wide">
                                  <h3>检查结论与建议</h3>
                                  <p>{ex.conclusion || '未记录'}</p>
                                </div>
                              </div>
                            </>
                          );
                        })()
                      ) : (
                        <Empty text="尚未录入检查数据" />
                      )}
                      {role !== '前台' && removed.exams.length > 0 && (
                        <div className="removed-records">
                          <h3>已删除的检查</h3>
                          {removed.exams.map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.date} · {record.conclusion || '听力检查'}
                              </span>
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() => changeRecord('exams', record.id, true)}
                              >
                                恢复
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {tab === '验配记录' && (
                    <section className="panel padded">
                      <div className="section-title">
                        <h2>历次验配与调试</h2>
                        {role !== '前台' && (
                          <button className="button primary" onClick={() => openForm('fitting')}>
                            <Plus size={16} />
                            新增验配记录
                          </button>
                        )}
                      </div>
                      {detail.fittings.length ? (
                        detail.fittings.map((f) => (
                          <article className="record-card" key={f.id}>
                            <div className="record-heading">
                              <div>
                                <span className="eyebrow">
                                  {f.date} · {f.side}
                                </span>
                                <h3>{[f.brand, f.series, f.model].filter(Boolean).join(' · ')}</h3>
                              </div>
                              <div className="record-actions">
                                <Headphones size={25} />
                                {role !== '前台' && (
                                  <button
                                    className="button small"
                                    onClick={() => openForm('fitting', f)}
                                  >
                                    <Pencil size={14} />
                                    编辑
                                  </button>
                                )}
                                {role !== '前台' && (
                                  <button
                                    className="button small danger-button"
                                    disabled={busy}
                                    onClick={() => changeRecord('fittings', f.id)}
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            </div>
                            <dl className="info-grid">
                              <div>
                                <dt>设备序列号</dt>
                                <dd>{f.serial || '未填写'}</dd>
                              </div>
                              <div>
                                <dt>成交金额</dt>
                                <dd>¥ {money(f.amount)}</dd>
                              </div>
                              <div>
                                <dt>保修截止日期</dt>
                                <dd>{f.warranty || '未填写'}</dd>
                              </div>
                            </dl>
                            <p className="record-note">{f.notes || '暂无验配说明'}</p>
                          </article>
                        ))
                      ) : (
                        <Empty text="暂无验配记录" />
                      )}
                      {role !== '前台' && removed.fittings.length > 0 && (
                        <div className="removed-records">
                          <h3>已删除的验配记录</h3>
                          {removed.fittings.map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.date} ·{' '}
                                {[record.brand, record.series, record.model]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() => changeRecord('fittings', record.id, true)}
                              >
                                恢复
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {tab === '随访记录' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>随访与服务记录</h2>
                          <p>完整保留每次联系的结果</p>
                        </div>
                        <button className="button primary" onClick={() => openForm('followup')}>
                          <Plus size={16} />
                          安排随访
                        </button>
                      </div>
                      {taskRows(detail.followups.map((f) => ({ ...f, name: customer.name })))}
                      {removed.followups.length > 0 && (
                        <div className="removed-records padded">
                          <h3>已删除的随访</h3>
                          {removed.followups.map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.due} · {record.type} · {record.note}
                              </span>
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() => changeRecord('followups', record.id, true)}
                              >
                                恢复
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {tab === '报告附件' && (
                    <section className="panel padded">
                      <div className="section-title">
                        <div>
                          <h2>原始报告与附件</h2>
                          <p className="muted">支持 PDF、JPG、PNG，单个文件不超过 10 MB。</p>
                        </div>
                        <label
                          className={'button primary upload-button ' + (busy ? 'disabled' : '')}
                        >
                          <Upload size={16} />
                          {busy ? '上传中…' : '上传报告'}
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            disabled={busy}
                            onChange={(e) => {
                              upload(e.target.files?.[0]);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                      {detail.attachments.length ? (
                        <div className="attachment-list">
                          {detail.attachments.map((a) => (
                            <a key={a.id} href={'/api/files/' + a.id} className="attachment">
                              <FileText size={24} />
                              <div>
                                <strong>{a.name}</strong>
                                <small>
                                  {(a.size / 1024).toFixed(1)} KB · {a.created_at.slice(0, 10)}
                                </small>
                              </div>
                              <ArrowDownToLine size={18} />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <Empty text="上传原始报告，与结构化检查数据一起保存" />
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
          {page === 'followups' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">持续的听力关怀</span>
                  <h1>随访与预约</h1>
                  <p>让每一个需要联系的客户，都得到及时回应。</p>
                </div>
                <button
                  className="button primary"
                  disabled={!customers.length}
                  onClick={() => openForm('followup')}
                >
                  <Plus size={17} />
                  安排随访
                </button>
              </div>
              <div className="stats-grid three">
                <Stat
                  label="待完成"
                  value={pending.length}
                  unit="项"
                  detail="全部待跟进任务"
                  icon={<ClipboardList />}
                />
                <Stat
                  label="今日到期"
                  value={todayTasks.length}
                  unit="项"
                  detail="优先处理当日服务"
                  icon={<CalendarDays />}
                />
                <Stat
                  label="已完成"
                  value={followups.length - pending.length}
                  unit="项"
                  detail="已记录回访结果"
                  icon={<CheckCircle2 />}
                />
              </div>
              <section className="panel">
                <div className="list-toolbar">
                  <div className="tabs">
                    {['待完成', '已逾期', '已完成', '全部'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTaskFilter(t)}
                        className={taskFilter === t ? 'active' : ''}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {taskRows(
                  followups.filter(
                    (f) =>
                      taskFilter === '全部' ||
                      (taskFilter === '已完成'
                        ? !!f.completed
                        : taskFilter === '已逾期'
                          ? !f.completed && f.due < today()
                          : !f.completed),
                  ),
                )}
              </section>
            </>
          )}
          {page === 'reports' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">用记录看见服务</span>
                  <h1>客户与服务统计</h1>
                  <p>统计范围：当前门店全部档案，随保存的记录实时更新。</p>
                </div>
                {role === '店主' && (
                  <button className="button" onClick={exportData}>
                    <ArrowDownToLine size={17} />
                    导出档案
                  </button>
                )}
              </div>
              <div className="stats-grid">
                <Stat
                  label="客户总数"
                  value={customers.length}
                  unit="位"
                  detail="当前档案数量"
                  icon={<Users />}
                />
                <Stat
                  label="已验配占比"
                  value={
                    customers.length ? Math.round((fitted.length / customers.length) * 100) : 0
                  }
                  unit="%"
                  detail="已验配及长期随访 / 全部客户"
                  icon={<Headphones />}
                />
                <Stat
                  label="随访完成率"
                  value={
                    followups.length
                      ? Math.round(((followups.length - pending.length) / followups.length) * 100)
                      : 0
                  }
                  unit="%"
                  detail="已完成 / 全部随访任务"
                  icon={<CheckCircle2 />}
                />
                <Stat
                  label="保修需关注"
                  value={warrantyAlerts.length}
                  unit="项"
                  detail="已过期或 90 天内到期"
                  icon={<Bell />}
                  warning
                />
              </div>
              <section className="panel padded warranty-panel">
                <div className="section-title">
                  <div>
                    <h2>保修到期提醒</h2>
                    <p className="muted">
                      列出已过期和未来 90 天内到期的设备，点击客户可查看验配档案。
                    </p>
                  </div>
                  <Bell size={20} />
                </div>
                {warrantyAlerts.length ? (
                  <div className="warranty-list">
                    {warrantyAlerts.map((item) => {
                      const remaining = daysUntil(item.warranty);
                      return (
                        <button key={item.id} onClick={() => openCustomer(item.customer_id)}>
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              {[item.brand, item.series, item.model].filter(Boolean).join(' · ')}
                            </small>
                          </span>
                          <span className="warranty-date">
                            {item.warranty}
                            <small className={remaining < 0 ? 'danger' : ''}>
                              {remaining < 0
                                ? `已过期 ${-remaining} 天`
                                : remaining === 0
                                  ? '今天到期'
                                  : `${remaining} 天后到期`}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Empty text="暂无已过期或 90 天内到期的保修记录" />
                )}
              </section>
              <div className="report-grid">
                <Distribution
                  title="客户来源"
                  subtitle="了解客户从哪里认识门店"
                  data={[...new Set(customers.map((c) => c.source))].map((s) => ({
                    label: s,
                    count: customers.filter((c) => c.source === s).length,
                  }))}
                />
                <Distribution
                  title="客户年龄分布"
                  subtitle="按当前日期与出生日期计算"
                  data={[
                    {
                      label: '40 岁以下',
                      count: customers.filter((c) => age(c.birthDate) < 40).length,
                    },
                    {
                      label: '40–59 岁',
                      count: customers.filter(
                        (c) => age(c.birthDate) >= 40 && age(c.birthDate) < 60,
                      ).length,
                    },
                    {
                      label: '60–79 岁',
                      count: customers.filter(
                        (c) => age(c.birthDate) >= 60 && age(c.birthDate) < 80,
                      ).length,
                    },
                    {
                      label: '80 岁及以上',
                      count: customers.filter((c) => age(c.birthDate) >= 80).length,
                    },
                  ]}
                />
                <Distribution
                  title="服务阶段"
                  subtitle="每位客户只计入当前阶段"
                  data={statuses.slice(1).map((s) => ({
                    label: s,
                    count: customers.filter((c) => c.status === s).length,
                  }))}
                />
                <Distribution
                  title="随访服务类型"
                  subtitle="包含待完成与已完成任务"
                  data={['适应回访', '听力复查', '清洁保养', '维修跟进', '到店预约'].map((s) => ({
                    label: s,
                    count: followups.filter((f) => f.type === s).length,
                  }))}
                />
              </div>
            </>
          )}
          {page === 'settings' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">工作空间</span>
                  <h1>门店设置</h1>
                  <p>助听器型号字典、角色权限与数据导出。</p>
                </div>
              </div>
              <DeviceCatalogManager catalog={catalog} role={role} reload={refreshCatalog} />
              <div className="detail-grid">
                <section className="panel padded">
                  <h2>聆序听力 · 演示门店</h2>
                  <dl className="stacked-info">
                    <div>
                      <dt>当前角色</dt>
                      <dd>{role}</dd>
                    </div>
                    <div>
                      <dt>数据空间</dt>
                      <dd>独立演示门店</dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>Demo 0.1</dd>
                    </div>
                  </dl>
                  <h3>角色权限</h3>
                  <table className="permissions">
                    <thead>
                      <tr>
                        <th>能力</th>
                        <th>店主</th>
                        <th>验配师</th>
                        <th>前台</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['客户与随访', '✓', '✓', '✓'],
                        ['检查与验配录入', '✓', '✓', '—'],
                        ['型号字典维护', '✓', '—', '—'],
                        ['报告上传与查看', '✓', '✓', '✓'],
                        ['全量档案导出', '✓', '—', '—'],
                      ].map((row) => (
                        <tr key={row[0]}>
                          {row.map((v, i) => (
                            <td key={i}>{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="panel padded">
                  <div className="section-title">
                    <h2>资料导出</h2>
                    <ArrowDownToLine size={20} />
                  </div>
                  <p className="muted paragraph">
                    导出客户、听力检查、验配、随访、助听器型号字典与操作记录的 JSON
                    数据。包含附件目录；原始报告请在客户档案中单独下载。
                  </p>
                  <button className="button full" disabled={role !== '店主'} onClick={exportData}>
                    导出全部档案
                  </button>
                  <div className="notice">
                    <ShieldCheck size={20} />
                    <p>
                      演示登录允许公开切换角色，仅供虚构数据体验。正式使用前需启用真实员工认证、完成权限审核及部署验证。
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
        <footer className="app-footer">
          聆序 HEARING CARE <span>让每一次服务，有迹可循。</span>
          <small>演示数据 · 仅供体验</small>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      {searchOpen && (
        <div
          className="global-search-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <section
            className="global-search-panel"
            role="dialog"
            aria-modal="true"
            aria-label="搜索客户信息"
          >
            <div className="global-search-input">
              <Search size={21} />
              <input
                autoFocus
                aria-label="搜索客户信息"
                placeholder="搜索姓名、电话、检查结论、设备或随访..."
                value={globalQuery}
                maxLength={80}
                onChange={(e) => {
                  setGlobalQuery(e.target.value);
                  setSearchActive(0);
                }}
                onKeyDown={(e) => {
                  const rows = globalQuery.trim() ? globalResults : customers.slice(0, 6);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchActive((n) => (n + 1) % Math.max(rows.length, 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchActive(
                      (n) => (n - 1 + Math.max(rows.length, 1)) % Math.max(rows.length, 1),
                    );
                  }
                  if (e.key === 'Enter' && rows[searchActive]) {
                    e.preventDefault();
                    openCustomer(rows[searchActive].id);
                  }
                }}
              />
              <button aria-label="关闭搜索" onClick={() => setSearchOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="global-search-list">
              <div className="global-search-caption">
                {globalQuery.trim()
                  ? searchError
                    ? searchError
                    : searchBusy
                      ? '正在查找…'
                      : `搜索结果 · ${globalResults.length} 位客户`
                  : '最近建档的客户'}
              </div>
              {(globalQuery.trim() ? globalResults : customers.slice(0, 6)).map((entry, index) => (
                <button
                  className={searchActive === index ? 'active' : ''}
                  key={entry.id}
                  onMouseEnter={() => setSearchActive(index)}
                  onClick={() => openCustomer(entry.id)}
                >
                  <span className="search-result-avatar">{entry.name.slice(-2)}</span>
                  <span className="search-result-content">
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.phone || '未填写电话'} · {entry.source} · {entry.status}
                    </small>
                  </span>
                  <span className="search-result-meta">
                    查看档案 <ArrowRight size={15} />
                  </span>
                </button>
              ))}
              {!searchBusy && !searchError && globalQuery.trim() && !globalResults.length && (
                <div className="search-no-results">
                  没有找到相关客户。请尝试姓名、电话、设备型号或服务记录中的词语。
                </div>
              )}
            </div>
            <footer>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> 选择结果
              </span>
              <span>
                <kbd>Enter</kbd> 打开档案
              </span>
              <span>
                <kbd>Esc</kbd> 关闭
              </span>
            </footer>
          </section>
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              customer: draft.id ? '编辑客户档案' : '新建客户档案',
              exam: draft.id ? '编辑听力检查' : '录入听力检查',
              fitting: draft.id ? '编辑验配记录' : '新增验配记录',
              followup: draft.id ? '编辑随访与预约' : '安排随访与预约',
              complete: '记录随访结果',
            }[modal] || ''
          }
          onClose={closeModal}
          wide={modal === 'exam'}
        >
          <form onSubmit={submit}>
            <div className="modal-body">
              {error && <div className="error">{error}</div>}
              {modal === 'customer' &&
                customers.some(
                  (c) =>
                    c.id !== draft.id &&
                    c.name === draft.name.trim() &&
                    c.birthDate === draft.birthDate,
                ) && (
                  <div className="duplicate-notice">
                    已有同名、同出生日期的客户。请先核对是否重复建档；如确为不同客户，可以继续保存。
                  </div>
                )}
              {modal === 'customer' && (
                <div className="form-grid">
                  <Field label="客户姓名 *">
                    <input
                      autoFocus
                      required
                      maxLength={40}
                      value={draft.name}
                      onChange={(e) => change('name', e.target.value)}
                    />
                  </Field>
                  <Field label="性别">
                    <select value={draft.gender} onChange={(e) => change('gender', e.target.value)}>
                      {['未填写', '男', '女'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="出生日期 *">
                    <input
                      type="date"
                      required
                      max={today()}
                      min="1900-01-01"
                      value={draft.birthDate}
                      onChange={(e) => change('birthDate', e.target.value)}
                    />
                  </Field>
                  <Field label="联系电话">
                    <input
                      maxLength={30}
                      value={draft.phone}
                      placeholder="演示时请使用虚构信息"
                      onChange={(e) => change('phone', e.target.value)}
                    />
                  </Field>
                  <Field label="其他联系人">
                    <input
                      maxLength={100}
                      value={draft.contact}
                      onChange={(e) => change('contact', e.target.value)}
                    />
                  </Field>
                  <Field label="其他联系人电话">
                    <input
                      maxLength={30}
                      value={draft.contactPhone || ''}
                      onChange={(e) => change('contactPhone', e.target.value)}
                    />
                  </Field>
                  <Field label="住址" wide>
                    <input
                      maxLength={300}
                      value={draft.address || ''}
                      onChange={(e) => change('address', e.target.value)}
                    />
                  </Field>
                  <Field label="客户来源">
                    <select value={draft.source} onChange={(e) => change('source', e.target.value)}>
                      {['自然到店', '老客转介绍', '社区活动', '线上咨询', '其他'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="服务阶段">
                    <select value={draft.status} onChange={(e) => change('status', e.target.value)}>
                      {statuses.slice(1).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="听力与健康情况" wide>
                    <textarea
                      value={draft.history}
                      onChange={(e) => change('history', e.target.value)}
                      placeholder="听力困难、耳部病史、既往助听器使用情况…"
                    />
                  </Field>
                  <Field label="聆听需求与期望" wide>
                    <textarea
                      value={draft.needs}
                      onChange={(e) => change('needs', e.target.value)}
                      placeholder="客户希望改善哪些生活场景？"
                    />
                  </Field>
                </div>
              )}
              {modal === 'exam' && (
                <>
                  <Field label="检查日期 *">
                    <input
                      type="date"
                      required
                      max={today()}
                      value={draft.date}
                      onChange={(e) => change('date', e.target.value)}
                    />
                  </Field>
                  <p className="form-hint">
                    输入听阈（−10 至 120 dB HL），留空表示未测。各测点可分别标记掩蔽与无反应。
                  </p>
                  <div className="threshold-scroll">
                    <table className="threshold-table">
                      <thead>
                        <tr>
                          <th>频率 Hz</th>
                          {frequencies.map((f) => (
                            <th key={f}>{f}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['right', '右耳气导'],
                          ['left', '左耳气导'],
                          ['boneRight', '右耳骨导'],
                          ['boneLeft', '左耳骨导'],
                        ].map(([key, label]) => (
                          <tr key={key}>
                            <th
                              className={
                                key.toLowerCase().includes('right') ? 'ear-right' : 'ear-left'
                              }
                            >
                              {label}
                            </th>
                            {draft[key].map((p: Point, i: number) => (
                              <td key={p.frequency}>
                                <input
                                  aria-label={`${label} ${p.frequency} Hz`}
                                  type="number"
                                  min="-10"
                                  max="120"
                                  step="5"
                                  value={p.value ?? ''}
                                  onChange={(e) => {
                                    const a = [...draft[key]];
                                    a[i] = {
                                      ...p,
                                      value: e.target.value === '' ? null : Number(e.target.value),
                                      noResponse: e.target.value === '' ? false : p.noResponse,
                                    };
                                    change(key, a);
                                  }}
                                />
                                <label title="使用掩蔽">
                                  <input
                                    type="checkbox"
                                    aria-label={`${label} ${p.frequency} 掩蔽`}
                                    checked={p.masked}
                                    onChange={(e) => {
                                      const a = [...draft[key]];
                                      a[i] = { ...p, masked: e.target.checked };
                                      change(key, a);
                                    }}
                                  />
                                  掩蔽
                                </label>
                                <label title="最大输出仍无反应">
                                  <input
                                    type="checkbox"
                                    aria-label={`${label} ${p.frequency} 无反应`}
                                    checked={p.noResponse}
                                    disabled={p.value === null}
                                    onChange={(e) => {
                                      const a = [...draft[key]];
                                      a[i] = { ...p, noResponse: e.target.checked };
                                      change(key, a);
                                    }}
                                  />
                                  无反应
                                </label>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="intake-chart">
                    <Audiogram exam={draft as Exam} />
                  </div>
                  <div className="form-grid space-top">
                    <Field label="言语测听" wide>
                      <textarea
                        value={draft.speech}
                        onChange={(e) => change('speech', e.target.value)}
                        placeholder="测试材料、呈现声级、安静或噪声条件、识别率…"
                      />
                    </Field>
                    <Field label="其他检查结果" wide>
                      <textarea
                        value={draft.other}
                        onChange={(e) => change('other', e.target.value)}
                        placeholder="耳镜、声导抗、耳声发射等；原始报告可在附件中上传。"
                      />
                    </Field>
                    <Field label="检查结论与服务建议" wide>
                      <textarea
                        required
                        value={draft.conclusion}
                        onChange={(e) => change('conclusion', e.target.value)}
                      />
                    </Field>
                  </div>
                </>
              )}
              {modal === 'fitting' && (
                <div className="form-grid">
                  {!catalog.models.length && (
                    <div className="notice wide">
                      <Headphones size={20} />
                      <p>门店尚未建立助听器型号。请先在“门店设置”中添加品牌、系列和型号。</p>
                    </div>
                  )}
                  <Field label="验配 / 调试日期 *">
                    <input
                      type="date"
                      required
                      max={today()}
                      value={draft.date}
                      onChange={(e) => change('date', e.target.value)}
                    />
                  </Field>
                  <Field label="佩戴耳侧">
                    <select value={draft.side} onChange={(e) => change('side', e.target.value)}>
                      {['双耳', '左耳', '右耳'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="品牌 *">
                    <select
                      required={!draft.id || draft.deviceSelectionChanged}
                      value={draft.deviceBrandId || ''}
                      onChange={(e) =>
                        setDraft((d: any) => ({
                          ...d,
                          deviceSelectionChanged: true,
                          deviceBrandId: e.target.value,
                          deviceSeriesId: '',
                          deviceModelId: '',
                          brand: '',
                          series: '',
                          model: '',
                        }))
                      }
                    >
                      <option value="">
                        {draft.id ? `保留原品牌：${draft.brand}` : '选择品牌'}
                      </option>
                      {catalog.brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="系列 *">
                    <select
                      required={!draft.id || draft.deviceSelectionChanged}
                      value={draft.deviceSeriesId || ''}
                      onChange={(e) =>
                        setDraft((d: any) => ({
                          ...d,
                          deviceSelectionChanged: true,
                          deviceSeriesId: e.target.value,
                          deviceModelId: '',
                          series: '',
                          model: '',
                        }))
                      }
                    >
                      <option value="">
                        {draft.id ? `保留原系列：${draft.series || '无'}` : '选择系列'}
                      </option>
                      {catalog.series
                        .filter((s) => s.brand_id === draft.deviceBrandId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="型号 *">
                    <select
                      required={!draft.id || draft.deviceSelectionChanged}
                      value={draft.deviceModelId || ''}
                      onChange={(e) => {
                        const selectedModel = catalog.models.find((m) => m.id === e.target.value);
                        const selectedSeries = catalog.series.find(
                          (s) => s.id === draft.deviceSeriesId,
                        );
                        const selectedBrand = catalog.brands.find(
                          (b) => b.id === draft.deviceBrandId,
                        );
                        setDraft((d: any) => ({
                          ...d,
                          deviceSelectionChanged: true,
                          deviceModelId: e.target.value,
                          brand: selectedBrand?.name || '',
                          series: selectedSeries?.name || '',
                          model: selectedModel?.name || '',
                        }));
                      }}
                    >
                      <option value="">
                        {draft.id ? `保留原型号：${draft.model}` : '选择型号'}
                      </option>
                      {catalog.models
                        .filter((m) => m.series_id === draft.deviceSeriesId)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="设备序列号（注明左右耳）" wide>
                    <input
                      value={draft.serial}
                      onChange={(e) => change('serial', e.target.value)}
                    />
                  </Field>
                  <Field label="成交金额（元）">
                    <input
                      type="number"
                      min="0"
                      max="10000000"
                      step="0.01"
                      value={draft.amount}
                      onChange={(e) => change('amount', e.target.value)}
                    />
                  </Field>
                  <Field label="保修截止">
                    <input
                      type="date"
                      value={draft.warranty}
                      onChange={(e) => change('warranty', e.target.value)}
                    />
                  </Field>
                  <Field label="试戴、调试、验证与交付说明" wide>
                    <textarea
                      required
                      value={draft.notes}
                      onChange={(e) => change('notes', e.target.value)}
                      placeholder="记录调试原因、参数变化、真耳验证、客户反馈及使用指导。"
                    />
                  </Field>
                </div>
              )}
              {modal === 'followup' && (
                <div className="form-grid">
                  <Field label="客户 *" wide>
                    <select
                      required
                      value={draft.customerId}
                      disabled={!!draft.id}
                      onChange={(e) => change('customerId', e.target.value)}
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.status}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="计划日期 *">
                    <input
                      type="date"
                      required
                      value={draft.due}
                      onChange={(e) => change('due', e.target.value)}
                    />
                  </Field>
                  <Field label="服务类型">
                    <select value={draft.type} onChange={(e) => change('type', e.target.value)}>
                      {['适应回访', '听力复查', '清洁保养', '维修跟进', '到店预约'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="计划内容" wide>
                    <textarea
                      required
                      value={draft.note}
                      onChange={(e) => change('note', e.target.value)}
                      placeholder="本次需要关注的问题、希望了解的佩戴反馈…"
                    />
                  </Field>
                  {!!draft.completed && (
                    <Field label="本次联系结果 *" wide>
                      <textarea
                        required
                        value={draft.result || ''}
                        onChange={(e) => change('result', e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              )}
              {modal === 'complete' && (
                <>
                  <div className="completion-summary">
                    <strong>
                      {draft.name} · {draft.type}
                    </strong>
                    <p>{draft.note}</p>
                    <small>计划日期 {draft.due}</small>
                  </div>
                  <Field label="本次联系结果 *">
                    <textarea
                      autoFocus
                      required
                      value={draft.result}
                      onChange={(e) => change('result', e.target.value)}
                      placeholder="记录客户反馈、已提供的服务及下一步建议。"
                    />
                  </Field>
                </>
              )}
            </div>
            <footer className="modal-footer">
              <span>保存后将加入客户服务档案</span>
              <button className="button" type="button" onClick={closeModal} disabled={busy}>
                取消
              </button>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? '保存中…' : '保存记录'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  unit,
  detail,
  icon,
  warning = false,
}: {
  label: string;
  value: number;
  unit: string;
  detail: string;
  icon: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={'stat ' + (warning ? 'warning' : '')}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{detail}</p>
    </div>
  );
}
function Distribution({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: { label: string; count: number }[];
}) {
  const total = data.reduce((n, d) => n + d.count, 0);
  return (
    <section className="panel padded">
      <h2>{title}</h2>
      <p className="muted">{subtitle}</p>
      <div className="distribution">
        {data.map((d) => (
          <div key={d.label}>
            <div>
              <span>{d.label}</span>
              <strong>
                {d.count} <small>({total ? Math.round((d.count / total) * 100) : 0}%)</small>
              </strong>
            </div>
            <div className="bar-track">
              <i style={{ width: total ? (d.count / total) * 100 + '%' : '0%' }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
