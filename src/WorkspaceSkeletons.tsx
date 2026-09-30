import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileText,
  Headphones,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { HearingEditor } from './HearingEditor';
import { blankCurve as emptyCurve } from '../shared/hearing';
import { customerTabs } from './workspace';

const line = (className = '') => <span className={'skeleton-line ' + className} />;
const action = (text: string, primary = false) => (
  <button type="button" className={'button ' + (primary ? 'primary' : '')} disabled>
    <Plus size={16} />
    {text}
  </button>
);
const emptyExam = {
  date: '',
  right: emptyCurve(),
  left: emptyCurve(),
  boneRight: emptyCurve(),
  boneLeft: emptyCurve(),
  speech: '',
  other: '',
  conclusion: '',
};

function InfoSkeleton({ labels, editable = false }: { labels: string[]; editable?: boolean }) {
  return (
    <dl className="info-grid">
      {labels.map((label) => (
        <div className={editable ? 'inline-profile-field' : undefined} key={label}>
          <dt>
            {label}
            {editable && label !== '建档日期' && (
              <button className="inline-edit-icon" disabled aria-label={'编辑' + label}>
                <Pencil size={13} />
              </button>
            )}
          </dt>
          <dd>{line('skeleton-field-value')}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RecentCustomersSkeleton() {
  return (
    <div role="status" aria-label="正在读取最近建档">
      {Array.from({ length: 3 }, (_, i) => (
        <button className="recent-customer-placeholder" key={i} disabled>
          <Clock3 size={16} />
          {line('skeleton-person-name')}
          <small>{line('skeleton-table-status')}</small>
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}

export function RemovedCustomersSkeleton() {
  return (
    <div className="removed-customer-list" role="status" aria-label="正在读取已删除档案">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i}>
          <span>
            <strong>{line('skeleton-person-name')}</strong>
            <small>{line('skeleton-record-description')}</small>
          </span>
          <button className="button small" disabled>
            <RotateCcw size={14} />
            恢复档案
          </button>
        </div>
      ))}
    </div>
  );
}

export function TaskListSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="task-list" role="status" aria-label="正在读取随访任务">
      {Array.from({ length: lines }, (_, i) => (
        <div className="task-record" key={i}>
          <div className="task-row">
            <div className="task-icon">
              <CalendarDays size={18} />
            </div>
            <div className="task-body">
              <span className="skeleton-line skeleton-task-name" />
              <span className="task-type skeleton-line skeleton-task-type" />
              <span className="task-description">
                {line('skeleton-task-description')}
                <Pencil size={13} />
              </span>
              <small>{line('skeleton-task-date')}</small>
            </div>
            <div className="task-actions">
              <button className="button small" disabled>
                记录结果
              </button>
              <button className="icon-action" disabled aria-label="编辑随访">
                <Pencil size={15} />
              </button>
              <button className="icon-action" disabled aria-label="删除随访">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function JourneySkeleton() {
  return (
    <div className="journey-bars" role="status" aria-label="正在读取服务阶段">
      {['待评估', '试戴中', '已验配', '长期随访'].map((label, i) => (
        <button key={label} disabled>
          <span>
            <i style={{ background: ['#b8bdc5', '#7a9cca', '#5285c0', '#215eab'][i] }} />
            {label}
          </span>
          <strong>{line('skeleton-count')}</strong>
          <div className="bar-track">{line('skeleton-bar')}</div>
        </button>
      ))}
    </div>
  );
}

export function CustomerDetailSkeleton({ tab }: { tab: string }) {
  if (tab === '概览')
    return (
      <div className="detail-grid" role="status" aria-label="正在读取客户档案">
        <div>
          <section className="panel padded">
            <div className="section-title">
              <h2>基本资料</h2>
              <FileText size={18} />
            </div>
            <InfoSkeleton
              editable
              labels={[
                '客户姓名',
                '性别',
                '出生日期',
                '客户电话',
                '客户来源',
                '服务阶段',
                '其他联系人',
                '其他联系人电话',
                '住址',
                '建档日期',
              ]}
            />
            {['听力与健康情况', '聆听需求与期望'].map((label) => (
              <dl className="note-block" key={label}>
                <div className="inline-profile-field">
                  <dt>
                    {label}
                    <button className="inline-edit-icon" disabled>
                      <Pencil size={13} />
                    </button>
                  </dt>
                  <dd>{line('skeleton-record-description')}</dd>
                </div>
              </dl>
            ))}
          </section>
          <section className="panel padded space-top">
            <div className="section-title">
              <h2>最近听力检查</h2>
              <button className="text-link" disabled>
                完整检查
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="chart-summary">
              <span>检查日期 {line('skeleton-task-date')}</span>
              <div>
                <span className="ear-right">○ 右耳</span>
                <span className="ear-left">× 左耳</span>
              </div>
            </div>
            <div className="audiogram skeleton-surface skeleton-audiogram" />
          </section>
        </div>
        <div>
          <section className="panel padded">
            <div className="section-title">
              <h2>验配设备</h2>
              <Headphones size={18} />
            </div>
            {Array.from({ length: 2 }, (_, i) => (
              <button className="device-summary-link" disabled key={i}>
                <Headphones size={18} />
                <span>
                  <strong>{line('skeleton-task-name')}</strong>
                  <small>{line('skeleton-task-date')}</small>
                  <small>{line('skeleton-record-description')}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>
          <section className="panel padded space-top">
            <h2>档案动态</h2>
            <div className="timeline">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i}>
                  <i />
                  <strong>{line('skeleton-task-name')}</strong>
                  <p>{line('skeleton-record-description')}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  if (tab === '听力检查')
    return (
      <section className="panel padded hearing-panel" role="status" aria-label="正在读取听力检查">
        <div className="section-title">
          <div>
            <h2>听力检查</h2>
          </div>
          {action('新增检查')}
        </div>
        <div className="exam-toolbar">
          <span className="skeleton-control skeleton-line" />
          <label className="check-label">
            <input type="checkbox" disabled />
            叠加前次检查
          </label>
          <button className="button small" disabled>
            打印 / PDF
          </button>
          <button className="button small danger-button" disabled>
            删除本次检查
          </button>
        </div>
        <HearingEditor value={emptyExam} loading />
      </section>
    );
  if (tab === '随访记录')
    return (
      <section className="panel" role="status" aria-label="正在读取随访记录">
        <div className="panel-heading">
          <div>
            <h2>随访与服务记录</h2>
          </div>
          {action('安排随访', true)}
        </div>
        <TaskListSkeleton lines={3} />
      </section>
    );
  if (tab === '报告附件')
    return (
      <section className="panel padded" role="status" aria-label="正在读取报告附件">
        <div className="section-title">
          <div>
            <h2>原始报告与附件</h2>
            <p className="muted">支持 PDF、JPG、PNG，单个文件不超过 10 MB。</p>
          </div>
          <button className="button primary upload-button" disabled>
            <Upload size={16} />
            上传报告
          </button>
        </div>
        <div className="attachment-list">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="attachment-item" key={i}>
              <div className="attachment">
                <FileText size={24} />
                <div>
                  <strong>{line('skeleton-task-name')}</strong>
                  <small>{line('skeleton-record-description')}</small>
                </div>
                <ArrowDownToLine size={18} />
              </div>
              <button className="button small danger-button" disabled>
                <Trash2 size={14} />
                删除
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  const repair = tab === '维修记录';
  return (
    <section className="panel padded" role="status" aria-label={`正在读取${tab}`}>
      <div className="section-title">
        <h2>{repair ? '助听器维修记录' : '历次验配与调试'}</h2>
        {action(repair ? '登记维修' : '新增验配记录', true)}
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <article className="record-card" key={i}>
          <div className="record-heading">
            <div>
              <span className="eyebrow">{line('skeleton-record-description')}</span>
              <h3>{line('skeleton-record-title')}</h3>
              {repair && <p className="muted">{line('skeleton-record-description')}</p>}
            </div>
            <div className="record-actions">
              {!repair && <Headphones size={25} />}
              <button className="button small" disabled>
                <Pencil size={14} />
                编辑
              </button>
              {!repair && (
                <button className="button small" disabled>
                  登记维修
                </button>
              )}
              <button className="button small danger-button" disabled>
                删除
              </button>
            </div>
          </div>
          <InfoSkeleton
            labels={
              repair
                ? ['接收日期', '完工日期', '维修费用', '保修处理']
                : ['设备序列号', '成交金额', '保修截止日期']
            }
          />
          <p className="record-note">
            {repair && <strong>故障：</strong>}
            {line('skeleton-record-description')}
          </p>
          {!repair && (
            <div className="record-relations">
              <button className="relation-link" disabled>
                <Wrench size={15} />
                维修记录{line('skeleton-count')}
                <ArrowRight size={14} />
              </button>
              <button className="relation-link" disabled>
                <CalendarDays size={15} />
                安排随访
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

export function CustomerPageSkeleton({
  tab,
  returnLabel = '客户档案',
}: {
  tab: string;
  returnLabel?: string;
}) {
  return (
    <>
      <button className="back" disabled>
        <ArrowLeft size={16} />
        返回{returnLabel}
      </button>
      <section
        className="customer-hero customer-hero-skeleton"
        role="status"
        aria-label="正在读取客户"
      >
        <div className="person">
          <span className="skeleton-mark avatar large-avatar" />
          <div>
            <div className="customer-title">
              <h1>{line('skeleton-customer-name')}</h1>
              {line('skeleton-table-status')}
            </div>
            <p>{line('skeleton-customer-meta')}</p>
            <small>档案编号 {line('skeleton-task-date')}</small>
          </div>
        </div>
        <div className="button-row">
          <button className="button" disabled>
            编辑档案
          </button>
          <button className="button danger-button" disabled>
            <Trash2 size={16} />
            删除档案
          </button>
          {action('安排随访', true)}
        </div>
      </section>
      <div className="detail-tabs">
        {customerTabs.map((item) => (
          <button key={item} disabled className={tab === item ? 'active' : ''}>
            {item}
            {item !== '概览' && <span className="skeleton-line skeleton-tab-count" />}
          </button>
        ))}
      </div>
      <CustomerDetailSkeleton tab={tab} />
    </>
  );
}
