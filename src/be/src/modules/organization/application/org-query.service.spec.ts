import { buildOrg, seedChain } from './testing/in-memory.js';
import type { Org } from './testing/in-memory.js';

describe('OrgQueryService: cấp trên và cấp dưới', () => {
  let org: Org;
  beforeEach(async () => {
    org = await buildOrg();
  });

  const person = (name: string) => org.persons.create({ fullName: name, note: null });

  it('cấp dưới trực tiếp và cấp dưới mọi cấp theo chuỗi 1 → 2 → 3 → 4 → 5', async () => {
    const chain = await seedChain(org);
    const [p1, p2, p3, p4, p5] = await Promise.all(['Nguyễn Văn A', 'Nguyễn Văn B', 'Nguyễn Văn C', 'Nguyễn Văn D', 'Nguyễn Văn E'].map(person));
    for (const [position, p] of [[chain.l1, p1], [chain.l2, p2], [chain.l3, p3], [chain.l4, p4], [chain.l5, p5]] as const) {
      await org.assignments.assign(position.id, p.id);
    }

    expect(await org.query.subordinateHolders(p2.id, { direct: true })).toEqual([p3.id]);
    expect((await org.query.subordinateHolders(p2.id, { direct: false })).sort()).toEqual([p3.id, p4.id, p5.id].sort());
    expect(await org.query.subordinateHolders(p5.id, { direct: false })).toEqual([]);
    expect((await org.query.superiorsOf(p5.id)).map((s) => s.personId)).toEqual([p4.id, p3.id, p2.id, p1.id]);
  });

  it('vị trí trống bị bỏ qua nhưng vẫn đi qua để tìm cấp dưới của nó', async () => {
    const chain = await seedChain(org);
    const [p2, p3, p5] = await Promise.all(['Nguyễn Văn B', 'Nguyễn Văn C', 'Nguyễn Văn E'].map(person));
    await org.assignments.assign(chain.l2.id, p2.id);
    await org.assignments.assign(chain.l3.id, p3.id);
    await org.assignments.assign(chain.l5.id, p5.id); // vị trí cấp 4 để trống

    expect(await org.query.subordinateHolders(p3.id, { direct: true })).toEqual([]);
    expect(await org.query.subordinateHolders(p3.id, { direct: false })).toEqual([p5.id]);
  });

  it('cán bộ không giữ vị trí nào thì không có cấp dưới', async () => {
    await seedChain(org);
    const loose = await person('Nguyễn Văn F');
    expect(await org.query.subordinateHolders(loose.id, { direct: false })).toEqual([]);
  });
});
