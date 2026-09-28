import { useEffect, useRef, type FormEvent } from 'react';
import { Pencil, X } from 'lucide-react';
import { Field, FittingDeviceFields } from './Fields';
import { deviceSerial } from './workspace';
import type { Customer, Detail } from './types';
const today = () => new Date().toLocaleDateString('sv-SE');
const statuses = ['全部客户', '待评估', '试戴中', '已验配', '长期随访'];
type Props = {
  kind: string;
  draft: any;
  customers: Customer[];
  detail: Detail | null;
  error: string;
  busy: boolean;
  change: (key: string, value: any) => void;
  submit: (e: FormEvent) => void;
  closeEditor: () => void;
};
export function RecordEditor({
  kind: editorKind,
  draft,
  customers,
  detail,
  error,
  busy,
  change,
  submit,
  closeEditor,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [editorKind, draft.id]);
  const title: Record<string, string> = {
    customer: '编辑客户资料',
    fitting: draft.id ? '编辑验配' : '新增验配',
    repair: draft.id ? '编辑维修' : '登记维修',
    followup: draft.id ? '编辑随访' : '安排随访',
    complete: '记录随访结果',
  };
  return (
    <section ref={ref} className="record-editor" aria-label={title[editorKind]}>
      <header className="record-editor-heading">
        <h3>
          <Pencil size={16} />
          {title[editorKind]}
        </h3>
        <button
          className="icon-action"
          type="button"
          aria-label="取消编辑"
          disabled={busy}
          onClick={closeEditor}
        >
          <X size={18} />
        </button>
      </header>
      <form onSubmit={submit}>
        <div className="record-editor-body">
          {error && <div className="error">{error}</div>}
          {editorKind === 'customer' &&
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
          {editorKind === 'customer' && (
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
              <Field label="出生日期">
                <input
                  type="date"
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
                  placeholder="填写客户相关信息"
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
          {editorKind === 'fitting' && (
            <div className="form-grid">
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
              <FittingDeviceFields value={draft} onChange={change} />
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
                  value={draft.notes}
                  onChange={(e) => change('notes', e.target.value)}
                  placeholder="记录调试原因、参数变化、真耳验证、客户反馈及使用指导。"
                />
              </Field>
            </div>
          )}
          {editorKind === 'repair' && (
            <div className="form-grid">
              <Field label="关联验配设备 *" wide>
                <select
                  required
                  value={draft.fittingId}
                  onChange={(e) => change('fittingId', e.target.value)}
                >
                  {detail?.fittings.map((f) => (
                    <option key={f.id} value={f.id}>
                      {[f.brand, f.series, f.model, f.side, deviceSerial(f)]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="故障发生日期 *">
                <input
                  type="date"
                  required
                  value={draft.occurredDate}
                  onChange={(e) => change('occurredDate', e.target.value)}
                />
              </Field>
              <Field label="门店接收日期">
                <input
                  type="date"
                  value={draft.receivedDate}
                  onChange={(e) => change('receivedDate', e.target.value)}
                />
              </Field>
              <Field label="维修状态">
                <select value={draft.status} onChange={(e) => change('status', e.target.value)}>
                  {['待送修', '维修中', '已完成', '无法修复'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="完工日期">
                <input
                  type="date"
                  value={draft.completedDate}
                  onChange={(e) => change('completedDate', e.target.value)}
                />
              </Field>
              <Field label="故障现象 / 客户反馈" wide>
                <textarea
                  value={draft.problem}
                  onChange={(e) => change('problem', e.target.value)}
                />
              </Field>
              <Field label="检测结果" wide>
                <textarea
                  value={draft.findings}
                  onChange={(e) => change('findings', e.target.value)}
                />
              </Field>
              <Field label="维修过程与处理结果" wide>
                <textarea
                  value={draft.workDone}
                  onChange={(e) => change('workDone', e.target.value)}
                />
              </Field>
              <Field label="更换零件及数量" wide>
                <textarea
                  value={draft.parts}
                  onChange={(e) => change('parts', e.target.value)}
                  placeholder="例如：左耳受话器 1 件、耳塞 2 件"
                />
              </Field>
              <Field label="维修费用（元）">
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="0.01"
                  value={draft.price}
                  onChange={(e) => change('price', e.target.value)}
                />
              </Field>
              <Field label="保修处理">
                <select
                  value={draft.warrantyCovered ? '是' : '否'}
                  onChange={(e) => change('warrantyCovered', e.target.value === '是')}
                >
                  <option>否</option>
                  <option>是</option>
                </select>
              </Field>
              <Field label="备注" wide>
                <textarea value={draft.notes} onChange={(e) => change('notes', e.target.value)} />
              </Field>
            </div>
          )}
          {editorKind === 'followup' && (
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
          {editorKind === 'complete' && (
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
        <footer className="record-editor-footer">
          <button className="button" type="button" onClick={closeEditor} disabled={busy}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存记录'}
          </button>
        </footer>
      </form>
    </section>
  );
}
