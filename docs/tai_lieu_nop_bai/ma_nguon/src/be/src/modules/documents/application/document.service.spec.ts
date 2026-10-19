import { Notifier } from '../../../common/notifier.js';
import { FakeNotifier } from '../../../common/testing/fake-notifier.js';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AccountService, AuditService } from '../../security/index.js';
import { FileStorage } from '../../tasking/index.js';
import type { CategoryModel, NewCategory, NewPost, NewPostFile, PostFileModel, PostModel, PostPatch } from './document.model.js';
import { CategoryRepository, PostFileRepository, PostRepository } from './document.ports.js';
import { DocumentService } from './document.service.js';

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

class MemCategories extends CategoryRepository {
  rows: CategoryModel[] = [];
  async findAll() {
    return this.rows.map((c) => ({ ...c }));
  }
  async findById(i: string) {
    return this.rows.find((c) => c.id === i) ?? null;
  }
  async findByName(name: string) {
    return this.rows.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;
  }
  async create(d: NewCategory) {
    const row = { ...d, id: id(), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
  async update(i: string, d: NewCategory) {
    Object.assign(this.rows.find((c) => c.id === i)!, d);
    return { ...this.rows.find((c) => c.id === i)! };
  }
  async delete(i: string) {
    this.rows = this.rows.filter((c) => c.id !== i);
  }
}

class MemPosts extends PostRepository {
  rows: PostModel[] = [];
  async findById(i: string) {
    const row = this.rows.find((p) => p.id === i);
    return row ? { ...row } : null;
  }
  async findPublished() {
    return this.rows.filter((p) => p.status === 'PUBLISHED').sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).map((p) => ({ ...p }));
  }
  async countByCategory() {
    const m = new Map<string, number>();
    for (const p of this.rows.filter((r) => r.status === 'PUBLISHED')) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }
  async existsInCategory(categoryId: string) {
    return this.rows.some((p) => p.categoryId === categoryId);
  }
  async create(d: NewPost) {
    const row: PostModel = { ...d, id: id(), status: 'PUBLISHED', publishedAt: new Date(Date.now() + this.rows.length), updatedAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
  async update(i: string, patch: PostPatch) {
    Object.assign(this.rows.find((p) => p.id === i)!, patch);
    return { ...this.rows.find((p) => p.id === i)! };
  }
}

class MemFiles extends PostFileRepository {
  rows: PostFileModel[] = [];
  async findByPosts(ids: readonly string[]) {
    return this.rows.filter((f) => ids.includes(f.postId)).map((f) => ({ ...f }));
  }
  async findById(i: string) {
    return this.rows.find((f) => f.id === i) ?? null;
  }
  async create(d: NewPostFile) {
    const row = { ...d, id: id(), uploadedAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
}

class MemStorage extends FileStorage {
  objects = new Map<string, Buffer>();
  failPut = false;
  async put(key: string, data: Buffer) {
    if (this.failPut) throw new Error('kho tệp hỏng');
    this.objects.set(key, data);
  }
  async get(key: string) {
    return this.objects.get(key)!;
  }
}

const actor = { id: 'acc-1', username: 'vanphong', personId: 'p-1' };
const pdf = (name = 'Quy chế.pdf') => ({ originalName: name, size: 20, buffer: Buffer.from('%PDF-1.4 noi dung thu') });

async function build() {
  const categories = new MemCategories();
  const posts = new MemPosts();
  const files = new MemFiles();
  const storage = new MemStorage();
  const audit: { action: string }[] = [];
  const notifier = new FakeNotifier();
  const moduleRef = await Test.createTestingModule({
    providers: [
      DocumentService,
      { provide: CategoryRepository, useValue: categories },
      { provide: PostRepository, useValue: posts },
      { provide: PostFileRepository, useValue: files },
      { provide: FileStorage, useValue: storage },
      { provide: AuditService, useValue: { record: async (e: { action: string }) => void audit.push(e) } },
      { provide: Notifier, useValue: notifier },
      { provide: AccountService, useValue: { list: async () => [{ id: 'acc-1', username: 'vanphong', status: 'ACTIVE', personId: 'p-1', lockedUntil: null }] } },
    ],
  }).compile();
  return { service: moduleRef.get(DocumentService), categories, posts, files, storage, audit, notifier };
}

describe('DocumentService: danh mục', () => {
  it('tạo, không cho trùng tên (không phân biệt hoa thường) và sắp xếp theo tên', async () => {
    const { service, audit } = await build();
    await service.createCategory({ name: 'Quy chế' });
    await service.createCategory({ name: 'Biểu mẫu', description: 'Mẫu văn bản' });
    await expect(service.createCategory({ name: 'quy chế' })).rejects.toThrow('trùng tên');
    expect((await service.listCategories()).map((c) => c.name)).toEqual(['Biểu mẫu', 'Quy chế']);
    expect(audit.filter((a) => a.action === 'document.category.create')).toHaveLength(2);
  });

  it('sửa tên được nhưng không trùng danh mục khác; đặt lại chính tên mình thì được', async () => {
    const { service } = await build();
    const a = await service.createCategory({ name: 'A' });
    await service.createCategory({ name: 'B' });
    await expect(service.updateCategory(a.id, { name: 'b' })).rejects.toThrow('trùng tên');
    expect((await service.updateCategory(a.id, { name: 'A', description: 'mô tả' })).description).toBe('mô tả');
  });

  it('từ chối tên rỗng hoặc quá dài', async () => {
    const { service } = await build();
    await expect(service.createCategory({ name: '   ' })).rejects.toThrow('Tên danh mục');
    await expect(service.createCategory({ name: 'x'.repeat(121) })).rejects.toThrow('Tên danh mục');
  });

  it('chỉ xóa được danh mục chưa từng có bài (bài đã gỡ vẫn được lưu)', async () => {
    const { service } = await build();
    const c = await service.createCategory({ name: 'Quy chế' });
    const post = await service.publish(actor, { categoryId: c.id, title: 'Quy chế làm việc' }, []);
    await expect(service.deleteCategory(c.id)).rejects.toThrow('còn bài đăng');
    await service.withdraw(post.id);
    await expect(service.deleteCategory(c.id)).rejects.toThrow('còn bài đăng');
    const empty = await service.createCategory({ name: 'Trống' });
    await service.deleteCategory(empty.id);
    expect((await service.listCategories()).map((x) => x.name)).toEqual(['Quy chế']);
  });
});

describe('DocumentService: bài đăng', () => {
  it('đăng bài kèm tệp, lưu tệp vào kho, tải về đúng nội dung và ghi nhật ký', async () => {
    const { service, storage, audit } = await build();
    const c = await service.createCategory({ name: 'Quy chế' });
    const post = await service.publish(actor, { categoryId: c.id, title: ' Quy chế làm việc ', summary: 'Áp dụng từ 01/10' }, [pdf()]);

    expect(post.title).toBe('Quy chế làm việc');
    expect(post.categoryName).toBe('Quy chế');
    expect(post.publishedByPersonId).toBe('p-1');
    expect(post.files).toHaveLength(1);
    expect(post.files[0]).not.toHaveProperty('storageKey');
    expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^documents/${post.id}/`));

    const { file, data } = await service.download(actor, post.id, post.files[0].id);
    expect(file.fileName).toBe('Quy chế.pdf');
    expect(data.toString()).toContain('%PDF');
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['document.post.publish', 'document.file.download']));
  });

  it('chặn tệp sai định dạng, đổi đuôi, quá 10 tệp; không ghi gì khi có tệp xấu', async () => {
    const { service, posts, storage } = await build();
    const c = await service.createCategory({ name: 'Quy chế' });
    const bad = { originalName: 'chay.exe', size: 5, buffer: Buffer.from('MZ123') };
    const fake = { originalName: 'gia.pdf', size: 5, buffer: Buffer.from('MZ123') };
    await expect(service.publish(actor, { categoryId: c.id, title: 'x' }, [pdf(), bad])).rejects.toThrow('định dạng');
    await expect(service.publish(actor, { categoryId: c.id, title: 'x' }, [fake])).rejects.toThrow('không khớp');
    await expect(service.publish(actor, { categoryId: c.id, title: 'x' }, Array.from({ length: 11 }, () => pdf()))).rejects.toThrow('tối đa 10');
    expect(posts.rows).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
  });

  it('kho tệp lỗi giữa chừng thì bài vừa tạo bị gỡ, không hiện trong bản tin', async () => {
    const { service, storage } = await build();
    const c = await service.createCategory({ name: 'Quy chế' });
    storage.failPut = true;
    await expect(service.publish(actor, { categoryId: c.id, title: 'x' }, [pdf()])).rejects.toThrow('kho tệp hỏng');
    expect((await service.search({})).total).toBe(0);
  });

  it('yêu cầu danh mục tồn tại và tiêu đề hợp lệ', async () => {
    const { service } = await build();
    await expect(service.publish(actor, { categoryId: 'khong-co', title: 'x' }, [])).rejects.toThrow('danh mục');
    const c = await service.createCategory({ name: 'Quy chế' });
    await expect(service.publish(actor, { categoryId: c.id, title: '  ' }, [])).rejects.toThrow('Tiêu đề');
    await expect(service.publish(actor, { categoryId: c.id, title: 'x', summary: 'y'.repeat(2001) }, [])).rejects.toThrow('Tóm tắt');
  });

  it('tìm theo từ khóa không dấu, theo danh mục, phân trang, mới nhất trước', async () => {
    const { service } = await build();
    const a = await service.createCategory({ name: 'Quy chế' });
    const b = await service.createCategory({ name: 'Biểu mẫu' });
    await service.publish(actor, { categoryId: a.id, title: 'Quy chế làm việc' }, []);
    await service.publish(actor, { categoryId: b.id, title: 'Mẫu đơn xin nghỉ phép', summary: 'Dùng khi nghỉ phép năm' }, []);
    await service.publish(actor, { categoryId: b.id, title: 'Mẫu báo cáo tháng' }, []);

    expect((await service.search({ q: 'nghi phep' })).items.map((p) => p.title)).toEqual(['Mẫu đơn xin nghỉ phép']);
    expect((await service.search({ categoryId: b.id })).items.map((p) => p.title)).toEqual(['Mẫu báo cáo tháng', 'Mẫu đơn xin nghỉ phép']);
    const page2 = await service.search({ pageSize: 2, page: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    await expect(service.search({ page: 0 })).rejects.toThrow('Trang');
    await expect(service.search({ pageSize: 101 })).rejects.toThrow('Cỡ trang');
  });

  it('sửa tiêu đề, tóm tắt, danh mục; gỡ bài thì không còn xem, tải, sửa được', async () => {
    const { service } = await build();
    const a = await service.createCategory({ name: 'Quy chế' });
    const b = await service.createCategory({ name: 'Biểu mẫu' });
    const post = await service.publish(actor, { categoryId: a.id, title: 'Cũ' }, [pdf()]);

    const edited = await service.update(post.id, { title: 'Mới', categoryId: b.id });
    expect(edited.title).toBe('Mới');
    expect(edited.categoryName).toBe('Biểu mẫu');
    await expect(service.update(post.id, {})).rejects.toThrow('Không có gì để sửa');
    await expect(service.update(post.id, { categoryId: 'khong-co' })).rejects.toThrow('danh mục');

    await service.withdraw(post.id);
    await expect(service.get(post.id)).rejects.toThrow('Không tìm thấy bài');
    await expect(service.download(actor, post.id, post.files[0].id)).rejects.toThrow('Không tìm thấy bài');
    await expect(service.update(post.id, { title: 'x' })).rejects.toThrow('Không tìm thấy bài');
    expect((await service.search({})).total).toBe(0);
  });

  it('không tải được tệp của bài khác qua mã bài khác', async () => {
    const { service } = await build();
    const c = await service.createCategory({ name: 'Quy chế' });
    const p1 = await service.publish(actor, { categoryId: c.id, title: 'Một' }, [pdf()]);
    const p2 = await service.publish(actor, { categoryId: c.id, title: 'Hai' }, []);
    await expect(service.download(actor, p2.id, p1.files[0].id)).rejects.toThrow('Không tìm thấy tệp');
  });
});

describe('DocumentService: thông báo (ADR-029)', () => {
  it('đăng bài báo mọi người có quyền xem tài liệu trừ người đăng; đăng lỗi thì không báo', async () => {
    const { service, notifier } = await build();
    const c = await service.createCategory({ name: 'Quy chế' });
    await service.publish(actor, { categoryId: c.id, title: 'Quy chế làm việc' }, []);
    expect(notifier.of('DOC_PUBLISHED')).toEqual([expect.objectContaining({ to: ['permission:document:read'], except: actor.personId, title: 'Tài liệu mới: Quy chế làm việc' })]);

    notifier.sent = [];
    await expect(service.publish(actor, { categoryId: c.id, title: '   ' }, [])).rejects.toThrow();
    expect(notifier.sent).toEqual([]);
  });
});
