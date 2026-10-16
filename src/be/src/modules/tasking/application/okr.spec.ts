import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { parseOkr } from '../../organization/application/okr-parser.js';
import { actorOf, buildTasking, PEOPLE, seedAssignment } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const OKR = parseOkr('O: Nâng cao chất lượng. KR1: 100% hồ sơ đúng hạn. KR2: ≥95% văn bản đạt chất lượng.')!;

describe('TaskingService: gắn việc với kết quả then chốt OKR (ADR-034)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
    h.org.okrs.set(PEOPLE.staff, OKR);
  });

  it('gắn mã kết quả then chốt: lưu nhãn đầy đủ tại lúc giao và ghi nhật ký', async () => {
    const view = await seedAssignment(h, { keyResult: 'KR2' });
    expect(view.assignment.okrKeyResult).toBe('KR2: ≥95% văn bản đạt chất lượng');
    expect(h.audit.find((a) => a.action === 'tasking.assignment.create')?.details).toMatchObject({ okrKeyResult: 'KR2: ≥95% văn bản đạt chất lượng' });
  });

  it('không gắn thì để trống, việc vẫn giao bình thường', async () => {
    expect((await seedAssignment(h)).assignment.okrKeyResult).toBeNull();
    expect((await seedAssignment(h, { keyResult: '  ' })).assignment.okrKeyResult).toBeNull();
  });

  it('mã không có trong OKR của người nhận, hoặc người nhận chưa có OKR, thì từ chối', async () => {
    await expect(seedAssignment(h, { keyResult: 'KR9' })).rejects.toBeInstanceOf(BadRequestException);
    h.org.okrs.delete(PEOPLE.staff);
    await expect(seedAssignment(h, { keyResult: 'KR1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('người giao đổi hoặc bỏ kết quả then chốt khi sửa việc; người khác không sửa được', async () => {
    const { assignment } = await seedAssignment(h, { keyResult: 'KR1' });
    expect((await h.service.update(actorOf('head'), assignment.id, { keyResult: 'KR2' })).assignment.okrKeyResult).toMatch(/^KR2:/);
    expect((await h.service.update(actorOf('head'), assignment.id, { note: 'chỉ đổi nội dung' })).assignment.okrKeyResult).toMatch(/^KR2:/);
    expect((await h.service.update(actorOf('head'), assignment.id, { keyResult: null })).assignment.okrKeyResult).toBeNull();
    await expect(h.service.update(actorOf('head'), assignment.id, { keyResult: 'KR9' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.update(actorOf('staff'), assignment.id, { keyResult: 'KR1' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('xem OKR của cán bộ: chính họ, các cấp trên, người xem toàn bộ; người khác không xem được', async () => {
    expect((await h.service.okrOf(actorOf('staff'), PEOPLE.staff, false))?.objective).toBe('Nâng cao chất lượng');
    for (const who of ['head', 'deputy', 'boss'] as const) expect((await h.service.okrOf(actorOf(who), PEOPLE.staff, false))?.keyResults).toHaveLength(2);
    await expect(h.service.okrOf(actorOf('other'), PEOPLE.staff, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.okrOf(actorOf(null), PEOPLE.staff, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.okrOf(actorOf('other'), PEOPLE.staff, true))?.keyResults).toHaveLength(2);
    expect(await h.service.okrOf(actorOf('head'), PEOPLE.head, false)).toBeNull(); // vị trí không có OKR
  });
});
