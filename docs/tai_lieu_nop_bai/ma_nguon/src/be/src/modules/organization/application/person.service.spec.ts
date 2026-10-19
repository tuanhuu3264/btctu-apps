import { BadRequestException, ConflictException } from '@nestjs/common';
import { buildOrg } from './testing/in-memory.js';
import type { Org } from './testing/in-memory.js';
import { toPublicPerson } from './org.model.js';

describe('PersonService: hồ sơ cán bộ mở rộng (ADR-023)', () => {
  let org: Org;
  beforeEach(async () => {
    org = await buildOrg();
  });

  const full = {
    fullName: 'Nguyễn Thị Hoa',
    note: null,
    employeeCode: ' cb-001 ',
    gender: 'NU' as const,
    ethnicity: ' Kinh ',
    dateOfBirth: '1990-05-20',
    nationalId: '066190001234',
    email: 'Hoa.Nguyen@Example.com',
    phone: '0912345678',
    rank: 'Chuyên viên',
    salaryGrade: 'Bậc 3',
    joinedAgencyOn: '2015-09-01',
    partyJoinedOn: '2018-03-03',
    education: 'Thạc sĩ',
    major: 'Quản trị nhân lực',
    politicalTheory: 'TRUNG_CAP' as const,
  };

  it('tạo hồ sơ đầy đủ: chuẩn hóa mã (viết hoa), email (viết thường), cắt khoảng trắng', async () => {
    const p = await org.persons.create(full);
    expect(p).toMatchObject({ employeeCode: 'CB-001', ethnicity: 'Kinh', email: 'hoa.nguyen@example.com', gender: 'NU', politicalTheory: 'TRUNG_CAP' });
  });

  it('hồ sơ chỉ có họ tên vẫn tạo được, các trường còn lại là null', async () => {
    const p = await org.persons.create({ fullName: 'Trần Văn Bình', note: null });
    expect(p).toMatchObject({ employeeCode: null, nationalId: null, dateOfBirth: null, politicalTheory: null });
  });

  it('mã cán bộ và CCCD không trùng người khác, không phân biệt hoa thường với mã', async () => {
    await org.persons.create(full);
    await expect(org.persons.create({ fullName: 'Người Khác', note: null, employeeCode: 'cb-001' })).rejects.toBeInstanceOf(ConflictException);
    await expect(org.persons.create({ fullName: 'Người Khác', note: null, nationalId: '066190001234' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('sửa hồ sơ của chính mình với cùng mã, CCCD thì không báo trùng; xóa trường bằng null hoặc chuỗi rỗng', async () => {
    const p = await org.persons.create(full);
    const updated = await org.persons.update(p.id, { employeeCode: 'CB-001', nationalId: '066190001234', phone: null, major: '  ' });
    expect(updated).toMatchObject({ employeeCode: 'CB-001', phone: null, major: null });
  });

  it('từ chối ngày ở tương lai và ngày vào cơ quan, vào Đảng trước ngày sinh', async () => {
    await expect(org.persons.create({ ...full, fullName: 'A B', employeeCode: 'X1', nationalId: undefined, partyJoinedOn: '2099-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(org.persons.create({ ...full, fullName: 'A B', employeeCode: 'X2', nationalId: undefined, joinedAgencyOn: '1980-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    const p = await org.persons.create({ fullName: 'Lê Văn Cường', note: null, dateOfBirth: '1990-01-01' });
    await expect(org.persons.update(p.id, { partyJoinedOn: '1985-01-01' })).rejects.toBeInstanceOf(BadRequestException); // so với ngày sinh đã có
  });

  it('nhật ký chỉ ghi tên trường nhạy cảm đã đổi, không ghi giá trị', async () => {
    const p = await org.persons.create(full);
    await org.persons.update(p.id, { nationalId: '066190009999', phone: '0988888888', rank: 'Chuyên viên chính' });
    const entry = org.audit.at(-1)!;
    expect(entry.action).toBe('person.update');
    expect(entry.details).toMatchObject({ sensitiveChanged: ['nationalId', 'phone'] });
    const text = JSON.stringify(entry.details);
    expect(text).not.toContain('066190009999');
    expect(text).not.toContain('0988888888');
  });

  it('bản công khai bỏ ngày sinh, CCCD, email, điện thoại nhưng giữ thông tin công tác', async () => {
    const p = await org.persons.create(full);
    const pub = toPublicPerson(p) as Record<string, unknown>;
    for (const f of ['dateOfBirth', 'nationalId', 'email', 'phone']) expect(pub).not.toHaveProperty(f);
    expect(pub).toMatchObject({ fullName: 'Nguyễn Thị Hoa', employeeCode: 'CB-001', rank: 'Chuyên viên', education: 'Thạc sĩ' });
  });
});
