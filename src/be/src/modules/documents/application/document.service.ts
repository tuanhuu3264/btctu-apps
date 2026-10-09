import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Notifier } from '../../../common/notifier.js';
import { AccountService, AuditService } from '../../security/index.js';
import { FileStorage, validateUpload } from '../../tasking/index.js';
import type { UploadedFile } from '../../tasking/index.js';
import { MAX_CATEGORY_DESCRIPTION_LENGTH, MAX_CATEGORY_NAME_LENGTH, MAX_FILES_PER_POST, MAX_SUMMARY_LENGTH, MAX_TITLE_LENGTH } from './document.model.js';
import type { CategoryModel, PostFileModel, PostModel } from './document.model.js';
import { CategoryRepository, PostFileRepository, PostRepository } from './document.ports.js';

export interface DocActor {
  id: string;
  username: string;
  personId: string | null;
}

/** Tệp của bài trả cho trình duyệt: không lộ khóa lưu trữ nội bộ. */
export type PublicPostFile = Omit<PostFileModel, 'storageKey'>;

export interface PostView extends Omit<PostModel, 'publishedByAccountId'> {
  categoryName: string;
  publishedByPersonId: string | null;
  files: PublicPostFile[];
}

export interface CategoryView extends CategoryModel {
  postCount: number;
}

export interface PostSearchQuery {
  q?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
}

export interface PostSearchResult {
  items: PostView[];
  total: number;
  page: number;
  pageSize: number;
}

const toPublicFile = ({ storageKey: _storageKey, ...rest }: PostFileModel): PublicPostFile => rest;

/** Bỏ dấu, chữ thường, để tìm không cần gõ dấu tiếng Việt. */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/**
 * Danh mục tài liệu và bản tin tài liệu (ADR-025). Quyền `document:read` và `document:manage` do controller kiểm tra;
 * lớp này giữ quy tắc dữ liệu: danh mục không trùng tên, chỉ xóa danh mục rỗng, tệp hợp lệ, bài gỡ thì ẩn.
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly posts: PostRepository,
    private readonly files: PostFileRepository,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly notifier: Notifier,
  ) {}

  // ---- Danh mục ----

  async listCategories(): Promise<CategoryView[]> {
    const [rows, counts] = await Promise.all([this.categories.findAll(), this.posts.countByCategory()]);
    return rows.map((c) => ({ ...c, postCount: counts.get(c.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  async createCategory(input: { name: string; description?: string | null }): Promise<CategoryModel> {
    const created = await this.categories.create(await this.cleanCategory(input, null));
    await this.audit.record({ action: 'document.category.create', outcome: 'SUCCESS', targetType: 'document_category', targetId: created.id, details: { name: created.name } });
    return created;
  }

  async updateCategory(id: string, input: { name: string; description?: string | null }): Promise<CategoryModel> {
    await this.requireCategory(id);
    const updated = await this.categories.update(id, await this.cleanCategory(input, id));
    await this.audit.record({ action: 'document.category.update', outcome: 'SUCCESS', targetType: 'document_category', targetId: id, details: { name: updated.name } });
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await this.requireCategory(id);
    if (await this.posts.existsInCategory(id)) throw new ConflictException('Danh mục còn bài đăng (kể cả bài đã gỡ), không xóa được');
    await this.categories.delete(id);
    await this.audit.record({ action: 'document.category.delete', outcome: 'SUCCESS', targetType: 'document_category', targetId: id, details: { name: category.name } });
  }

  // ---- Bài đăng ----

  /** Đăng bài kèm 0 đến 10 tệp. Kiểm tra mọi tệp trước khi ghi gì; lỗi kho tệp giữa chừng thì gỡ bài vừa tạo. */
  async publish(actor: DocActor, input: { categoryId: string; title: string; summary?: string }, uploads: UploadedFile[]): Promise<PostView> {
    await this.requireCategory(input.categoryId);
    const title = this.cleanTitle(input.title);
    const summary = this.cleanSummary(input.summary);
    if (uploads.length > MAX_FILES_PER_POST) throw new BadRequestException(`Mỗi bài tối đa ${MAX_FILES_PER_POST} tệp`);
    const checked = uploads.map((upload) => ({ upload, ...validateUpload(upload) }));

    const post = await this.posts.create({ categoryId: input.categoryId, title, summary, publishedByAccountId: actor.id });
    try {
      for (const f of checked) {
        const storageKey = `documents/${post.id}/${randomUUID()}`;
        await this.storage.put(storageKey, f.upload.buffer, f.contentType);
        await this.files.create({ postId: post.id, fileName: f.fileName, contentType: f.contentType, sizeBytes: f.upload.buffer.length, storageKey });
      }
    } catch (e) {
      await this.posts.update(post.id, { status: 'WITHDRAWN' });
      throw e;
    }
    await this.audit.record({
      action: 'document.post.publish',
      outcome: 'SUCCESS',
      targetType: 'document_post',
      targetId: post.id,
      details: { title, categoryId: input.categoryId, files: checked.length },
    });
    await this.notifier.notifyPermitted('document:read', actor.personId, { type: 'DOC_PUBLISHED', title: `Tài liệu mới: ${title}`, link: '/documents' });
    return (await this.views([post]))[0];
  }

  async update(id: string, input: { title?: string; summary?: string; categoryId?: string }): Promise<PostView> {
    const post = await this.requirePublished(id);
    const patch: { title?: string; summary?: string; categoryId?: string } = {};
    if (input.title !== undefined) patch.title = this.cleanTitle(input.title);
    if (input.summary !== undefined) patch.summary = this.cleanSummary(input.summary);
    if (input.categoryId !== undefined && input.categoryId !== post.categoryId) {
      await this.requireCategory(input.categoryId);
      patch.categoryId = input.categoryId;
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Không có gì để sửa');
    const updated = await this.posts.update(id, patch);
    await this.audit.record({ action: 'document.post.update', outcome: 'SUCCESS', targetType: 'document_post', targetId: id, details: { changed: Object.keys(patch) } });
    return (await this.views([updated]))[0];
  }

  /** Gỡ bài khỏi bản tin (ẩn, vẫn lưu). */
  async withdraw(id: string): Promise<void> {
    const post = await this.requirePublished(id);
    await this.posts.update(id, { status: 'WITHDRAWN' });
    await this.audit.record({ action: 'document.post.withdraw', outcome: 'SUCCESS', targetType: 'document_post', targetId: id, details: { title: post.title } });
  }

  async search(query: PostSearchQuery): Promise<PostSearchResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('Trang phải là số nguyên từ 1');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('Cỡ trang từ 1 đến 100');

    const words = fold(query.q ?? '').split(/[\s,.;:]+/).filter(Boolean);
    const all = await this.posts.findPublished();
    const names = new Map((await this.categories.findAll()).map((c) => [c.id, c.name]));
    const matched = all.filter((p) => {
      if (query.categoryId && p.categoryId !== query.categoryId) return false;
      if (words.length === 0) return true;
      const haystack = fold(`${p.title} ${p.summary} ${names.get(p.categoryId) ?? ''}`);
      return words.every((w) => haystack.includes(w));
    });
    const items = await this.views(matched.slice((page - 1) * pageSize, page * pageSize));
    return { items, total: matched.length, page, pageSize };
  }

  async get(id: string): Promise<PostView> {
    return (await this.views([await this.requirePublished(id)]))[0];
  }

  async download(actor: DocActor, postId: string, fileId: string): Promise<{ file: PostFileModel; data: Buffer }> {
    await this.requirePublished(postId);
    const file = await this.files.findById(fileId);
    if (!file || file.postId !== postId) throw new NotFoundException('Không tìm thấy tệp');
    const data = await this.storage.get(file.storageKey);
    await this.audit.record({
      action: 'document.file.download',
      outcome: 'SUCCESS',
      targetType: 'document_file',
      targetId: fileId,
      details: { postId, fileName: file.fileName, sizeBytes: file.sizeBytes, by: actor.username },
    });
    return { file, data };
  }

  // ---- nội bộ ----

  private async views(rows: PostModel[]): Promise<PostView[]> {
    if (rows.length === 0) return [];
    const [files, categories, accounts] = await Promise.all([this.files.findByPosts(rows.map((r) => r.id)), this.categories.findAll(), this.accounts.list()]);
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const personOf = new Map(accounts.map((a) => [a.id, a.personId]));
    return rows.map(({ publishedByAccountId, ...post }) => ({
      ...post,
      categoryName: categoryName.get(post.categoryId) ?? '',
      publishedByPersonId: personOf.get(publishedByAccountId) ?? null,
      files: files.filter((f) => f.postId === post.id).map(toPublicFile),
    }));
  }

  private async requireCategory(id: string): Promise<CategoryModel> {
    const category = await this.categories.findById(id);
    if (!category) throw new NotFoundException('Không tìm thấy danh mục tài liệu');
    return category;
  }

  /** Bài đã gỡ coi như không tồn tại với mọi người. */
  private async requirePublished(id: string): Promise<PostModel> {
    const post = await this.posts.findById(id);
    if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('Không tìm thấy bài đăng');
    return post;
  }

  private async cleanCategory(input: { name: string; description?: string | null }, selfId: string | null) {
    const name = input.name.trim();
    if (name.length < 1 || name.length > MAX_CATEGORY_NAME_LENGTH) throw new BadRequestException(`Tên danh mục dài từ 1 đến ${MAX_CATEGORY_NAME_LENGTH} ký tự`);
    const description = input.description?.trim() || null;
    if (description && description.length > MAX_CATEGORY_DESCRIPTION_LENGTH) throw new BadRequestException(`Mô tả tối đa ${MAX_CATEGORY_DESCRIPTION_LENGTH} ký tự`);
    const same = await this.categories.findByName(name);
    if (same && same.id !== selfId) throw new ConflictException('Đã có danh mục trùng tên');
    return { name, description };
  }

  private cleanTitle(raw: string): string {
    const title = raw.trim();
    if (title.length < 1 || title.length > MAX_TITLE_LENGTH) throw new BadRequestException(`Tiêu đề dài từ 1 đến ${MAX_TITLE_LENGTH} ký tự`);
    return title;
  }

  private cleanSummary(raw: string | undefined): string {
    const summary = (raw ?? '').trim();
    if (summary.length > MAX_SUMMARY_LENGTH) throw new BadRequestException(`Tóm tắt tối đa ${MAX_SUMMARY_LENGTH} ký tự`);
    return summary;
  }
}
