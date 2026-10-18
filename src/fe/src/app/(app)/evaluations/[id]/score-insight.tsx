'use client';

import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, InputNumber, List, Progress, Space, Spin, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { RatingTag } from '@/components/status-tags';
import type { InsightMove, InsightView, Simulation } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { RATING_LABELS } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';

const f = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(2).replace('.', ','));
const pct = (x: number | null) => (x === null ? 'chưa chấm' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const fmt = (v: number | string) => (typeof v === 'number' ? f(v) : String(v));
const signed = (n: number) => `${n > 0 ? '+' : ''}${f(n)}`;

interface Draft {
  completed: number;
  late: number;
  rework: number;
}

/**
 * Giải thích điểm và mô phỏng "nếu…" của một hồ sơ (chỉ đọc). Số liệu do backend tính bằng đúng công thức chấm điểm,
 * nên điểm giải thích cộng lại bằng điểm kết quả của hồ sơ.
 */
export default function ScoreInsight({ evaluationId, version = 0 }: { evaluationId: string; version?: number }) {
  const { data, error, loading } = useRemote<InsightView>(`/evaluation/evaluations/${evaluationId}/insight`, version);
  if (error) return <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />;
  if (loading && !data) return <Spin />;
  if (!data) return null;
  if (!data.supported || !data.explanation) {
    return <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Giải thích điểm" description={data.reason ?? 'Hồ sơ này chưa giải thích được.'} />;
  }
  return (
    <Card size="small" title="Giải thích điểm và mô phỏng" style={{ marginBottom: 16 }} extra={data.frozen ? <Tag>Hồ sơ đã chốt: mô phỏng chỉ để tham khảo</Tag> : null}>
      <Tabs
        items={[
          { key: 'explain', label: 'Điểm đến từ đâu', children: <Explain data={data} /> },
          { key: 'goal', label: 'Để lên mức tiếp theo', children: <Goal data={data} /> },
          { key: 'sim', label: 'Mô phỏng "nếu…"', children: <Simulator evaluationId={evaluationId} data={data} /> },
        ]}
      />
    </Card>
  );
}

function Explain({ data }: { data: InsightView }) {
  const x = data.explanation!;
  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space size="large" wrap>
        <Statistic formatter={fmt} title={`Điểm kết quả (tối đa ${x.resultMax})`} value={x.resultScore} />
        <Statistic formatter={fmt} title="Điểm chung (tối đa 30)" value={x.generalScore ?? '–'} />
        <Statistic formatter={fmt} title="Tổng điểm" value={x.totalScore ?? '–'} />
        <div>
          <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 14 }}>Xếp loại tạm tính</div>
          <RatingTag rating={x.rating} />
        </div>
      </Space>
      {x.notes.map((n) => (
        <Alert key={n} type="info" showIcon message={n} />
      ))}
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={x.components}
        columns={[
          { title: 'Thành phần', dataIndex: 'label', render: (l: string, r) => <><div>{l}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.basis}</Typography.Text></> },
          { title: 'Tỷ lệ', dataIndex: 'rate', align: 'right', render: (r: number | null) => pct(r) },
          {
            title: 'Điểm đạt / tối đa',
            align: 'right',
            width: 200,
            render: (_, r) => (
              <div>
                {f(r.points)} / {f(r.maxPoints)}
                <Progress percent={r.maxPoints > 0 ? Math.round((r.points / r.maxPoints) * 100) : 0} size="small" showInfo={false} />
              </div>
            ),
          },
          { title: 'Mất', dataIndex: 'lostPoints', align: 'right', render: (v: number) => (v > 0 ? <Typography.Text type="danger">-{f(v)}</Typography.Text> : '–') },
        ]}
      />
      <Typography.Text strong>Điểm đóng góp và điểm mất ở từng dòng việc</Typography.Text>
      <Table
        size="small"
        rowKey="taskId"
        pagination={false}
        scroll={{ x: 900 }}
        dataSource={x.lines}
        columns={[
          { title: 'Công việc', render: (_, l) => <><b>{l.code}</b> {l.name.length > 70 ? `${l.name.slice(0, 70)}…` : l.name}{l.extra && <Tag style={{ marginLeft: 4 }}>đột xuất</Tag>}{l.pendingQuality && <Tag color="gold" style={{ marginLeft: 4 }}>chờ đánh giá chất lượng</Tag>}</> },
          { title: 'Tỷ trọng', dataIndex: 'share', align: 'right', render: (s: number | null) => (s === null ? '–' : pct(s)) },
          { title: 'Đạt / giao', align: 'right', render: (_, l) => `${l.accepted} / ${l.planned}` },
          { title: 'Chậm / chưa đạt', align: 'right', render: (_, l) => `${l.lateCount} / ${l.reworkCount}` },
          { title: 'Điểm đóng góp', dataIndex: 'points', align: 'right', render: (v: number) => f(v) },
          { title: 'Mất: thiếu SL', dataIndex: 'lostQuantity', align: 'right', render: (v: number) => (v > 0 ? `-${f(v)}` : '–') },
          { title: 'Mất: chưa đạt', dataIndex: 'lostQuality', align: 'right', render: (v: number) => (v > 0 ? `-${f(v)}` : '–') },
          { title: 'Mất: chậm', dataIndex: 'lostTimeliness', align: 'right', render: (v: number) => (v > 0 ? `-${f(v)}` : '–') },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Công thức: Nghị định 335/2025/NĐ-CP Điều 14 đến 17. Mỗi lần chậm hoặc sai sót lớn trừ 25% của dòng việc đó (Điều 14.2.b, c). Phần chưa hoàn thành mất ở cả ba thành phần a, b, c nên được tính ba lần.
      </Typography.Text>
    </Space>
  );
}

function MoveList({ moves, empty }: { moves: InsightMove[]; empty: string }) {
  return (
    <List
      size="small"
      locale={{ emptyText: empty }}
      dataSource={moves}
      renderItem={(m) => (
        <List.Item>
          <div style={{ flex: 1 }}>
            {m.text}
            <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{m.name.length > 80 ? `${m.name.slice(0, 80)}…` : m.name}</Typography.Text></div>
          </div>
          <Tag color={m.deltaResult >= 0 ? 'green' : 'red'}>{m.deltaResult >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {signed(m.deltaResult)} điểm</Tag>
          {m.ratingAfter && <RatingTag rating={m.ratingAfter} />}
        </List.Item>
      )}
    />
  );
}

function Goal({ data }: { data: InsightView }) {
  const s = data.suggestions!;
  const g = s.goal;
  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      {!g ? (
        <Alert type="info" showIcon message="Chưa có điểm tiêu chí chung nên chưa so với mức xếp loại. Nhập điểm chung giả định ở thẻ Mô phỏng để xem." />
      ) : g.next === null ? (
        <Alert type="success" showIcon message={`Đã đạt mức cao nhất: ${RATING_LABELS[g.current]}.`} description="Việc nên giữ: tránh phát sinh chậm và sai sót lớn, vì mỗi lần trừ 25% dòng việc." />
      ) : (
        <Alert
          type={g.reachable ? 'info' : 'warning'}
          showIcon
          message={`Hiện: ${RATING_LABELS[g.current]}. Mức kế tiếp: ${RATING_LABELS[g.next]} (từ ${g.threshold} điểm), còn thiếu ${f(g.missing)} điểm.`}
          description={
            g.reachable
              ? `Hoàn thành hết việc đã giao thì tổng điểm tối đa ${f(g.ceiling)}, đủ để lên mức này.`
              : `Dù hoàn thành hết việc đã giao, tổng điểm tối đa chỉ ${f(g.ceiling)} (do số lần chậm, sai sót đã có hoặc điểm chung thấp), chưa đủ ${g.threshold}.`
          }
        />
      )}
      {g && g.steps.length > 0 && (
        <>
          <Typography.Text strong>Thứ tự nên làm để đạt mức kế tiếp</Typography.Text>
          <MoveList moves={g.steps} empty="" />
        </>
      )}
      <Typography.Text strong>Việc mang lại nhiều điểm nhất</Typography.Text>
      <MoveList moves={s.opportunities} empty="Không còn việc nào làm tăng điểm." />
      <Typography.Text strong>Rủi ro làm mất điểm</Typography.Text>
      <MoveList moves={s.risks} empty="Chưa có việc đã hoàn thành nên chưa có rủi ro bị trừ điểm." />
    </Space>
  );
}

function Simulator({ evaluationId, data }: { evaluationId: string; data: InsightView }) {
  const initial: Record<string, Draft> = Object.fromEntries(data.tasks.map((t) => [t.taskId, { completed: t.completed, late: t.lateCount, rework: t.reworkCount }]));
  const [drafts, setDrafts] = useState(initial);
  const [general, setGeneral] = useState<number | null>(data.generalScore);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const changed = data.tasks.some((t) => {
    const d = drafts[t.taskId];
    return d.completed !== t.completed || d.late !== t.lateCount || d.rework !== t.reworkCount;
  }) || general !== data.generalScore;

  useEffect(() => {
    if (!changed) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      const tasks = data.tasks
        .filter((t) => {
          const d = drafts[t.taskId];
          return d.completed !== t.completed || d.late !== t.lateCount || d.rework !== t.reworkCount;
        })
        .map((t) => {
          const d = drafts[t.taskId];
          // Đã có kết quả mà chưa đánh giá chất lượng: giả định được đánh giá đạt (mức 2) để thấy tác động.
          return { taskId: t.taskId, completedQuantity: d.completed, lateCount: d.late, reworkCount: d.rework, qualityLevel: t.qualityLevel ?? (d.completed > 0 ? 2 : null) };
        });
      apiCall<Simulation>('POST', `/evaluation/evaluations/${evaluationId}/simulate`, { tasks, generalScore: general })
        .then((r) => {
          if (mine === seq.current) {
            setSim(r);
            setError(null);
          }
        })
        .catch((e: Error) => mine === seq.current && setError(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [drafts, general, changed, data, evaluationId]);

  const shown = changed ? sim : null;
  const reset = () => {
    setDrafts(initial);
    setGeneral(data.generalScore);
    setSim(null);
    seq.current++;
  };
  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Alert type="info" showIcon message="Thử thay đổi số lượng hoàn thành, số lần chậm hoặc chưa đạt để xem điểm đổi thế nào. Chỉ là giả định, không ghi vào hồ sơ." />
      {error && <Alert type="error" showIcon message={error} />}
      <Table
        size="small"
        rowKey="taskId"
        pagination={false}
        scroll={{ x: 700 }}
        dataSource={data.tasks}
        columns={[
          { title: 'Công việc', render: (_, t) => <><b>{t.code}</b> {t.name.length > 60 ? `${t.name.slice(0, 60)}…` : t.name}{t.extra && <Tag style={{ marginLeft: 4 }}>đột xuất</Tag>}</> },
          { title: 'Giao', dataIndex: 'planned', align: 'right', width: 70 },
          { title: 'Hoàn thành', width: 120, render: (_, t) => <InputNumber size="small" min={0} max={100000} value={drafts[t.taskId].completed} onChange={(v) => set(t.taskId, { completed: v ?? 0 })} /> },
          { title: 'Số lần chậm', width: 110, render: (_, t) => <InputNumber size="small" min={0} max={20} value={drafts[t.taskId].late} onChange={(v) => set(t.taskId, { late: v ?? 0 })} /> },
          { title: 'Số lần chưa đạt', width: 130, render: (_, t) => <InputNumber size="small" min={0} max={20} value={drafts[t.taskId].rework} onChange={(v) => set(t.taskId, { rework: v ?? 0 })} /> },
        ]}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Hồ sơ chưa có chỉ tiêu." /> }}
      />
      <Space wrap>
        <span>Điểm chung giả định (0–30):</span>
        <InputNumber size="small" min={0} max={30} step={0.5} value={general} onChange={(v) => setGeneral(v)} placeholder="chưa có" />
        <Button size="small" onClick={reset} disabled={!changed}>
          Đặt lại
        </Button>
      </Space>
      <Card size="small" style={{ background: '#fafafa' }}>
        <Space size="large" wrap>
          <Statistic formatter={fmt} title="Điểm kết quả" value={shown ? shown.result.resultScore : data.explanation!.resultScore} suffix={shown ? <Tag color={shown.deltaResult >= 0 ? 'green' : 'red'}>{signed(shown.deltaResult)}</Tag> : null} />
          <Statistic formatter={fmt} title="Tổng điểm" value={(shown ? shown.result.totalScore : data.explanation!.totalScore) ?? '–'} suffix={shown?.deltaTotal ? <Tag color={shown.deltaTotal >= 0 ? 'green' : 'red'}>{signed(shown.deltaTotal)}</Tag> : null} />
          <div>
            <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 14 }}>Xếp loại</div>
            <RatingTag rating={shown ? shown.result.rating : data.explanation!.rating} />
            {shown && shown.base.rating !== shown.result.rating && <Typography.Text type="secondary"> (hiện {shown.base.rating ? RATING_LABELS[shown.base.rating] : 'chưa có'})</Typography.Text>}
          </div>
        </Space>
      </Card>
    </Space>
  );
}
