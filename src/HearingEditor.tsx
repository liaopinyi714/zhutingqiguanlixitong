import { useState } from 'react';
import { frequencies, pta } from '../server/domain';

type Point = { frequency: number; value: number | null; masked: boolean; noResponse: boolean };
export type HearingExam = {
  id?: string;
  date: string;
  right: Point[];
  left: Point[];
  boneRight: Point[];
  boneLeft: Point[];
  uclRight?: Point[];
  uclLeft?: Point[];
  speech: string;
  other: string;
  conclusion: string;
};
type CurveKey = 'right' | 'left' | 'boneRight' | 'boneLeft' | 'uclRight' | 'uclLeft';
const editableFrequencies = [250, 500, 1000, 2000, 4000, 8000];
const blank = () =>
  frequencies.map((frequency) => ({ frequency, value: null, masked: false, noResponse: false }));
const x = (frequency: number) => 48 + Math.log2(frequency / 250) * 68;
const y = (value: number) => 28 + ((value + 10) * 360) / 130;

export function HearingEditor({
  value,
  onChange,
  previous,
  loading = false,
}: {
  value: HearingExam;
  onChange?: (next: HearingExam) => void;
  previous?: HearingExam;
  loading?: boolean;
}) {
  const [mode, setMode] = useState<'AC' | 'BC' | 'UCL'>('AC');
  const [erase, setErase] = useState(false);
  const [masked, setMasked] = useState(false);
  const [noResponse, setNoResponse] = useState(false);
  const [undo, setUndo] = useState<{ key: CurveKey; points: Point[] }[]>([]);
  const [cursor, setCursor] = useState({ index: 2, db: 40 });
  const [message, setMessage] = useState('');
  const keyFor = (left: boolean): CurveKey =>
    mode === 'AC'
      ? left
        ? 'left'
        : 'right'
      : mode === 'BC'
        ? left
          ? 'boneLeft'
          : 'boneRight'
        : left
          ? 'uclLeft'
          : 'uclRight';
  function plot(left: boolean, index: number, db: number, remove = erase) {
    if (!onChange) return;
    const key = keyFor(left),
      points = value[key] || blank();
    const frequency = editableFrequencies[index];
    setUndo((old) => [...old.slice(-49), { key, points }]);
    onChange({
      ...value,
      [key]: points.map((p) =>
        p.frequency === frequency
          ? {
              ...p,
              value: remove ? null : db,
              masked: !remove && mode !== 'UCL' && masked,
              noResponse: !remove && noResponse,
            }
          : p,
      ),
    });
    setCursor({ index, db });
    setMessage(
      `${left ? '左耳' : '右耳'} ${mode} · ${frequency} Hz · ${remove ? '已删除' : db + ' dB HL'}`,
    );
  }
  function graph(left: boolean) {
    const color = left ? '#397bb5' : '#c15f58';
    const keys: CurveKey[] = left
      ? ['left', 'boneLeft', 'uclLeft']
      : ['right', 'boneRight', 'uclRight'];
    const path = (points: Point[]) => {
      let connected = false;
      return points
        .filter((p) => p.frequency >= 250)
        .sort((a, b) => a.frequency - b.frequency)
        .map((p) => {
          if (p.noResponse) {
            connected = false;
            return '';
          }
          if (p.value === null) return '';
          const command = connected ? 'L' : 'M';
          connected = true;
          return `${command}${x(p.frequency)},${y(p.value)}`;
        })
        .join(' ');
    };
    return (
      <section className="hearing-ear">
        <header>
          <h3 style={{ color }}>{left ? '左耳' : '右耳'}</h3>
          <span>
            平均听阈{' '}
            {loading ? (
              <span className="skeleton-line skeleton-hearing-value" />
            ) : (
              (pta(value[left ? 'left' : 'right']) ?? '—')
            )}{' '}
            dB HL
          </span>
        </header>
        <svg
          viewBox="0 0 420 428"
          role={onChange ? 'application' : 'img'}
          tabIndex={onChange ? 0 : undefined}
          aria-label={`${left ? '左耳' : '右耳'}听力图。方向键移动，回车标记，Delete 删除。当前 ${editableFrequencies[cursor.index]} Hz，${cursor.db} dB HL`}
          onKeyDown={(event) => {
            if (!onChange) return;
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Enter',
                ' ',
                'Delete',
                'Backspace',
              ].includes(event.key)
            )
              event.preventDefault();
            if (event.key === 'ArrowLeft')
              setCursor((c) => ({ ...c, index: Math.max(0, c.index - 1) }));
            if (event.key === 'ArrowRight')
              setCursor((c) => ({ ...c, index: Math.min(5, c.index + 1) }));
            if (event.key === 'ArrowUp') setCursor((c) => ({ ...c, db: Math.max(-10, c.db - 5) }));
            if (event.key === 'ArrowDown')
              setCursor((c) => ({ ...c, db: Math.min(120, c.db + 5) }));
            if (event.key === 'Enter' || event.key === ' ') plot(left, cursor.index, cursor.db);
            if (event.key === 'Delete' || event.key === 'Backspace')
              plot(left, cursor.index, cursor.db, true);
          }}
          onClick={(event) => {
            if (!onChange) return;
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            if (p.x < 38 || p.x > 398 || p.y < 23 || p.y > 393) return;
            const index = Math.max(0, Math.min(5, Math.round((p.x - 48) / 68)));
            const db = Math.max(
              -10,
              Math.min(120, Math.round((((p.y - 28) * 130) / 360 - 10) / 5) * 5),
            );
            plot(left, index, db);
          }}
        >
          <rect x="48" y="28" width="340" height="360" fill="white" />
          {Array.from({ length: 14 }, (_, i) => i * 10 - 10).map((db) => (
            <g key={db}>
              <line x1="48" x2="388" y1={y(db)} y2={y(db)} stroke="#e3e3e3" />
              <text x="37" y={y(db) + 4} textAnchor="end">
                {db}
              </text>
            </g>
          ))}
          {editableFrequencies.map((f) => (
            <g key={f}>
              <line x1={x(f)} x2={x(f)} y1="28" y2="388" stroke="#dedede" />
              <text x={x(f)} y="410" textAnchor="middle">
                {f}
              </text>
            </g>
          ))}
          <text x="12" y="16">
            dB HL
          </text>
          <text x="395" y="424">
            Hz
          </text>
          {previous && (
            <path
              d={path(previous[left ? 'left' : 'right'])}
              stroke={color}
              opacity=".3"
              fill="none"
              strokeDasharray="5 5"
            />
          )}
          {keys.map((key, type) => (
            <g key={key} stroke={color} fill="white" strokeWidth="1.8">
              {type < 2 && (
                <path
                  d={path(value[key] || [])}
                  fill="none"
                  strokeDasharray={type === 1 ? '4 4' : undefined}
                />
              )}
              {(value[key] || [])
                .filter((p) => p.value !== null && p.frequency >= 250)
                .map((p) => (
                  <g key={p.frequency} transform={`translate(${x(p.frequency)},${y(p.value!)})`}>
                    <title>{`${left ? '左耳' : '右耳'} ${['AC', 'BC', 'UCL'][type]} ${p.frequency} Hz ${p.value} dB HL`}</title>
                    {type === 2 ? (
                      <text
                        stroke="none"
                        style={{ fill: color }}
                        textAnchor="middle"
                        y="5"
                        className="ucl-symbol"
                      >
                        U
                      </text>
                    ) : type === 1 ? (
                      <path
                        fill="none"
                        d={
                          p.masked
                            ? left
                              ? 'M-4,-6h7v12h-7'
                              : 'M4,-6h-7v12h7'
                            : left
                              ? 'M-4,-6l7,6l-7,6'
                              : 'M4,-6l-7,6l7,6'
                        }
                      />
                    ) : p.masked ? (
                      left ? (
                        <rect x="-5" y="-5" width="10" height="10" />
                      ) : (
                        <path d="M0,-6l6,11h-12Z" />
                      )
                    ) : left ? (
                      <path d="M-5,-5l10,10m0,-10l-10,10" />
                    ) : (
                      <circle r="5" />
                    )}
                    {p.noResponse && <path d="M4,6l7,7m-6,0h6v-6" fill="none" />}
                  </g>
                ))}
            </g>
          ))}
          {onChange && (
            <circle
              className="hearing-cursor"
              cx={x(editableFrequencies[cursor.index])}
              cy={y(cursor.db)}
              r="8"
              fill="none"
              stroke={color}
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </section>
    );
  }
  const legacy = (
    ['right', 'left', 'boneRight', 'boneLeft', 'uclRight', 'uclLeft'] as CurveKey[]
  ).some((key) =>
    (value[key] || []).some((p) => p.value !== null && !editableFrequencies.includes(p.frequency)),
  );
  return (
    <div className="hearing-editor">
      <label className="hearing-date">
        检查日期{' '}
        {loading ? (
          <span className="skeleton-line skeleton-control" />
        ) : (
          <input
            type="date"
            required
            value={value.date}
            max={new Date().toLocaleDateString('sv-SE')}
            disabled={!onChange}
            onChange={(e) => onChange?.({ ...value, date: e.target.value })}
          />
        )}
      </label>
      <div className="hearing-workspace">
        {graph(false)}
        <div className="hearing-tools">
          <span>标记类型</span>
          {(['AC', 'BC', 'UCL'] as const).map((tool) => (
            <button
              type="button"
              key={tool}
              disabled={loading || !onChange}
              aria-pressed={mode === tool && !erase}
              className={mode === tool && !erase ? 'selected' : ''}
              onClick={() => {
                setMode(tool);
                setErase(false);
              }}
            >
              <b>{tool}</b>
              <small>{{ AC: '气导', BC: '骨导', UCL: '不舒适阈' }[tool]}</small>
            </button>
          ))}
          {(onChange || loading) && (
            <>
              <button
                type="button"
                disabled={loading}
                className={erase ? 'selected' : ''}
                aria-pressed={erase}
                onClick={() => setErase(!erase)}
              >
                擦除 {mode}
              </button>
              <button
                type="button"
                disabled={loading || !undo.length}
                onClick={() => {
                  const last = undo.at(-1)!;
                  onChange?.({ ...value, [last.key]: last.points });
                  setUndo(undo.slice(0, -1));
                  setMessage('已撤销上一个测点操作');
                }}
              >
                撤销
              </button>
              <label>
                <input
                  type="checkbox"
                  disabled={loading || mode === 'UCL'}
                  checked={mode !== 'UCL' && masked}
                  onChange={(e) => setMasked(e.target.checked)}
                />
                掩蔽
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={loading}
                  checked={noResponse}
                  onChange={(e) => setNoResponse(e.target.checked)}
                />
                无反应
              </label>
            </>
          )}
        </div>
        {graph(true)}
      </div>
      <p className="hearing-hint" role="status">
        {message ||
          (onChange || loading
            ? '选择 AC、BC 或 UCL，点击图上位置即可标记；同一频率再次点击可修改，按 5 dB 自动对齐。'
            : '○ / × 气导 · 〈 / 〉骨导 · U 不舒适阈 · 淡虚线为前次气导')}
      </p>
      {legacy && (
        <p className="hearing-hint">
          本次历史检查含其他频率测点，原始数值会保留；本页仅修改六个指定频率。
        </p>
      )}
      <details className="hearing-notes">
        <summary>其他检查结果与建议（选填）</summary>
        {(['speech', 'other', 'conclusion'] as const).map((key) => (
          <label key={key}>
            {{ speech: '言语测听', other: '其他检查结果', conclusion: '检查结论与建议' }[key]}
            <textarea
              value={value[key]}
              disabled={!onChange}
              onChange={(e) => onChange?.({ ...value, [key]: e.target.value })}
            />
          </label>
        ))}
      </details>
    </div>
  );
}
