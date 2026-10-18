import { applyOverrides, explainScore, simulate, suggest } from './score-insight.js';
import type { InsightTask } from './score-insight.js';

const task = (over: Partial<InsightTask> & { id: string }): InsightTask => ({
  code: over.id.toUpperCase(),
  name: `Việc ${over.id}`,
  coefficient: 1,
  plannedQuantity: 10,
  completedQuantity: 10,
  qualityLevel: 1,
  lateCount: 0,
  reworkCount: 0,
  ...over,
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('giải thích điểm', () => {
  const tasks = [
    task({ id: 'a', coefficient: 2, plannedQuantity: 10, completedQuantity: 8, lateCount: 1 }),
    task({ id: 'b', coefficient: 1, plannedQuantity: 20, completedQuantity: 20, reworkCount: 2 }),
    task({ id: 'c', coefficient: 3, plannedQuantity: 5, completedQuantity: 0, qualityLevel: null }),
  ];

  it('điểm các thành phần cộng lại đúng bằng điểm kết quả của hồ sơ', () => {
    const x = explainScore(tasks, 25, null, false);
    expect(sum(x.components.map((c) => c.points))).toBeCloseTo(x.resultScore, 1);
    expect(x.componentCount).toBe(3);
    expect(x.components.every((c) => c.maxPoints === 23.33)).toBe(true);
  });

  it('điểm mất của từng dòng cộng với điểm đạt bằng mức tối đa (không có việc đột xuất)', () => {
    const x = explainScore(tasks, 25, null, false);
    const lost = sum(x.lines.map((l) => l.lostQuantity + l.lostQuality + l.lostTimeliness));
    expect(lost + x.resultScore).toBeCloseTo(70, 0);
    // Dòng c chưa làm gì: mất toàn bộ phần của mình ở cả ba thành phần.
    const c = x.lines.find((l) => l.code === 'C')!;
    expect(c.points).toBe(0);
    expect(c.lostQuantity).toBeGreaterThan(0);
  });

  it('lãnh đạo đã chấm D: chia 6, điểm cộng lại vẫn khớp; chưa chấm thì có ghi chú tạm tính', () => {
    const lead = { unitResult: 1, organizing: 0.5, solidarity: 1 };
    const x = explainScore(tasks, 25, lead, true);
    expect(x.componentCount).toBe(6);
    expect(x.components).toHaveLength(6);
    expect(sum(x.components.map((c) => c.points))).toBeCloseTo(x.resultScore, 1);
    expect(x.components.find((c) => c.key === 'organizing')!.lostPoints).toBeCloseTo(5.83, 1);
    const pending = explainScore(tasks, 25, null, true);
    expect(pending.componentCount).toBe(3);
    expect(pending.notes.join(' ')).toContain('chưa được chấm');
  });

  it('việc đột xuất không vào mẫu số nhưng bù cho việc thường và bị chặn ở 100%', () => {
    const list = [
      task({ id: 'a', plannedQuantity: 10, completedQuantity: 8 }),
      task({ id: 'x', code: 'DX.1', extra: true, plannedQuantity: 1, completedQuantity: 1, coefficient: 5 }),
    ];
    const x = explainScore(list, 30, null, false);
    expect(x.lines.find((l) => l.code === 'DX.1')!.share).toBeNull();
    expect(x.capped).toEqual(['quantity', 'quality', 'timeliness']);
    expect(x.resultScore).toBe(70);
  });

  it('dòng đã ghi kết quả nhưng chưa đánh giá chất lượng không được tính và được nêu', () => {
    const y = explainScore([task({ id: 'p', completedQuantity: 4, qualityLevel: null })], 25, null, false);
    expect(y.lines[0].pendingQuality).toBe(true);
    expect(y.lines[0].accepted).toBe(0);
    expect(y.notes.join(' ')).toContain('chưa được đánh giá chất lượng');
  });

  it('chưa có điểm chung: không có tổng và xếp loại', () => {
    const x = explainScore(tasks, null, null, false);
    expect(x.totalScore).toBeNull();
    expect(x.rating).toBeNull();
  });
});

describe('mô phỏng', () => {
  const input = {
    tasks: [task({ id: 'a', plannedQuantity: 10, completedQuantity: 5 }), task({ id: 'b', plannedQuantity: 10, completedQuantity: 10 })],
    generalScore: 25,
    leadership: null,
    isLeader: false,
  };

  it('hoàn thành nốt thì điểm tăng, so với hiện trạng', () => {
    const s = simulate(input, [{ taskId: 'a', completedQuantity: 10 }]);
    expect(s.deltaResult).toBeGreaterThan(0);
    expect(s.result.resultScore).toBe(70);
    expect(s.result.totalScore).toBe(95);
    expect(s.deltaTotal).toBe(s.deltaResult);
    expect(s.base.resultScore).toBe(52.5);
  });

  it('thêm lần chậm làm điểm giảm; không có giả định thì không đổi', () => {
    expect(simulate(input, [{ taskId: 'b', lateCount: 2 }]).deltaResult).toBeLessThan(0);
    expect(simulate(input, []).deltaResult).toBe(0);
  });

  it('đổi điểm chung giả định chỉ đổi tổng, không đổi điểm kết quả', () => {
    const s = simulate(input, [], 30);
    expect(s.deltaResult).toBe(0);
    expect(s.deltaTotal).toBe(5);
  });

  it('applyOverrides không sửa danh sách gốc', () => {
    const before = JSON.stringify(input.tasks);
    applyOverrides(input.tasks, [{ taskId: 'a', completedQuantity: 1 }]);
    expect(JSON.stringify(input.tasks)).toBe(before);
  });
});

describe('gợi ý', () => {
  it('xếp việc nên làm theo điểm tăng, rủi ro theo điểm giảm, và chỉ ra bước đạt mức kế tiếp', () => {
    const input = {
      tasks: [
        task({ id: 'a', coefficient: 5, plannedQuantity: 10, completedQuantity: 2 }),
        task({ id: 'b', coefficient: 1, plannedQuantity: 10, completedQuantity: 2 }),
        task({ id: 'c', coefficient: 1, plannedQuantity: 10, completedQuantity: 10 }),
      ],
      generalScore: 24,
      leadership: null,
      isLeader: false,
    };
    const s = suggest(input);
    expect(s.opportunities[0].code).toBe('A'); // hệ số lớn nhất, còn nhiều nhất
    expect(s.opportunities[0].deltaResult).toBeGreaterThan(s.opportunities[1].deltaResult);
    expect(s.risks.every((r) => r.deltaResult <= 0)).toBe(true);
    expect(s.goal?.next).toBeTruthy();
    expect(s.goal?.reachable).toBe(true);
    expect(s.goal!.steps.length).toBeGreaterThan(0);
    // Làm theo các bước thì đạt ngưỡng của mức kế tiếp.
    let tasks = input.tasks;
    for (const m of s.goal!.steps) tasks = applyOverrides(tasks, [{ taskId: m.taskId, completedQuantity: 10 }]);
    expect(simulate({ ...input, tasks }, []).base.totalScore).toBeGreaterThanOrEqual(s.goal!.threshold!);
  });

  it('khi chưa có điểm chung không có mục tiêu xếp loại; đã xuất sắc thì không có mức kế tiếp', () => {
    const noGeneral = suggest({ tasks: [task({ id: 'a' })], generalScore: null, leadership: null, isLeader: false });
    expect(noGeneral.goal).toBeNull();
    const top = suggest({ tasks: [task({ id: 'a' })], generalScore: 30, leadership: null, isLeader: false });
    expect(top.goal?.next).toBeNull();
    expect(top.goal?.missing).toBe(0);
    expect(top.opportunities).toEqual([]);
  });

  it('mức kế tiếp không thể đạt chỉ bằng việc đã giao thì reachable=false và nêu trần', () => {
    const s = suggest({
      tasks: [task({ id: 'a', plannedQuantity: 10, completedQuantity: 10, lateCount: 4 })],
      generalScore: 10,
      leadership: null,
      isLeader: false,
    });
    expect(s.goal?.reachable).toBe(false);
    expect(s.goal!.ceiling).toBeLessThan(s.goal!.threshold!);
  });
});
