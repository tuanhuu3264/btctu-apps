'use client';

import { Typography } from 'antd';

/** Biểu đồ tự vẽ bằng CSS/SVG, không dùng thư viện ngoài (ADR-027). Mỗi biểu đồ đều có nhãn chữ và số kèm theo, không chỉ dựa vào màu. */

export interface Segment {
  label: string;
  value: number;
  color: string;
}

const MUTED = '#8c8c8c';

/** Chú thích: ô màu, nhãn và số. */
function Legend({ segments }: { segments: Segment[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
      {segments.map((s) => (
        <li key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flex: 'none' }} />
          <span style={{ flex: 1 }}>{s.label}</span>
          <strong>{s.value}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Biểu đồ vành khăn kèm chú thích. `centre` là số lớn ở giữa. */
export function Donut({ segments, centre, caption }: { segments: Segment[]; centre: string; caption: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label={`${caption}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
        <circle cx={70} cy={70} r={R} fill="none" stroke="#f0f0f0" strokeWidth={18} />
        {total > 0 &&
          segments.map((s) => {
            const len = (s.value / total) * C;
            const el = (
              <circle key={s.label} cx={70} cy={70} r={R} fill="none" stroke={s.color} strokeWidth={18} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />
            );
            offset += len;
            return el;
          })}
        <text x={70} y={68} textAnchor="middle" style={{ fontSize: 24, fontWeight: 700, fill: '#262626' }}>
          {centre}
        </text>
        <text x={70} y={88} textAnchor="middle" style={{ fontSize: 11, fill: MUTED }}>
          {caption}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 160 }}>
        <Legend segments={segments} />
      </div>
    </div>
  );
}

/** Thanh ngang chia đoạn (tổng bằng 100% chiều rộng) kèm chú thích. */
export function StackBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', background: '#f0f0f0' }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => <div key={s.label} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />)}
      </div>
      <Legend segments={segments} />
    </div>
  );
}

export interface BarRow {
  label: string;
  /** null: chưa có số liệu, hiện "–" và thanh trống. */
  value: number | null;
  text: string;
  hint?: string;
}

/** Danh sách thanh ngang: nhãn bên trái, thanh theo `max`, số bên phải. */
export function HBars({ rows, max, color = 'var(--red)' }: { rows: BarRow[]; max: number; color?: string }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 40%) 1fr 56px', gap: 10, alignItems: 'center', fontSize: 13 }} title={r.hint}>
          <Typography.Text ellipsis>{r.label}</Typography.Text>
          <div style={{ height: 12, borderRadius: 6, background: '#f0f0f0', overflow: 'hidden' }}>
            {r.value !== null && <div style={{ width: `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`, height: '100%', background: color }} />}
          </div>
          <strong style={{ textAlign: 'right' }}>{r.text}</strong>
        </div>
      ))}
    </div>
  );
}

export interface LinePoint {
  label: string;
  value: number | null;
}

/** Biểu đồ đường: đoạn bị ngắt ở kỳ không có số liệu (không vẽ số 0). Trục dọc từ 0 đến `max`. */
export function LineChart({ points, max, format, color = 'var(--red)' }: { points: LinePoint[]; max: number; format: (n: number) => string; color?: string }) {
  const W = 560;
  const H = 190;
  const L = 44;
  const R = 36;
  const T = 28;
  const B = 34;
  const step = points.length > 1 ? (W - L - R) / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? L + i * step : (L + W - R) / 2);
  const y = (v: number) => T + (1 - Math.max(0, Math.min(max, v)) / max) * (H - T - B);

  // Chia thành các đoạn liên tục để đường không nối qua kỳ trống.
  const runs: { i: number; v: number }[][] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push({ i, v: p.value });
  });
  const hasData = points.some((p) => p.value !== null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={points.map((p) => `${p.label}: ${p.value === null ? 'chưa có' : format(p.value)}`).join('; ')}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#eee" />
          <text x={L - 6} y={y(max * f) + 4} textAnchor="end" style={{ fontSize: 10, fill: MUTED }}>
            {format(max * f)}
          </text>
        </g>
      ))}
      {runs.map((run, k) =>
        run.length > 1 ? <polyline key={k} points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" /> : null,
      )}
      {points.map((p, i) => (
        <g key={p.label}>
          {p.value !== null && (
            <>
              <circle cx={x(i)} cy={y(p.value)} r={4} fill="#fff" stroke={color} strokeWidth={2.5} />
              <text x={x(i)} y={y(p.value) - 9} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: '#262626' }}>
                {format(p.value)}
              </text>
            </>
          )}
          <text x={x(i)} y={H - 12} textAnchor="middle" style={{ fontSize: 10, fill: MUTED }}>
            {p.label}
          </text>
        </g>
      ))}
      {!hasData && (
        <text x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 13, fill: MUTED }}>
          Chưa có hồ sơ được phê duyệt
        </text>
      )}
    </svg>
  );
}
