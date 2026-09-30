import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  House,
  ContactRound,
  ChartNoAxesCombined,
  Wrench,
  Menu,
  LogOut,
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
import { blankCurve } from '../shared/hearing';
import { today, age, money, daysUntil, localTime, restoreDeadline } from './format';
import { statuses, Badge, Empty, LoadingRows, Stat, Distribution } from './ui';
import { Audiogram } from './Audiogram';
import { IntakePage } from './IntakePage';
import { HearingEditor } from './HearingEditor';
import { RequestOrder } from './requestOrder';
import { RecordEditor } from './RecordEditor';
import { Accounts, AccountsSkeleton, AccountMenu } from './Accounts';
import { AccountAvatar } from './AccountAvatar';
import { ServiceDirectory } from './ServiceDirectory';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import { customerTabs, deviceName, deviceSerial } from './workspace';
import { api } from './api';
import {
  CustomerDetailSkeleton,
  CustomerPageSkeleton,
  JourneySkeleton,
  RecentCustomersSkeleton,
  RemovedCustomersSkeleton,
  TaskListSkeleton,
} from './WorkspaceSkeletons';

import type { Customer, Exam, Follow, Detail } from './types';
type Dataset = 'customers' | 'followups' | 'devices' | 'repairs' | 'removed';
type LoadState = 'loading' | 'ready' | 'error';
const initialDataState: Record<Dataset, LoadState> = {
  customers: 'loading',
  followups: 'loading',
  devices: 'loading',
  repairs: 'loading',
  removed: 'loading',
};
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
    [detailError, setDetailError] = useState(false),
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
    [searchMounted, setSearchMounted] = useState(false),
    [searchMode, setSearchMode] = useState<'inline' | 'command'>('inline'),
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
    [dataState, setDataState] = useState<Record<Dataset, LoadState>>(initialDataState),
    [identity, setIdentity] = useState({
      demo: false,
      name: '',
      email: '',
      storeName: '聆讯听力',
      tenant_id: '',
      avatar: '',
    });

  const intakeDirty = useRef(false);
  const accountDirty = useRef(false);
  const accountBusy = useRef(false);
  const dataSession = useRef(0);
  const requestOrder = useRef(new RequestOrder());
  const draftSnapshot = useRef('');
  const { route, update: updateRoute } = useWorkspaceRoute(() => {
    if (!canLeaveEditor()) return false;
    setEditorKind('');
    setEditingField('');
    setSearchOpen(false);
    return true;
  });
  const { page, customer: selected, tab, record: focusedRecord, device: repairDevice } = route;
  const selectedCustomerRef = useRef(selected);
  selectedCustomerRef.current = selected;
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
    const inline = trigger.classList.contains('home-search') && !mobile;
    setSearchMode(inline ? 'inline' : 'command');
    const width = inline
      ? Math.min(rect.width, viewportWidth - 24)
      : Math.min(720, viewportWidth - 24);
    const left = inline
      ? Math.max(12, Math.min(rect.left, viewportWidth - width - 12))
      : (viewportWidth - width) / 2;
    const top = inline ? Math.max(12, rect.top) : Math.min(76, Math.max(12, viewportHeight * 0.08));
    setSearchPosition({
      top,
      left,
      width,
      maxHeight: Math.max(155, Math.min(620, viewportHeight - top - 16)),
    });
  }
  function openSearch(trigger: HTMLButtonElement) {
    searchTriggerRef.current = trigger;
    positionSearch(trigger);
    setSearchMounted(true);
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
    const session = dataSession.current;
    const keys: Dataset[] = ['customers', 'followups', 'devices', 'repairs', 'removed'];
    const guards = Object.fromEntries(keys.map((key) => [key, requestOrder.current.begin(key)]));
    const [a, b, warrantyRows, removedRows, repairRows] = await Promise.all([
      api('/customers'),
      api('/followups'),
      api('/devices'),
      includeRemoved ? api('/customers/removed') : Promise.resolve([]),
      api('/repairs'),
    ]).catch((error) => {
      if (session === dataSession.current)
        setDataState((current) => {
          const next = { ...current };
          for (const key of keys) if (guards[key]()) next[key] = 'error';
          return next;
        });
      throw error;
    });
    if (session !== dataSession.current) return;
    if (guards.customers()) setCustomers(a);
    if (guards.followups()) setFollowups(b);
    if (guards.devices()) setDevices(warrantyRows);
    if (guards.repairs()) setRepairs(repairRows);
    if (guards.removed()) setRemovedCustomers(removedRows);
    setDataState((current) => {
      const next = { ...current };
      for (const key of keys) if (guards[key]()) next[key] = 'ready';
      return next;
    });
  }
  function loadDataset(key: Dataset, session = dataSession.current) {
    const isLatest = requestOrder.current.begin(key);
    const paths: Record<Dataset, string> = {
      customers: '/customers',
      followups: '/followups',
      devices: '/devices',
      repairs: '/repairs',
      removed: '/customers/removed',
    };
    setDataState((current) => ({ ...current, [key]: 'loading' }));
    api(paths[key])
      .then((rows) => {
        if (session !== dataSession.current || !isLatest()) return;
        if (key === 'customers') setCustomers(rows);
        if (key === 'followups') setFollowups(rows);
        if (key === 'devices') setDevices(rows);
        if (key === 'repairs') setRepairs(rows);
        if (key === 'removed') setRemovedCustomers(rows);
        setDataState((current) => ({ ...current, [key]: 'ready' }));
      })
      .catch(() => {
        if (session === dataSession.current && isLatest())
          setDataState((current) => ({ ...current, [key]: 'error' }));
      });
  }
  function loadInitialData() {
    const session = ++dataSession.current;
    setDataState(initialDataState);
    (['customers', 'followups', 'devices', 'repairs', 'removed'] as Dataset[]).forEach((key) =>
      loadDataset(key, session),
    );
  }
  function dataFallback(keys: Dataset[], lines = 3, placeholder?: ReactNode) {
    const failed = keys.filter((key) => dataState[key] === 'error');
    if (failed.length)
      return (
        <div className="data-retry" role="alert">
          <span>这部分内容暂时无法读取</span>
          <button
            type="button"
            className="button small"
            onClick={() => failed.forEach((key) => loadDataset(key))}
          >
            重试
          </button>
        </div>
      );
    return placeholder ?? <LoadingRows lines={lines} />;
  }
  const dataReady = (...keys: Dataset[]) => keys.every((key) => dataState[key] === 'ready');
  async function loadDetail(key: string) {
    const session = dataSession.current;
    setDetailError(false);
    try {
      const data = await api(`/customers/${key}/detail`);
      if (selectedCustomerRef.current === key && session === dataSession.current) setDetail(data);
    } catch (e) {
      if (selectedCustomerRef.current === key && session === dataSession.current) {
        setDetailError(true);
        setError((e as Error).message);
      }
    }
    api(`/customers/${key}/removed`)
      .then((rows) => {
        if (selectedCustomerRef.current === key && session === dataSession.current)
          setRemoved(rows);
      })
      .catch(() => {});
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [configResult, identityResult] = await Promise.allSettled([api('/config'), api('/me')]);
      if (cancelled) return;
      const demo = configResult.status === 'fulfilled' && configResult.value.demo;
      setIdentity((previous) => ({ ...previous, demo }));
      if (identityResult.status === 'fulfilled') {
        const r = identityResult.value;
        setIdentity(r);
        setRole(r.role);
        if (r.tenant_id) loadInitialData();
      } else if (!demo) {
        setError((identityResult.reason as Error).message);
      }
    })()
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBoot(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!role || !identity.tenant_id) return;
    const mark = () => {
      if (document.visibilityState === 'visible') api('/accounts/presence', 'POST').catch(() => {});
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
      setDetailError(false);
      setRemoved({ exams: [], fittings: [], repairs: [], followups: [], attachments: [] });
      api(`/customers/${selected}/detail`)
        .then((data) => {
          if (!cancelled) setDetail(data);
        })
        .catch((e) => {
          if (!cancelled) {
            setDetailError(true);
            setError(e.message);
          }
        });
      api(`/customers/${selected}/removed`)
        .then((rows) => {
          if (!cancelled) setRemoved(rows);
        })
        .catch(() => {});
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
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
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
  }, [role, page, searchOpen]);
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
    if (searchOpen || !searchMounted) return;
    const timer = window.setTimeout(
      () => {
        setSearchMounted(false);
        searchTriggerRef.current?.focus({ preventScroll: true });
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
    );
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchMounted]);
  useEffect(() => {
    if (!searchOpen || searchMode !== 'command') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [searchOpen, searchMode]);
  useEffect(() => {
    if (!searchOpen) return;
    document
      .querySelector('.global-search-list > button.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [searchActive, searchOpen, globalResults]);
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
      if (storeId) await api('/accounts/stores/' + encodeURIComponent(storeId) + '/switch', 'POST');
      accountDirty.current = false;
      window.history.replaceState(null, '', storeId ? '/#page=overview' : '/#page=accounts');
      window.location.reload();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function logoutAccount() {
    if (!canLeaveEditor()) return;
    setAccountAnchor(null);
    try {
      const result = await api('/logout', 'POST');
      if (result.logoutUrl) window.location.assign(result.logoutUrl);
      else {
        dataSession.current += 1;
        setCustomers([]);
        setFollowups([]);
        setDevices([]);
        setRepairs([]);
        setRemovedCustomers([]);
        setDetail(null);
        setDataState(initialDataState);
        setRole('');
        setSelected(null);
        setEditorKind('');
        setEditingField('');
        accountDirty.current = false;
      }
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
      const curve = blankCurve;
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
      a.download = `聆讯-客户档案-${today()}.json`;
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
      link.download = `聆讯-${kind === 'core' ? '客户核心信息' : '客户业务数据'}-${today()}.xlsx`;
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
  if (!role && !boot)
    return (
      <div className="cf-login">
        <header className="cf-login-header">
          <div className="brand">
            <span className="brand-icon">
              <Ear size={23} />
            </span>
            <div>
              <b>聆讯</b>
              <small>HEARING CARE</small>
            </div>
          </div>
        </header>
        <main className="cf-login-main">
          <div className="cf-login-intro">
            <h1>进入聆讯工作台</h1>
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
                  const me = await api('/me');
                  setIdentity(me);
                  setRole('店主');
                  if (me.tenant_id) loadInitialData();
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
        <footer className="cf-login-footer">聆讯 · 助听器客户管理</footer>
      </div>
    );
  if (role && !boot && !identity.tenant_id)
    return (
      <div className="account-only-shell cf-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-icon">
              <Ear size={23} />
            </span>
            <b>聆讯</b>
          </div>
          <div className="top-actions">
            <AccountAvatar avatar={identity.avatar} name={identity.name} />
            <button className="button small" onClick={() => void logoutAccount()}>
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </header>
        <main className="account-only-content">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
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
        </main>
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
  const customerTable = (list: Customer[], compact = false, loading = false) => (
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
          {loading
            ? Array.from({ length: compact ? 4 : 5 }, (_, index) => (
                <tr className="customer-skeleton-row" key={index}>
                  <td>
                    <div className="person">
                      <span className="skeleton-mark avatar" />
                      <div className="skeleton-person">
                        <span className="skeleton-line" />
                        <span className="skeleton-line" />
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="skeleton-line skeleton-table-main" />
                    <span className="skeleton-line skeleton-table-sub" />
                  </td>
                  <td>
                    <span className="skeleton-line skeleton-table-status" />
                  </td>
                  <td>
                    <span className="skeleton-line skeleton-table-main" />
                  </td>
                  {!compact && (
                    <td>
                      <span className="skeleton-line skeleton-table-main" />
                    </td>
                  )}
                  <td>
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))
            : list.map((c) => (
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
                          {Number.isFinite(age(c.birthDate))
                            ? `${age(c.birthDate)} 岁`
                            : '年龄未填写'}
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
      {!loading && !list.length && <Empty text="没有找到符合条件的客户" />}
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
      aria-busy={boot}
      inert={boot}
      className={
        'app-shell cf-shell' +
        (boot ? ' booting' : '') +
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
              <b>聆讯</b>
              {boot ? (
                <small className="skeleton-line boot-store-name" />
              ) : (
                <small>{identity.storeName}</small>
              )}
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
              .filter(([key]) => key !== 'recycle' || role === '店主' || boot)
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
              <AccountAvatar
                className="profile-avatar"
                avatar={boot ? '' : identity.avatar}
                name={boot ? '' : identity.name || role}
              />
              <div>
                <strong>
                  {boot ? (
                    <span className="skeleton-line boot-profile-name" />
                  ) : (
                    identity.name || role
                  )}
                </strong>
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
            <button onClick={() => navigate('overview')}>聆讯</button> <ChevronRight size={14} />{' '}
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
              <AccountAvatar
                className="top-avatar-content"
                avatar={boot ? '' : identity.avatar}
                name={boot ? '' : identity.name || role}
              />
            </button>
          </div>
        </header>
        <div className="content">
          {Object.values(dataState).includes('error') && (
            <div className="data-load-alert" role="alert">
              <span>部分数据暂时无法读取</span>
              <button
                className="button small"
                onClick={() =>
                  (Object.keys(dataState) as Dataset[])
                    .filter((key) => dataState[key] === 'error')
                    .forEach((key) => loadDataset(key))
                }
              >
                重试加载
              </button>
            </div>
          )}
          {error && !editorKind && (
            <div className="error dismiss">
              {error}
              <button onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === 'accounts' &&
            (boot ? (
              <AccountsSkeleton />
            ) : (
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
            ))}
          {page === 'recycle' && (
            <>
              <div className="page-heading">
                <h1>回收站</h1>
              </div>{' '}
              {(role === '店主' || boot) && (
                <section className="panel padded space-top">
                  <div className="section-title">
                    <h2>已删除档案</h2>
                  </div>
                  <p className="muted retention-note">
                    删除后保留 30 天；到期自动彻底清除，之后无法恢复。
                  </p>
                  {!dataReady('removed') ? (
                    dataFallback(['removed'], 3, <RemovedCustomersSkeleton />)
                  ) : removedCustomers.length ? (
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
              canEdit={role === '店主' || boot}
              loading={!dataReady(page === 'repairs' ? 'repairs' : 'devices')}
              loadError={
                dataState[page === 'repairs' ? 'repairs' : 'devices'] === 'error'
                  ? dataFallback([page === 'repairs' ? 'repairs' : 'devices'])
                  : undefined
              }
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
              role={boot ? '店主' : role}
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
                      timeZone: 'Asia/Shanghai',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })}{' '}
                    <span className="dot-sep">·</span> 今日有{' '}
                    {dataReady('followups') ? (
                      todayTasks.length
                    ) : (
                      <span className="skeleton-line skeleton-inline-count" />
                    )}{' '}
                    项服务待跟进
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
                  {dataReady('customers')
                    ? customers.slice(0, 3).map((recent) => (
                        <button key={recent.id} onClick={() => openCustomer(recent.id)}>
                          <Clock3 size={16} />
                          {recent.name}
                          <small>{recent.status}</small>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    : dataFallback(['customers'], 3, <RecentCustomersSkeleton />)}
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
                  loading={!dataReady('customers')}
                />
                <Stat
                  onClick={() => navigate('devices')}
                  label="已验配客户"
                  value={fitted.length}
                  unit="位"
                  detail=""
                  icon={<Headphones />}
                  loading={!dataReady('customers')}
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
                  loading={!dataReady('followups')}
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
                  loading={!dataReady('followups')}
                />
              </div>
              <div className="dashboard-columns">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        服务待办{' '}
                        {dataReady('followups') && <span className="count">{pending.length}</span>}
                      </h2>
                    </div>
                    <button className="text-link muted" onClick={() => navigate('followups')}>
                      查看全部 <ArrowRight size={15} />
                    </button>
                  </div>
                  {dataReady('followups') ? (
                    taskRows([...pending].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4))
                  ) : dataState.followups === 'error' ? (
                    dataFallback(['followups'])
                  ) : (
                    <TaskListSkeleton />
                  )}
                </section>
                <div className="dashboard-side">
                  <section className="panel journey-panel">
                    <h2>服务阶段</h2>
                    {dataReady('customers') ? (
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
                    ) : dataState.customers === 'error' ? (
                      dataFallback(['customers'])
                    ) : (
                      <JourneySkeleton />
                    )}
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
                {dataReady('customers')
                  ? customerTable(customers.slice(0, 4), true)
                  : dataState.customers === 'error'
                    ? dataFallback(['customers'])
                    : customerTable([], true, true)}
              </section>
            </>
          )}
          {page === 'customers' && !selected && (
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
                          {!dataReady('customers')
                            ? '…'
                            : s === '全部客户'
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
                {dataReady('customers')
                  ? customerTable(filtered)
                  : dataState.customers === 'error'
                    ? dataFallback(['customers'])
                    : customerTable([], false, true)}
                <div className="table-footer">
                  {dataReady('customers') ? (
                    `共 ${filtered.length} 位客户`
                  ) : (
                    <span className="skeleton-line skeleton-task-date" />
                  )}{' '}
                  <span>点击客户查看完整服务档案</span>
                </div>
              </section>
            </>
          )}
          {page === 'customers' &&
            selected &&
            !customer &&
            (dataReady('customers') ? (
              <>
                <div className="page-heading">
                  <h1>客户档案</h1>
                </div>
                <section className="panel">
                  <Empty
                    text="没有找到这位客户"
                    action={
                      <button className="button" onClick={() => navigate('customers')}>
                        返回客户列表
                      </button>
                    }
                  />
                </section>
              </>
            ) : dataState.customers === 'error' ? (
              dataFallback(['customers'])
            ) : (
              <CustomerPageSkeleton
                tab={tab}
                returnLabel={navs.find((n) => n[0] === originPage)?.[1]}
              />
            ))}
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
                    {t !== '概览' && (
                      <span>
                        {detail ? (
                          (
                            {
                              听力检查: detail.exams.length,
                              验配记录: detail.fittings.length,
                              维修记录: detail.repairs.length,
                              随访记录: detail.followups.length,
                              报告附件: detail.attachments.length,
                            } as Record<string, number>
                          )[t]
                        ) : (
                          <span className="skeleton-line skeleton-tab-count" />
                        )}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {!detail ? (
                detailError ? (
                  <div className="data-retry" role="alert">
                    <span>档案详情暂时无法读取</span>
                    <button className="button small" onClick={() => void loadDetail(customer.id)}>
                      重试
                    </button>
                  </div>
                ) : (
                  <CustomerDetailSkeleton tab={tab} />
                )
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
                              <a
                                href={
                                  '/api/files/' +
                                  a.id +
                                  '?store=' +
                                  encodeURIComponent(identity.tenant_id)
                                }
                                className="attachment"
                              >
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
                  loading={!dataReady('followups')}
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
                  loading={!dataReady('followups')}
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
                  loading={!dataReady('followups')}
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
                {dataReady('followups') ? (
                  taskRows(
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
                  )
                ) : dataState.followups === 'error' ? (
                  dataFallback(['followups'])
                ) : (
                  <TaskListSkeleton lines={5} />
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
                  loading={!dataReady('customers')}
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
                  loading={!dataReady('customers')}
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
                  loading={!dataReady('followups')}
                />
                <Stat
                  onClick={() => navigate('warranties')}
                  label="保修需关注"
                  value={warrantyAlerts.length}
                  unit="项"
                  detail="已过期或 90 天内到期"
                  icon={<Bell />}
                  warning
                  loading={!dataReady('devices')}
                />
              </div>
              <button className="section-shortcut panel" onClick={() => navigate('warranties')}>
                <Shield size={19} />
                <span>查看保修到期设备</span>
                {dataReady('devices') ? (
                  <span className="count">{warrantyAlerts.length}</span>
                ) : (
                  <span className="skeleton-line skeleton-count" />
                )}
                <ArrowRight size={17} />
              </button>
              <div className="report-grid">
                {
                  <Distribution
                    title="客户来源"
                    subtitle=""
                    loading={!dataReady('customers')}
                    loadError={
                      dataState.customers === 'error' ? dataFallback(['customers']) : undefined
                    }
                    data={[...new Set(customers.map((c) => c.source))].map((s) => ({
                      label: s || '未填写',
                      count: customers.filter((c) => c.source === s).length,
                    }))}
                  />
                }
                {
                  <Distribution
                    title="客户年龄分布"
                    subtitle="按当前日期与出生日期计算"
                    loading={!dataReady('customers')}
                    loadError={
                      dataState.customers === 'error' ? dataFallback(['customers']) : undefined
                    }
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
                }
                {
                  <Distribution
                    title="服务阶段"
                    subtitle="每位客户只计入当前阶段"
                    loading={!dataReady('customers')}
                    loadError={
                      dataState.customers === 'error' ? dataFallback(['customers']) : undefined
                    }
                    data={statuses.slice(1).map((s) => ({
                      label: s,
                      count: customers.filter((c) => c.status === s).length,
                    }))}
                  />
                }
                {
                  <Distribution
                    title="随访服务类型"
                    subtitle="包含待完成与已完成任务"
                    loading={!dataReady('followups')}
                    loadError={
                      dataState.followups === 'error' ? dataFallback(['followups']) : undefined
                    }
                    data={['适应回访', '听力复查', '清洁保养', '维修跟进', '到店预约'].map((s) => ({
                      label: s,
                      count: followups.filter((f) => f.type === s).length,
                    }))}
                  />
                }
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
                  <h2>
                    {boot ? (
                      <span className="skeleton-line account-skeleton-title" />
                    ) : (
                      identity.storeName
                    )}
                  </h2>
                  <dl className="stacked-info">
                    <div>
                      <dt>当前角色</dt>
                      <dd>
                        {boot ? <span className="skeleton-line account-skeleton-title" /> : role}
                      </dd>
                    </div>
                    <div>
                      <dt>数据空间</dt>
                      <dd>
                        {boot ? (
                          <span className="skeleton-line account-skeleton-title" />
                        ) : (
                          identity.storeName
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>
                        {boot ? (
                          <span className="skeleton-line account-skeleton-action" />
                        ) : identity.demo ? (
                          '本地演示'
                        ) : (
                          '1.0'
                        )}
                      </dd>
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
                      {boot ? (
                        <span className="skeleton-line account-skeleton-subtitle" />
                      ) : identity.demo ? (
                        '演示环境仅用于虚构数据体验。'
                      ) : (
                        `当前账户：${identity.name}（${identity.email}）。请定期备份数据库及报告附件。`
                      )}
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
          logout={logoutAccount}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      {searchMounted && (
        <div
          className={
            'global-search-backdrop search-' + searchMode + (!searchOpen ? ' search-closing' : '')
          }
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <section
            className="global-search-panel"
            style={searchPosition}
            role="dialog"
            aria-modal={searchMode === 'command'}
            aria-label="搜索客户信息"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const nodes = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'),
              );
              const first = nodes[0],
                last = nodes[nodes.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="global-search-input">
              <Search size={21} />
              <input
                autoFocus
                aria-label="搜索客户信息"
                placeholder="搜索客户、电话、型号或服务记录…"
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
                {searchMode === 'inline' ? (
                  <>
                    <kbd>Ctrl</kbd>
                    <kbd>K</kbd>
                  </>
                ) : (
                  <kbd>Esc</kbd>
                )}
              </button>
            </div>
            <div className="global-search-results">
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
                {(globalQuery.trim() ? globalResults : customers.slice(0, 6)).map(
                  (entry, index) => (
                    <button
                      className={searchActive === index ? 'active' : ''}
                      key={entry.id}
                      onMouseEnter={() => setSearchActive(index)}
                      onClick={() => openCustomer(entry.id)}
                    >
                      <ContactRound className="search-result-icon" size={19} strokeWidth={1.5} />
                      <span className="search-result-content">
                        <strong>{entry.name}</strong>
                        <small>
                          <span aria-hidden="true">—</span> {entry.phone || entry.status}
                        </small>
                      </span>
                      <span className="search-result-meta">
                        <ArrowRight size={18} />
                      </span>
                    </button>
                  ),
                )}
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
                  <kbd>↵</kbd> 打开
                </span>
                <span>
                  <kbd>Esc</kbd> 关闭
                </span>
              </footer>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
