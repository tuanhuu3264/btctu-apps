import { actorOf, buildEvaluation, PEOPLE } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

/** Hồ sơ cá nhân của `head` đã thẩm định với xếp loại `rating`, trong kỳ `type`. */
async function reviewedHeadFile(h: Harness, type: 'YEAR' | 'QUARTER', rating: 'XUAT_SAC' | 'HOAN_THANH_TOT') {
  const period = await h.service.createPeriod(actorOf('head'), type === 'YEAR' ? { type, year: 2026 } : { type, year: 2026, number: 3 });
  const file = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.head, positionId: 'pos-head', createdBy: null });
  await h.repos.evaluations.update(file.id, { status: 'REVIEWED', resultScore: 60, totalScore: 90, rating });
  return file;
}

describe('mức của người đứng đầu không cao hơn mức của tổ chức (Nghị định 335 Điều 20.6)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });
  const warnings = async (id: string) => (await h.service.getEvaluation(actorOf('deputy'), id, false)).warnings.filter((w) => /Điều 20\.6/.test(w));

  it('cảnh báo khi xếp cao hơn đơn vị, nói rõ đơn vị mới đề xuất hay đã công nhận', async () => {
    const file = await reviewedHeadFile(h, 'YEAR', 'XUAT_SAC');
    h.unitRatings.byPerson.set(PEOPLE.head, { unitName: 'Phòng Tổ chức', rating: 'HOAN_THANH_TOT', approved: false });
    const proposed = await warnings(file.id);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatch(/xuất sắc.*cao hơn mức của Phòng Tổ chức: hoàn thành tốt.*chưa được công nhận/);

    h.unitRatings.byPerson.set(PEOPLE.head, { unitName: 'Phòng Tổ chức', rating: 'HOAN_THANH_TOT', approved: true });
    expect((await warnings(file.id))[0]).not.toMatch(/chưa được công nhận/);
  });

  it('không cảnh báo khi bằng hoặc thấp hơn mức của đơn vị', async () => {
    const file = await reviewedHeadFile(h, 'YEAR', 'HOAN_THANH_TOT');
    h.unitRatings.byPerson.set(PEOPLE.head, { unitName: 'Phòng Tổ chức', rating: 'HOAN_THANH_TOT', approved: true });
    expect(await warnings(file.id)).toEqual([]);
    h.unitRatings.byPerson.set(PEOPLE.head, { unitName: 'Phòng Tổ chức', rating: 'XUAT_SAC', approved: true });
    expect(await warnings(file.id)).toEqual([]);
  });

  it('không cảnh báo khi không đứng đầu đơn vị nào hoặc đơn vị chưa có mức', async () => {
    const file = await reviewedHeadFile(h, 'YEAR', 'XUAT_SAC');
    expect(await warnings(file.id)).toEqual([]);
  });

  it('chỉ áp dụng cho kỳ năm vì tập thể chỉ xếp loại theo năm', async () => {
    const file = await reviewedHeadFile(h, 'QUARTER', 'XUAT_SAC');
    h.unitRatings.byPerson.set(PEOPLE.head, { unitName: 'Phòng Tổ chức', rating: 'HOAN_THANH', approved: true });
    expect(await warnings(file.id)).toEqual([]);
  });
});
