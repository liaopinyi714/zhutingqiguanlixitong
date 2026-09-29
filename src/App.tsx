import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  House,
  ContactRound,
  ChartNoAxesCombined,
  Wrench,
  Menu,
  Shield,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  Clock3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  PanelLeft,
  Ear,
  FileText,
  Headphones,
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
import { HearingEditor } from './HearingEditor';
import { Field, FittingDeviceFields } from './Fields';
import { RecordEditor } from './RecordEditor';
import { Accounts, AccountMenu } from './Accounts';
import { ServiceDirectory } from './ServiceDirectory';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import { customerTabs, deviceName, deviceSerial } from './workspace';

import type { Customer, Exam, Follow, Detail, Point } from './types';
const blankCurve = () =>
  frequencies.map((frequency) => ({ frequency, value: null, masked: false, noResponse: false }));
const statuses = ['全部客户', '待评估', '试戴中', '已验配', '长期随访'];
const today = () => new Date().toLocaleDateString('sv-SE');
const age = (date: string) => {
  const d = new Date(date),
    n = new Date();
  if (!date || Number.isNaN(d.getTime())) return NaN;
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
const restoreDeadline = (deletedAt: string) =>
  new Date(new Date(deletedAt.replace(' ', 'T') + 'Z').getTime() + 30 * 86400000).toLocaleString(
    'zh-CN',
    {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    },
  );
async function api(path: string, method = 'GET', data?: unknown) {
  const response = await fetch('/api' + path, {
    method,
    headers: {
      'X-Requested-With': 'hearing-care',
      ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    redirect: 'manual',
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
  if (
    response.type === 'opaqueredirect' ||
    !response.headers.get('Content-Type')?.includes('application/json')
  )
    throw new Error('登录可能已过期。请先保存未提交的内容，再刷新页面重新登录。');
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
      {(
        [
          ['uclRight', '#bd615c'],
          ['uclLeft', '#4a7faf'],
        ] as const
      ).map(([key, color]) =>
        (exam[key] || [])
          .filter((p) => p.value !== null)
          .map((p) => (
            <text
              key={key + p.frequency}
              x={x(p.frequency)}
              y={y(p.value!) + 5}
              fill={color}
              textAnchor="middle"
              fontSize="15"
            >
              U
              <title>
                {key === 'uclRight' ? '右耳' : '左耳'} UCL {p.frequency} Hz：{p.value} dB HL
              </title>
            </text>
          )),
      )}
    </svg>
  );
}

function IntakePage({
  role,
  onSave,
  onCancel,
  onDirty,
}: {
  onDirty: (dirty: boolean) => void;
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
  const [fitting, setFitting] = useState({
    date: today(),
    side: '双耳',
    brand: '',
    series: '',
    model: '',
    serialLeft: '',
    serialRight: '',
    amount: 0,
    warranty: '',
    notes: '',
  });
  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [followup, setFollowup] = useState({ due: today(), type: '适应回访', note: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const snapshot = JSON.stringify({
    profile,
    exam,
    fitting,
    followup,
    examEnabled,
    fittingEnabled,
    followupEnabled,
  });
  const initialIntake = useRef(snapshot);
  useEffect(() => {
    onDirty(snapshot !== initialIntake.current);
  }, [snapshot]);
  useEffect(() => () => onDirty(false), []);
  async function submitIntake(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await onSave({
        customer: profile,
        ...(examEnabled ? { exam } : {}),
        ...(fittingEnabled
          ? {
              fitting: {
                ...fitting,
                amount: Number(fitting.amount),
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
            <Field label="出生日期">
              <input
                type="date"
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
                placeholder="填写客户联系电话"
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
        {role === '店主' && (
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
              <HearingEditor value={exam} onChange={setExam} />
            ) : (
              <p className="muted">勾选后直接在左右耳听力图上标记 AC、BC 和 UCL。</p>
            )}
          </section>
        )}
        {role === '店主' && (
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
                <FittingDeviceFields
                  value={fitting}
                  onChange={(key, value) => setFitting((current) => ({ ...current, [key]: value }))}
                />
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
                <Field label="调试、验证与交付说明" wide>
                  <textarea
                    value={fitting.notes}
                    onChange={(e) => setFitting({ ...fitting, notes: e.target.value })}
                  />
                </Field>
              </div>
            ) : (
              <p className="muted">可填写型号、序列号及保修等资料，未知项目以后再补充。</p>
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
              <Field label="计划内容" wide>
                <textarea
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
    [customers, setCustomers] = useState<Customer[]>([]),
    [removedCustomers, setRemovedCustomers] = useState<Customer[]>([]),
    [devices, setDevices] = useState<any[]>([]),
    [repairs, setRepairs] = useState<any[]>([]),
    [mobileMenu, setMobileMenu] = useState(false),
    [originPage, setOriginPage] = useState('customers'),
    [followups, setFollowups] = useState<Follow[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [removed, setRemoved] = useState<{
      exams: any[];
      fittings: any[];
      repairs: any[];
      followups: Follow[];
      attachments: any[];
    }>({
      exams: [],
      fittings: [],
      repairs: [],
      followups: [],
      attachments: [],
    }),
    [editingField, setEditingField] = useState(''),
    [editingValue, setEditingValue] = useState(''),
    [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [searchPosition, setSearchPosition] = useState({
      top: 80,
      left: 12,
      width: 360,
      maxHeight: 520,
    }),
    [globalQuery, setGlobalQuery] = useState(''),
    [globalResults, setGlobalResults] = useState<Customer[]>([]),
    [searchBusy, setSearchBusy] = useState(false),
    [searchError, setSearchError] = useState(''),
    [searchActive, setSearchActive] = useState(0),
    [excelBusy, setExcelBusy] = useState(''),
    [filter, setFilter] = useState('全部客户'),
    [editorKind, setEditorKind] = useState(''),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>({}),
    [examIndex, setExamIndex] = useState(0),
    [examEditorVersion, setExamEditorVersion] = useState(0),
    [compare, setCompare] = useState(false),
    [taskFilter, setTaskFilter] = useState('待完成'),
    [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null),
    [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
      try {
        return window.localStorage.getItem('hearing-sidebar-collapsed') === 'true';
      } catch {
        return false;
      }
    }),
    [sidebarHover, setSidebarHover] = useState(false),
    [identity, setIdentity] = useState({ demo: false, name: '', email: '', storeName: '聆序听力', tenant_id: '' });

  const intakeDirty = useRef(false);
  const accountDirty = useRef(false);
  const accountBusy = useRef(false);
  const draftSnapshot = useRef('');
  const { route, update: updateRoute } = useWorkspaceRoute(() => {
    if (!canLeaveEditor()) return false;
    setEditorKind('');
    setEditingField('');
    setSearchOpen(false);
    return true;
  });
  const { page, customer: selected, tab, record: focusedRecord, device: repairDevice } = route;
  const setPage = (page: string) => updateRoute({ page });
  const setSelected = (customer: string | null) => updateRoute({ customer });
  const setTab = (tab: string) => updateRoute({ tab, record: '', device: '' });
  function canLeaveEditor() {
    if (busy || accountBusy.current) return false;
    const dirty =
      intakeDirty.current ||
      accountDirty.current ||
      editorKind === 'exam' ||
      (editorKind && draftSnapshot.current !== JSON.stringify(draft)) ||
      (editingField && editingValue !== String(customer?.[editingField as keyof Customer] || ''));
    return !dirty || window.confirm('有尚未保存的更改，确定放弃？');
  }
  useEffect(() => {
    draftSnapshot.current = JSON.stringify(draft);
  }, [editorKind, draft.id]);
  useEffect(() => {
    if (!detail || !focusedRecord) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById('record-' + focusedRecord);
      node?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
      node?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [detail, focusedRecord, tab]);
  useEffect(() => {
    try {
      window.localStorage.setItem('hearing-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      /* Storage may be unavailable in a private browser session. */
    }
  }, [sidebarCollapsed]);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function previewSidebar(open: boolean) {
    clearTimeout(sidebarTimer.current);
    if (!sidebarCollapsed) return;
    sidebarTimer.current = setTimeout(() => setSidebarHover(open), open ? 160 : 280);
  }
  useEffect(() => () => clearTimeout(sidebarTimer.current), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        !editorKind &&
        !editingField &&
        !accountDirty.current &&
        !accountBusy.current &&
        !intakeDirty.current
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editorKind, editingField]);
  function positionSearch(trigger: HTMLButtonElement) {
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const mobile = viewportWidth <= 650;
    const width = Math.min(
      viewportWidth - 24,
      mobile
        ? viewportWidth - 24
        : Math.max(rect.width, trigger.classList.contains('sidebar-search') ? 480 : rect.width),
    );
    const left =
      mobile && trigger.classList.contains('mobile-search')
        ? 12
        : Math.max(12, Math.min(rect.left, viewportWidth - width - 12));
    const top = mobile && trigger.classList.contains('mobile-search') ? 63 : Math.max(10, rect.top);
    setSearchPosition({ top, left, width, maxHeight: Math.max(155, viewportHeight - top - 12) });
  }
  function openSearch(trigger: HTMLButtonElement) {
    searchTriggerRef.current = trigger;
    positionSearch(trigger);
    setSearchOpen(true);
  }
  const customer = customers.find((c) => c.id === selected),
    pending = followups.filter((f) => !f.completed),
    overdue = pending.filter((f) => f.due < today()),
    todayTasks = pending.filter((f) => f.due === today()),
    fitted = customers.filter((c) => ['已验配', '长期随访'].includes(c.status)),
    warrantyAlerts = devices
      .filter((item) => item.warranty && daysUntil(item.warranty) <= 90)
      .sort((a, b) => a.warranty.localeCompare(b.warranty));
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };
  async function refresh(includeRemoved = role === '店主') {
    const [a, b, warrantyRows, removedRows, repairRows] = await Promise.all([
      api('/customers'),
      api('/followups'),
      api('/devices'),
      includeRemoved ? api('/customers/removed') : Promise.resolve([]),
      api('/repairs'),
    ]);
    setCustomers(a);
    setFollowups(b);
    setDevices(warrantyRows);
    setRepairs(repairRows);
    setRemovedCustomers(removedRows);
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
    (async () => {
      const config = await api('/config');
      setIdentity((previous) => ({ ...previous, demo: config.demo }));
      try {
        const r = await api('/me');
        setIdentity(r);
        setRole(r.role);
        await refresh(r.role === '店主');
      } catch (reason) {
        if (!config.demo) setError((reason as Error).message);
      }
    })()
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (!role || !identity.tenant_id) return;
    const mark = () => {
      if (document.visibilityState === 'visible')
        api('/accounts/presence', 'POST').catch(() => {});
    };
    mark();
    const timer = window.setInterval(mark, 60000);
    document.addEventListener('visibilitychange', mark);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [role, identity.tenant_id]);
  useEffect(() => {
    let cancelled = false;
    if (selected && role) {
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
  }, [selected, role]);
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
        if (role) {
          const selector =
            window.innerWidth <= 650
              ? '.mobile-search'
              : page === 'overview'
                ? '.home-search'
                : '.sidebar-search';
          const trigger = document.querySelector<HTMLButtonElement>(selector);
          if (trigger) openSearch(trigger);
        }
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [role, page]);
  useEffect(() => {
    if (!searchOpen) return;
    const update = () => {
      if (searchTriggerRef.current?.isConnected) positionSearch(searchTriggerRef.current);
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [searchOpen]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, selected]);
  function navigate(next: string) {
    if (!canLeaveEditor()) return;
    setEditorKind('');
    setEditingField('');
    setSearchOpen(false);
    setMobileMenu(false);
    setAccountAnchor(null);
    updateRoute({ page: next, customer: null, tab: '概览', record: '', device: '' });
    setFilter('全部客户');
    setTaskFilter('待完成');
    setSearch('');
    setError('');
  }
  async function switchStore(storeId: string) {
    if (!canLeaveEditor() || storeId === identity.tenant_id) return;
    setError('');
    try {
      await api('/accounts/stores/' + encodeURIComponent(storeId) + '/switch', 'POST');
      accountDirty.current = false;
      window.history.replaceState(null, '', '/#page=overview');
      window.location.reload();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function openCustomer(key: string, nextTab = '概览', record = '', device = '') {
    if (!canLeaveEditor()) return;
    if (page !== 'customers') setOriginPage(page);
    setEditorKind('');
    setSearchOpen(false);
    setMobileMenu(false);
    setEditingField('');
    updateRoute({ page: 'customers', customer: key, tab: nextTab, record, device });
    setError('');
  }
  function closeEditor() {
    if (!busy) {
      if (!canLeaveEditor()) return;
      if (editorKind === 'exam') setExamEditorVersion((version) => version + 1);
      setEditorKind('');
      setError('');
    }
  }
  function openForm(kind: string, record?: any) {
    if (busy || !canLeaveEditor()) return;
    setEditingField('');
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
              birthDate: '',
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
    if (kind === 'fitting')
      setDraft({
        date: today(),
        brand: '',
        series: '',
        model: '',
        side: '双耳',
        amount: 0,
        warranty: '',
        notes: '',
        ...record,
        serialLeft: record?.serialLeft || (record?.side === '左耳' ? record.serial : '') || '',
        serialRight: record?.serialRight || (record?.side === '右耳' ? record.serial : '') || '',
      });
    if (kind === 'repair')
      setDraft(
        record?.id
          ? {
              ...record,
              fittingId: record.fitting_id,
              occurredDate: record.occurred_date,
              receivedDate: record.received_date,
              completedDate: record.completed_date,
              workDone: record.work_done,
              warrantyCovered: !!record.warranty_covered,
            }
          : {
              fittingId: record?.fittingId || detail?.fittings[0]?.id || '',
              occurredDate: today(),
              receivedDate: today(),
              completedDate: '',
              status: '待送修',
              problem: '',
              findings: '',
              workDone: '',
              parts: '',
              price: 0,
              warrantyCovered: false,
              notes: '',
            },
      );
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
    const editorTabs: Record<string, string> = {
      customer: '概览',
      fitting: '验配记录',
      repair: '维修记录',
      followup: '随访记录',
      complete: '随访记录',
    };
    if (customer && editorTabs[kind]) setTab(editorTabs[kind]);
    if (kind === 'exam') {
      setPage('customers');
      setTab('听力检查');
    }
    setEditorKind(kind);
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
    intakeDirty.current = false;
    await refresh();
    openCustomer(created.id);
    flash('客户档案及所选服务记录已保存');
  }
  async function changeRecord(
    kind: 'exams' | 'fittings' | 'followups' | 'repairs',
    recordId: string,
    restore = false,
    customerId = selected,
  ) {
    if (!customerId) return;
    if (!restore && !window.confirm('确认删除这条记录？30 天内可在客户档案内恢复，之后自动清除。'))
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
      flash(restore ? '记录已恢复' : '记录已删除，30 天内可恢复');
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
        '确认删除这位客户的档案？检查、验配、维修、随访和附件会一起隐藏，30 天内可恢复，之后自动彻底清除。',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/customers/${recordId}${restore ? '/restore' : ''}`, restore ? 'POST' : 'DELETE');
      if (!restore && selected === recordId) setSelected(null);
      await refresh();
      flash(restore ? '客户档案已恢复' : '客户档案已删除，30 天内可恢复');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeAttachment(recordId: string, restore = false) {
    if (!selected) return;
    if (
      !restore &&
      !window.confirm('确认删除这份报告？30 天内可恢复，之后文件将从存储中彻底清除。')
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/customers/${selected}/attachments/${recordId}${restore ? '/restore' : ''}`,
        restore ? 'POST' : 'DELETE',
      );
      await loadDetail(selected);
      flash(restore ? '报告已恢复' : '报告已删除，30 天内可恢复');
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
      if (editorKind === 'customer') {
        const r = await api(
          draft.id ? `/customers/${draft.id}/profile` : '/customers',
          draft.id ? 'PUT' : 'POST',
          draft,
        );
        key = draft.id || r.id;
      }
      if (editorKind === 'exam')
        await api(
          `/customers/${selected}/exams${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          draft,
        );
      if (editorKind === 'fitting')
        await api(
          `/customers/${selected}/fittings${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          {
            ...draft,
            amount: Number(draft.amount),
          },
        );
      if (editorKind === 'repair')
        await api(
          `/customers/${selected}/repairs${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          { ...draft, price: Number(draft.price) },
        );
      if (editorKind === 'followup')
        await api(
          `/customers/${draft.customerId}/followups${draft.id ? '/' + draft.id : ''}`,
          draft.id ? 'PUT' : 'POST',
          draft,
        );
      if (editorKind === 'complete')
        await api(`/followups/${draft.id}`, 'PUT', { result: draft.result });
      await refresh();
      if (key) {
        setSelected(key);
        latestDetail = await api(`/customers/${key}/detail`);
        setDetail(latestDetail);
      }
      if (editorKind === 'exam') {
        setExamEditorVersion((version) => version + 1);
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
      if (editorKind === 'fitting') setTab('验配记录');
      if (editorKind === 'repair') setTab('维修记录');
      if (editorKind === 'customer') {
        setPage('customers');
        setTab('概览');
      }
      setEditorKind('');
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
      a.download = `聆序-客户档案-${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash('档案已导出，附件请在档案中单独下载');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function exportSpreadsheet(kind: 'core' | 'extended') {
    if (excelBusy) return;
    setExcelBusy(kind);
    setError('');
    try {
      const snapshot = await api('/export/spreadsheet');
      const [{ makeSheets }, { buildXlsx }] = await Promise.all([
        import('./spreadsheetExport'),
        import('./xlsx'),
      ]);
      const bytes = buildXlsx(makeSheets(snapshot, kind));
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `聆序-${kind === 'core' ? '客户核心信息' : '客户业务数据'}-${today()}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      flash(kind === 'core' ? '核心信息表格已下载' : '业务数据表格已下载');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExcelBusy('');
    }
  }
  const filtered = customers.filter(
    (c) =>
      (filter === '全部客户' || c.status === filter) &&
      [c.name, c.phone, c.id].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  if (boot)
    return (
      <div className="loading cf-loading">
        <span className="brand-icon">
          <Ear size={26} />
        </span>
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
        </header>
        <main className="cf-login-main">
          <div className="cf-login-intro">
            <h1>进入聆序工作台</h1>
            <p>{identity.demo ? '使用店主账户体验客户管理。' : '使用已授权的邮箱登录。'}</p>
          </div>
          <section className="cf-login-card">
            <div className="cf-login-card-head">
              <span className="cf-login-pill">
                <i /> {identity.demo ? '演示登录' : '账户登录'}
              </span>
              <span>{identity.demo ? '店主账户' : '验证登录邮箱'}</span>
            </div>
            <button
              className="button primary full cf-login-submit"
              disabled={busy}
              onClick={async () => {
                if (!identity.demo) {
                  window.location.assign('/api/auth/start');
                  return;
                }
                setBusy(true);
                setError('');
                try {
                  await api('/login', 'POST', { role: '店主' });
                  setIdentity(await api('/me'));
                  await refresh(true);
                  setRole('店主');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在进入…' : identity.demo ? '进入演示工作台' : '验证身份并进入'}
              <ArrowRight size={17} />
            </button>
            {error && <div className="error">{error}</div>}
            <p className="cf-login-note">
              <ShieldCheck size={16} />
              {identity.demo
                ? '本演示含虚构客户资料，请勿录入真实个人信息。演示角色可公开切换。'
                : '门店和操作权限由管理员分配。如无法进入，请联系管理员核对员工邮箱。'}
            </p>
          </section>
        </main>
        <footer className="cf-login-footer">聆序 · 助听器客户管理</footer>
      </div>
    );
  const navs = [
    ['overview', '工作台', House],
    ['customers', '客户档案', ContactRound],
    ['devices', '验配设备', Headphones],
    ['repairs', '设备维修', Wrench],
    ['followups', '随访预约', CalendarDays],
    ['warranties', '保修提醒', Shield],
    ['reports', '统计分析', ChartNoAxesCombined],
    ['recycle', '回收站', Trash2],
    ['settings', '设置', Settings2],
  ] as const;
  const editor =
    editorKind && editorKind !== 'exam' ? (
      <RecordEditor
        kind={editorKind}
        draft={draft}
        customers={customers}
        detail={detail}
        error={error}
        busy={busy}
        change={change}
        submit={submit}
        closeEditor={closeEditor}
      />
    ) : null;
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
                      {c.gender} ·{' '}
                      {Number.isFinite(age(c.birthDate)) ? `${age(c.birthDate)} 岁` : '年龄未填写'}
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
          <div
            key={f.id}
            id={'record-' + f.id}
            tabIndex={-1}
            className={'task-record' + (focusedRecord === f.id ? ' record-highlight' : '')}
          >
            {['followup', 'complete'].includes(editorKind) && draft.id === f.id ? (
              editor
            ) : (
              <div className="task-row">
                <div
                  className={'task-icon ' + (f.completed ? 'done' : f.due < today() ? 'late' : '')}
                >
                  <CalendarDays size={18} />
                </div>
                <div className="task-body">
                  <button className="text-link" onClick={() => openCustomer(f.customer_id)}>
                    {f.name}
                  </button>
                  <span className="task-type">{f.type}</span>
                  <button className="task-description" onClick={() => openForm('followup', f)}>
                    {(f.completed ? f.result : f.note) || '添加随访内容'}
                    <Pencil size={13} />
                  </button>
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
            )}
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
              if (!canLeaveEditor()) return;
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
                  required={field === 'name'}
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
            <button
              className="editable-value"
              onClick={() => {
                if (!canLeaveEditor()) return;
                setEditingField(field);
                setEditingValue(value);
              }}
            >
              {value || '未填写'}
              <Pencil size={13} />
            </button>
          )}
        </dd>
      </div>
    );
  };
  return (
    <div
      className={
        'app-shell cf-shell' +
        (sidebarCollapsed ? ' sidebar-collapsed' : '') +
        (sidebarHover && sidebarCollapsed ? ' sidebar-peek' : '')
      }
    >
      <aside className="sidebar">
        <div
          className="sidebar-content"
          onMouseEnter={() => {
            if (window.matchMedia('(hover: hover)').matches) previewSidebar(true);
          }}
          onMouseLeave={() => previewSidebar(false)}
          onFocusCapture={() => previewSidebar(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) previewSidebar(false);
          }}
        >
          <div className="brand">
            <span className="brand-icon">
              <Ear size={24} />
            </span>
            <div>
              <b>聆序</b>
              <small>{identity.storeName}</small>
            </div>
          </div>
          <button
            className="sidebar-search"
            title="搜索客户"
            aria-label="搜索客户"
            onClick={(event) => openSearch(event.currentTarget)}
          >
            <Search size={18} />
            <span>快速搜索客户...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav>
            {navs
              .filter(([key]) => key !== 'recycle' || role === '店主')
              .map(([key, label, Icon]) => (
                <button
                  key={key}
                  title={label}
                  aria-label={label}
                  onClick={() => navigate(key)}
                  className={
                    page === key ||
                    (key === 'customers' && page === 'intake') ||
                    (key === 'settings' && page === 'accounts')
                      ? 'active'
                      : ''
                  }
                >
                  <Icon size={18} strokeWidth={1.5} />
                  <span>{label}</span>
                  {key === 'followups' && pending.length > 0 && <b>{pending.length}</b>}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className="profile"
              title="我的账户"
              aria-label="我的账户"
              aria-expanded={!!accountAnchor}
              onClick={(event) =>
                setAccountAnchor(accountAnchor === event.currentTarget ? null : event.currentTarget)
              }
            >
              <span className="profile-avatar">{(identity.name || role).slice(0, 1)}</span>
              <div>
                <strong>{identity.name || role}</strong>
                <small>店主</small>
              </div>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? '固定展开侧栏' : '收起侧栏'}
          onClick={() => {
            clearTimeout(sidebarTimer.current);
            setSidebarCollapsed((value) => !value);
            setSidebarHover(false);
          }}
        >
          <PanelLeft size={18} strokeWidth={1.4} />
        </button>
      </aside>
      <nav className="mobile-navigation" aria-label="主要导航">
        {navs
          .filter(([key]) => ['overview', 'customers', 'followups', 'repairs'].includes(key))
          .map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => navigate(key)}
            >
              <Icon size={20} strokeWidth={1.5} />
              <span>{label}</span>
            </button>
          ))}
        <button
          className={mobileMenu ? 'active' : ''}
          onClick={() => setMobileMenu((open) => !open)}
          aria-expanded={mobileMenu}
          aria-label="更多导航"
        >
          <Menu size={20} />
          <span>更多</span>
        </button>
      </nav>
      {mobileMenu && (
        <div className="mobile-menu-backdrop" onClick={() => setMobileMenu(false)}>
          <section
            className="mobile-menu"
            aria-label="更多功能"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <strong>更多功能</strong>
              <button
                className="icon-action"
                aria-label="关闭导航"
                onClick={() => setMobileMenu(false)}
              >
                <X size={19} />
              </button>
            </header>
            {navs
              .filter(
                ([key]) =>
                  !['overview', 'customers', 'followups', 'repairs'].includes(key) &&
                  (key !== 'recycle' || role === '店主'),
              )
              .map(([key, label, Icon]) => (
                <button key={key} onClick={() => navigate(key)}>
                  <Icon size={19} />
                  {label}
                  <ChevronRight size={16} />
                </button>
              ))}
          </section>
        </div>
      )}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button onClick={() => navigate('overview')}>聆序</button> <ChevronRight size={14} />{' '}
            <button onClick={() => navigate(page)}>
              {page === 'accounts'
                ? '账户管理'
                : page === 'intake'
                  ? '新建客户'
                  : navs.find((n) => n[0] === page)?.[1]}
            </button>
            {customer && (
              <>
                <ChevronRight size={14} />
                <span>{customer.name}</span>
              </>
            )}
          </div>
          <div className="top-actions">
            <button
              className="icon-button mobile-search"
              aria-label="搜索客户"
              onClick={(event) => openSearch(event.currentTarget)}
            >
              <Search size={19} />
            </button>
            {identity.demo && <span className="demo-pill">演示版</span>}
            <button
              className="icon-button"
              aria-label="查看待办"
              onClick={() => navigate('followups')}
            >
              <Bell size={19} />
              {todayTasks.length > 0 && <i className="notification-dot" />}
            </button>
            <button
              className="top-avatar"
              aria-label="我的账户"
              aria-expanded={!!accountAnchor}
              onClick={(event) =>
                setAccountAnchor(accountAnchor === event.currentTarget ? null : event.currentTarget)
              }
            >
              {(identity.name || role).slice(0, 1)}
            </button>
          </div>
        </header>
        <div className="content">
          {error && !editorKind && (
            <div className="error dismiss">
              {error}
              <button onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === 'accounts' && (
            <Accounts
              api={api}
              identity={identity}
              updated={async () => setIdentity(await api('/me'))}
              switchStore={switchStore}
              dirty={(value) => {
                accountDirty.current = value;
              }}
              saving={(value) => {
                accountBusy.current = value;
              }}
            />
          )}
          {page === 'recycle' && (
            <>
              <div className="page-heading">
                <h1>回收站</h1>
              </div>{' '}
              {role === '店主' && (
                <section className="panel padded space-top">
                  <div className="section-title">
                    <h2>已删除档案</h2>
                  </div>
                  <p className="muted retention-note">
                    删除后保留 30 天；到期自动彻底清除，之后无法恢复。
                  </p>
                  {removedCustomers.length ? (
                    <div className="removed-customer-list">
                      {removedCustomers.map((item) => (
                        <div key={item.id}>
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              {item.phone || '未填写电话'} · 可恢复至{' '}
                              {restoreDeadline(item.deleted_at || '')}
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
                  )}
                </section>
              )}
            </>
          )}
          {(['devices', 'repairs', 'warranties'] as string[]).includes(page) && (
            <ServiceDirectory
              key={page}
              kind={page as 'devices' | 'repairs' | 'warranties'}
              devices={devices}
              repairs={repairs}
              customers={customers}
              canEdit={role === '店主'}
              open={openCustomer}
              create={(kind, customerId, deviceId) => {
                openCustomer(customerId, kind === 'repair' ? '维修记录' : '验配记录');
                openForm(kind, deviceId ? { fittingId: deviceId } : undefined);
              }}
            />
          )}
          {page === 'intake' && (
            <IntakePage
              onDirty={(value) => {
                intakeDirty.current = value;
              }}
              role={role}
              onSave={saveIntake}
              onCancel={() => navigate('customers')}
            />
          )}
          {page === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <h1>查找客户，开始服务</h1>
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
              <button className="home-search" onClick={(event) => openSearch(event.currentTarget)}>
                <Search size={22} />
                <span>搜索姓名、电话、型号、序列号或服务记录</span>
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </button>
              <div className="home-shortcuts">
                <section>
                  <header>
                    <span>客户档案</span>
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
                <h2>工作概况</h2>
              </div>
              <div className="stats-grid">
                <Stat
                  onClick={() => navigate('customers')}
                  label="客户总数"
                  value={customers.length}
                  unit="位"
                  detail=""
                  icon={<Users />}
                />
                <Stat
                  onClick={() => navigate('devices')}
                  label="已验配客户"
                  value={fitted.length}
                  unit="位"
                  detail=""
                  icon={<Headphones />}
                />
                <Stat
                  onClick={() => {
                    navigate('followups');
                    setTaskFilter('今日');
                  }}
                  label="今日待办"
                  value={todayTasks.length}
                  unit="项"
                  detail=""
                  icon={<CalendarDays />}
                />
                <Stat
                  onClick={() => {
                    navigate('followups');
                    setTaskFilter('已逾期');
                  }}
                  label="逾期未跟进"
                  value={overdue.length}
                  unit="项"
                  detail=""
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
                    </div>
                    <button className="text-link muted" onClick={() => navigate('followups')}>
                      查看全部 <ArrowRight size={15} />
                    </button>
                  </div>
                  {taskRows([...pending].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4))}
                </section>
                <div className="dashboard-side">
                  <section className="panel journey-panel">
                    <h2>服务阶段</h2>
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
                                  background: ['#b8bdc5', '#7a9cca', '#5285c0', '#215eab'][i],
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
                                  background: ['#b8bdc5', '#7a9cca', '#5285c0', '#215eab'][i],
                                }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
              <section className="panel recent-panel">
                <div className="panel-heading">
                  <div>
                    <h2>最近建档</h2>
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
                  <h1>客户档案</h1>
                </div>
                <div className="button-row customer-list-actions">
                  <button
                    className="button"
                    disabled={!!excelBusy}
                    onClick={() => exportSpreadsheet('core')}
                  >
                    <ArrowDownToLine size={17} />
                    {excelBusy === 'core' ? '正在生成…' : '导出 Excel'}
                  </button>
                  <button className="button primary" onClick={() => openForm('customer')}>
                    <Plus size={18} />
                    新建客户
                  </button>
                </div>
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
            </>
          )}
          {page === 'customers' && customer && (
            <>
              <button className="back" onClick={() => navigate(originPage)}>
                <ArrowLeft size={16} />
                返回{navs.find((n) => n[0] === originPage)?.[1] || '客户档案'}
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
                      {customer.gender} ·{' '}
                      {Number.isFinite(age(customer.birthDate))
                        ? `${age(customer.birthDate)} 岁`
                        : '年龄未填写'}{' '}
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
                {customerTabs.map((t) => (
                  <button
                    key={t}
                    className={tab === t ? 'active' : ''}
                    onClick={() => {
                      if (!canLeaveEditor()) return;
                      setEditorKind('');
                      setEditingField('');
                      setTab(t);
                    }}
                  >
                    {t}
                    {detail && t !== '概览' && (
                      <span>
                        {
                          (
                            {
                              听力检查: detail.exams.length,
                              验配记录: detail.fittings.length,
                              维修记录: detail.repairs.length,
                              随访记录: detail.followups.length,
                              报告附件: detail.attachments.length,
                            } as Record<string, number>
                          )[t]
                        }
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {!detail ? (
                <div className="loading-inline">正在读取档案…</div>
              ) : (
                <>
                  {tab === '概览' && editorKind === 'customer' && editor}
                  {tab === '概览' && editorKind !== 'customer' && (
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
                                role === '店主' && (
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
                            <h2>验配设备</h2>
                            <Headphones size={18} />
                          </div>
                          {detail.fittings.length ? (
                            detail.fittings.map((f) => (
                              <button
                                className="device-summary-link"
                                key={f.id}
                                onClick={() => openCustomer(customer.id, '验配记录', f.id)}
                              >
                                <Headphones size={18} />
                                <span>
                                  <strong>{deviceName(f)}</strong>
                                  <small>
                                    {f.side} · {f.date}
                                  </small>
                                  <small>{deviceSerial(f)}</small>
                                </span>
                                <ChevronRight size={16} />
                              </button>
                            ))
                          ) : (
                            <Empty
                              text="暂无验配设备"
                              action={
                                role === '店主' && (
                                  <button className="button" onClick={() => openForm('fitting')}>
                                    <Plus size={15} />
                                    新增验配
                                  </button>
                                )
                              }
                            />
                          )}
                          {detail.repairs.length > 0 && (
                            <button
                              className="button full"
                              onClick={() => openCustomer(customer.id, '维修记录')}
                            >
                              <Wrench size={15} />
                              查看维修记录 · {detail.repairs.length}
                              <ArrowRight size={15} />
                            </button>
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
                    <section className="panel padded hearing-panel">
                      <div className="section-title">
                        <div>
                          <h2>听力检查</h2>
                        </div>
                        {role === '店主' && (
                          <button
                            className="button"
                            disabled={busy || editorKind === 'exam'}
                            onClick={() => openForm('exam')}
                          >
                            <Plus size={16} />
                            新增检查
                          </button>
                        )}
                      </div>
                      {editorKind === 'exam' || detail.exams.length > 0 ? (
                        (() => {
                          const ex: Exam =
                            editorKind === 'exam'
                              ? draft
                              : detail.exams[examIndex] || detail.exams[0];
                          const savedIndex = detail.exams.findIndex((item) => item.id === ex.id);
                          return (
                            <>
                              <div className="exam-toolbar">
                                {detail.exams.length > 0 && (
                                  <select
                                    aria-label="选择历史检查"
                                    value={examIndex}
                                    disabled={editorKind === 'exam'}
                                    onChange={(e) => setExamIndex(Number(e.target.value))}
                                  >
                                    {detail.exams.map((row, i) => (
                                      <option key={row.id} value={i}>
                                        {row.date} · 第 {detail.exams.length - i} 次检查
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {detail.exams.length > 0 && (
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
                                  打印 / PDF
                                </button>
                                {role === '店主' && ex.id && (
                                  <button
                                    className="button small danger-button"
                                    disabled={busy || editorKind === 'exam'}
                                    onClick={() => changeRecord('exams', ex.id!)}
                                  >
                                    删除本次检查
                                  </button>
                                )}
                              </div>
                              <form onSubmit={submit}>
                                <HearingEditor
                                  key={`${ex.id || 'new'}-${examEditorVersion}`}
                                  value={ex}
                                  previous={
                                    compare
                                      ? detail.exams[savedIndex < 0 ? 0 : savedIndex + 1]
                                      : undefined
                                  }
                                  onChange={
                                    role !== '店主' || busy
                                      ? undefined
                                      : (next) => {
                                          setDraft(next);
                                          setEditorKind('exam');
                                        }
                                  }
                                />
                                {editorKind === 'exam' && (
                                  <div className="hearing-save">
                                    <span>本次更改尚未保存</span>
                                    <button
                                      type="button"
                                      className="button"
                                      disabled={busy}
                                      onClick={closeEditor}
                                    >
                                      取消更改
                                    </button>
                                    <button className="button primary" disabled={busy}>
                                      {busy ? '保存中…' : '保存检查'}
                                    </button>
                                  </div>
                                )}
                              </form>
                            </>
                          );
                        })()
                      ) : (
                        <Empty text="点击“新增检查”，直接在图上录入" />
                      )}
                      {role === '店主' && removed.exams.length > 0 && (
                        <details className="removed-records">
                          <summary>已删除的检查</summary>

                          {removed.exams.map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.date} · {record.conclusion || '听力检查'} · 可恢复至{' '}
                                {restoreDeadline(record.deleted_at)}
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
                        </details>
                      )}
                    </section>
                  )}
                  {tab === '验配记录' && (
                    <section className="panel padded">
                      <div className="section-title">
                        <h2>历次验配与调试</h2>
                        {role === '店主' && (
                          <button className="button primary" onClick={() => openForm('fitting')}>
                            <Plus size={16} />
                            新增验配记录
                          </button>
                        )}
                      </div>
                      {editorKind === 'fitting' && !draft.id && editor}
                      {detail.fittings.length ? (
                        detail.fittings.map((f) => (
                          <article
                            className={
                              'record-card' + (focusedRecord === f.id ? ' record-highlight' : '')
                            }
                            key={f.id}
                            id={'record-' + f.id}
                            tabIndex={-1}
                          >
                            {editorKind === 'fitting' && draft.id === f.id ? (
                              editor
                            ) : (
                              <>
                                <div className="record-heading">
                                  <div>
                                    <span className="eyebrow">
                                      {f.date} · {f.side}
                                    </span>
                                    <h3>
                                      <button
                                        className="resource-title"
                                        disabled={role !== '店主'}
                                        onClick={() => openForm('fitting', f)}
                                      >
                                        {deviceName(f)}
                                        {role === '店主' && <Pencil size={14} />}
                                      </button>
                                    </h3>
                                  </div>
                                  <div className="record-actions">
                                    <Headphones size={25} />
                                    {role === '店主' && (
                                      <button
                                        className="button small"
                                        onClick={() => openForm('fitting', f)}
                                      >
                                        <Pencil size={14} />
                                        编辑
                                      </button>
                                    )}
                                    {role === '店主' && (
                                      <button
                                        className="button small"
                                        onClick={() => openForm('repair', { fittingId: f.id })}
                                      >
                                        登记维修
                                      </button>
                                    )}
                                    {role === '店主' && (
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
                                    <dd>{deviceSerial(f)}</dd>
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
                                <button
                                  className="record-note editable-value"
                                  onClick={() => role === '店主' && openForm('fitting', f)}
                                >
                                  {f.notes || '添加验配说明'}
                                  {role === '店主' && <Pencil size={13} />}
                                </button>
                                <div className="record-relations">
                                  <button
                                    className="relation-link"
                                    onClick={() => openCustomer(customer.id, '维修记录', '', f.id)}
                                  >
                                    <Wrench size={15} />
                                    维修记录{' '}
                                    <span>
                                      {detail.repairs.filter((r) => r.fitting_id === f.id).length}
                                    </span>
                                    <ArrowRight size={14} />
                                  </button>
                                  <button
                                    className="relation-link"
                                    onClick={() => openForm('followup')}
                                  >
                                    <CalendarDays size={15} />
                                    安排随访
                                    <ArrowRight size={14} />
                                  </button>
                                </div>
                              </>
                            )}
                          </article>
                        ))
                      ) : (
                        <Empty text="暂无验配记录" />
                      )}
                      {role === '店主' && removed.fittings.length > 0 && (
                        <details className="removed-records">
                          <summary>已删除的验配记录</summary>

                          {removed.fittings.map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.date} ·{' '}
                                {[record.brand, record.series, record.model]
                                  .filter(Boolean)
                                  .join(' · ')}{' '}
                                · 可恢复至 {restoreDeadline(record.deleted_at)}
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
                        </details>
                      )}
                    </section>
                  )}
                  {tab === '维修记录' && (
                    <section className="panel padded">
                      <div className="section-title">
                        <div>
                          <h2>助听器维修记录</h2>
                        </div>
                        {role === '店主' && (
                          <button
                            className="button primary"
                            disabled={!detail.fittings.length}
                            onClick={() =>
                              openForm(
                                'repair',
                                repairDevice ? { fittingId: repairDevice } : undefined,
                              )
                            }
                          >
                            <Plus size={16} /> 登记维修
                          </button>
                        )}
                      </div>
                      {!detail.fittings.length && (
                        <div className="notice">请先录入这位客户的验配设备，再登记维修。</div>
                      )}
                      {repairDevice && (
                        <div className="context-filter">
                          <Headphones size={16} />
                          <button
                            className="relation-link"
                            onClick={() => openCustomer(customer.id, '验配记录', repairDevice)}
                          >
                            {deviceName(detail.fittings.find((f) => f.id === repairDevice))}
                          </button>
                          <button
                            className="icon-action"
                            aria-label="查看全部设备的维修"
                            onClick={() => updateRoute({ device: '', record: '' })}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      )}
                      {editorKind === 'repair' && !draft.id && editor}
                      {detail.repairs
                        .filter((r) => !repairDevice || r.fitting_id === repairDevice)
                        .map((r) => {
                          const fitting = detail.fittings.find((f) => f.id === r.fitting_id);
                          return (
                            <article
                              className={
                                'record-card' + (focusedRecord === r.id ? ' record-highlight' : '')
                              }
                              key={r.id}
                              id={'record-' + r.id}
                              tabIndex={-1}
                            >
                              {editorKind === 'repair' && draft.id === r.id ? (
                                editor
                              ) : (
                                <>
                                  <div className="record-heading">
                                    <div>
                                      <span className="eyebrow">
                                        故障日期 {r.occurred_date} · {r.status}
                                      </span>
                                      <h3>
                                        <button
                                          className="resource-title"
                                          onClick={() =>
                                            openCustomer(customer.id, '验配记录', r.fitting_id)
                                          }
                                        >
                                          <Headphones size={16} />
                                          {deviceName(fitting)}
                                          <ArrowRight size={14} />
                                        </button>
                                      </h3>
                                      <p className="muted">
                                        {fitting?.side} · 序列号 {deviceSerial(fitting)}
                                      </p>
                                    </div>
                                    {role === '店主' && (
                                      <div className="record-actions">
                                        <button
                                          className="button small"
                                          onClick={() => openForm('repair', r)}
                                        >
                                          <Pencil size={14} /> 编辑
                                        </button>
                                        <button
                                          className="button small danger-button"
                                          disabled={busy}
                                          onClick={() => changeRecord('repairs', r.id)}
                                        >
                                          删除
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <dl className="info-grid">
                                    <div>
                                      <dt>接收日期</dt>
                                      <dd>{r.received_date || '未填写'}</dd>
                                    </div>
                                    <div>
                                      <dt>完工日期</dt>
                                      <dd>{r.completed_date || '未填写'}</dd>
                                    </div>
                                    <div>
                                      <dt>维修费用</dt>
                                      <dd>¥ {money(r.price)}</dd>
                                    </div>
                                    <div>
                                      <dt>保修处理</dt>
                                      <dd>{r.warranty_covered ? '保修范围内' : '非保修'}</dd>
                                    </div>
                                  </dl>
                                  <p className="record-note">
                                    <strong>故障：</strong>
                                    {r.problem}
                                  </p>
                                  {r.findings && (
                                    <p className="record-note">
                                      <strong>检测：</strong>
                                      {r.findings}
                                    </p>
                                  )}
                                  {r.work_done && (
                                    <p className="record-note">
                                      <strong>维修：</strong>
                                      {r.work_done}
                                    </p>
                                  )}
                                  {r.parts && (
                                    <p className="record-note">
                                      <strong>更换零件：</strong>
                                      {r.parts}
                                    </p>
                                  )}
                                  {r.notes && (
                                    <p className="record-note">
                                      <strong>备注：</strong>
                                      {r.notes}
                                    </p>
                                  )}
                                </>
                              )}
                            </article>
                          );
                        })}
                      {!detail.repairs.some(
                        (r) => !repairDevice || r.fitting_id === repairDevice,
                      ) &&
                        detail.fittings.length > 0 && <Empty text="暂无维修记录" />}
                      {role === '店主' && removed.repairs.length > 0 && (
                        <details className="removed-records">
                          <summary>已删除的维修记录</summary>

                          {removed.repairs.map((r) => (
                            <div key={r.id}>
                              <span>
                                {r.occurred_date} · {r.problem} · 可恢复至{' '}
                                {restoreDeadline(r.deleted_at)}
                              </span>
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() => changeRecord('repairs', r.id, true)}
                              >
                                恢复
                              </button>
                            </div>
                          ))}
                        </details>
                      )}
                    </section>
                  )}
                  {tab === '随访记录' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>随访与服务记录</h2>
                        </div>
                        <button className="button primary" onClick={() => openForm('followup')}>
                          <Plus size={16} />
                          安排随访
                        </button>
                      </div>
                      {editorKind === 'followup' && !draft.id && editor}
                      {taskRows(detail.followups.map((f) => ({ ...f, name: customer.name })))}
                      {removed.followups.length > 0 && (
                        <details className="removed-records padded">
                          <summary>已删除的随访</summary>

                          {removed.followups.map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.due} · {record.type} · {record.note} · 可恢复至{' '}
                                {restoreDeadline((record as any).deleted_at)}
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
                        </details>
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
                            <div key={a.id} className="attachment-item">
                              <a href={'/api/files/' + a.id} className="attachment">
                                <FileText size={24} />
                                <div>
                                  <strong>{a.name}</strong>
                                  <small>
                                    {(a.size / 1024).toFixed(1)} KB · {a.created_at.slice(0, 10)}
                                  </small>
                                </div>
                                <ArrowDownToLine size={18} />
                              </a>
                              {role === '店主' && (
                                <button
                                  className="button small danger-button"
                                  disabled={busy}
                                  onClick={() => changeAttachment(a.id)}
                                >
                                  <Trash2 size={14} />
                                  删除
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty text="上传原始报告，与结构化检查数据一起保存" />
                      )}
                      {role === '店主' && removed.attachments.length > 0 && (
                        <details className="removed-records">
                          <summary>已删除的报告附件</summary>

                          {removed.attachments.map((a) => (
                            <div key={a.id}>
                              <span>
                                {a.name} · {(a.size / 1024).toFixed(1)} KB · 可恢复至{' '}
                                {restoreDeadline(a.deleted_at)}
                              </span>
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() => changeAttachment(a.id, true)}
                              >
                                <RotateCcw size={14} />
                                恢复
                              </button>
                            </div>
                          ))}
                        </details>
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
                  <h1>随访与预约</h1>
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
              {editorKind === 'followup' && !draft.id && editor}
              <div className="stats-grid three">
                <Stat
                  onClick={() => {
                    navigate('followups');
                    setTaskFilter('待完成');
                  }}
                  label="待完成"
                  value={pending.length}
                  unit="项"
                  detail=""
                  icon={<ClipboardList />}
                />
                <Stat
                  onClick={() => {
                    navigate('followups');
                    setTaskFilter('今日');
                  }}
                  label="今日到期"
                  value={todayTasks.length}
                  unit="项"
                  detail=""
                  icon={<CalendarDays />}
                />
                <Stat
                  onClick={() => {
                    navigate('followups');
                    setTaskFilter('已完成');
                  }}
                  label="已完成"
                  value={followups.length - pending.length}
                  unit="项"
                  detail=""
                  icon={<CheckCircle2 />}
                />
              </div>
              <section className="panel">
                <div className="list-toolbar">
                  <div className="tabs">
                    {['待完成', '今日', '已逾期', '已完成', '全部'].map((t) => (
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
                      (taskFilter === '今日'
                        ? !f.completed && f.due === today()
                        : taskFilter === '已完成'
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
                  <h1>客户与服务统计</h1>
                </div>
              </div>
              <div className="export-options">
                <section className="panel export-card primary-export">
                  <div className="export-card-icon">
                    <ArrowDownToLine size={20} />
                  </div>
                  <h2>核心信息表格</h2>
                  <p>
                    分为已验配与未验配两张表，每位客户一行。包含姓名、联系方式、住址，以及历次验配型号和左右耳序列号。
                  </p>
                  <button
                    className="button primary"
                    disabled={!!excelBusy}
                    onClick={() => exportSpreadsheet('core')}
                  >
                    {excelBusy === 'core' ? '正在生成…' : '下载核心信息 Excel'}
                  </button>
                </section>
                <section className="panel export-card">
                  <div className="export-card-icon">
                    <ArrowDownToLine size={20} />
                  </div>
                  <h2>业务数据表格</h2>
                  <p>
                    包含上述两张客户表，另按最新听力、验配设备、维修和随访分表；每行标有客户姓名与档案编号。
                  </p>
                  <button
                    className="button"
                    disabled={!!excelBusy}
                    onClick={() => exportSpreadsheet('extended')}
                  >
                    {excelBusy === 'extended' ? '正在生成…' : '下载业务数据 Excel'}
                  </button>
                </section>
              </div>
              <div className="stats-grid">
                <Stat
                  onClick={() => navigate('customers')}
                  label="客户总数"
                  value={customers.length}
                  unit="位"
                  detail=""
                  icon={<Users />}
                />
                <Stat
                  onClick={() => navigate('devices')}
                  label="已验配占比"
                  value={
                    customers.length ? Math.round((fitted.length / customers.length) * 100) : 0
                  }
                  unit="%"
                  detail="已验配及长期随访 / 全部客户"
                  icon={<Headphones />}
                />
                <Stat
                  onClick={() => {
                    navigate('followups');
                    setTaskFilter('已完成');
                  }}
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
                  onClick={() => navigate('warranties')}
                  label="保修需关注"
                  value={warrantyAlerts.length}
                  unit="项"
                  detail="已过期或 90 天内到期"
                  icon={<Bell />}
                  warning
                />
              </div>
              <button className="section-shortcut panel" onClick={() => navigate('warranties')}>
                <Shield size={19} />
                <span>查看保修到期设备</span>
                <span className="count">{warrantyAlerts.length}</span>
                <ArrowRight size={17} />
              </button>
              <div className="report-grid">
                <Distribution
                  title="客户来源"
                  subtitle=""
                  data={[...new Set(customers.map((c) => c.source))].map((s) => ({
                    label: s || '未填写',
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
                    {
                      label: '未填写',
                      count: customers.filter((c) => !Number.isFinite(age(c.birthDate))).length,
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
                  <h1>门店设置</h1>
                </div>
              </div>
              <div className="detail-grid">
                <section className="panel padded">
                  <h2>{identity.storeName}</h2>
                  <dl className="stacked-info">
                    <div>
                      <dt>当前角色</dt>
                      <dd>{role}</dd>
                    </div>
                    <div>
                      <dt>数据空间</dt>
                      <dd>{identity.storeName}</dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>{identity.demo ? '本地演示' : '1.0'}</dd>
                    </div>
                  </dl>
                  <button className="button full" onClick={() => navigate('accounts')}>
                    <Users size={17} />
                    账户管理
                    <ChevronRight size={16} />
                  </button>
                </section>
                <section className="panel padded">
                  <div className="section-title">
                    <h2>数据导出</h2>
                    <ArrowDownToLine size={20} />
                  </div>
                  <button className="button full" onClick={() => navigate('reports')}>
                    打开 Excel 导出
                    <ChevronRight size={16} />
                  </button>
                  <p className="muted paragraph">
                    需要完整原始记录时，可保留一份 JSON 备份。附件文件需在客户档案中单独下载。
                  </p>
                  <button className="button full" disabled={role !== '店主'} onClick={exportData}>
                    下载 JSON 备份
                  </button>
                  <div className="notice">
                    <ShieldCheck size={20} />
                    <p>
                      {identity.demo
                        ? '演示环境仅用于虚构数据体验。'
                        : `当前账户：${identity.name}（${identity.email}）。请定期备份数据库及报告附件。`}
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </main>
      {accountAnchor && (
        <AccountMenu
          anchor={accountAnchor}
          identity={identity}
          api={api}
          switchStore={switchStore}
          close={() => setAccountAnchor(null)}
          manage={() => navigate('accounts')}
          logout={async () => {
            if (!canLeaveEditor()) return;
            setAccountAnchor(null);
            try {
              const result = await api('/logout', 'POST');
              if (result.logoutUrl) window.location.assign(result.logoutUrl);
              else {
                setRole('');
                setSelected(null);
                setEditorKind('');
                setEditingField('');
                accountDirty.current = false;
              }
            } catch (reason) {
              setError((reason as Error).message);
            }
          }}
        />
      )}
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
            style={searchPosition}
            role="dialog"
            aria-modal="false"
            aria-label="搜索客户信息"
          >
            <div className="global-search-input">
              <Search size={21} />
              <input
                autoFocus
                aria-label="搜索客户信息"
                placeholder="搜索姓名、电话、检查、设备、维修或随访..."
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
    </div>
  );
}
function Stat({
  onClick,
  label,
  value,
  unit,
  detail,
  icon,
  warning = false,
}: {
  onClick?: () => void;
  label: string;
  value: number;
  unit: string;
  detail: string;
  icon: ReactNode;
  warning?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={'stat ' + (warning ? 'warning' : '')}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{detail}</p>
    </button>
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
      {subtitle && <p className="muted">{subtitle}</p>}
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
