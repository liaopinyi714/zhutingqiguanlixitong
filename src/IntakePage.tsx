import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import { blankCurve } from '../shared/hearing';
import { today } from './format';
import { statuses } from './ui';
import { Field, FittingDeviceFields } from './Fields';
import { HearingEditor } from './HearingEditor';
import type { Exam } from './types';

export function IntakePage({
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
