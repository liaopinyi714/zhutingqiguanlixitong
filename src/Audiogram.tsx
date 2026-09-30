import { frequencies } from '../shared/hearing';
import type { Exam, Point } from './types';

export function Audiogram({ exam, previous }: { exam: Exam; previous?: Exam }) {
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
