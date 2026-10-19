import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notifier } from '../../../common/notifier.js';
import { AccountService, AuditService } from '../../security/index.js';
import { validateUpload } from './file-rules.js';
import type { UploadedFile } from './file-rules.js';
import { MAX_COMMENT_LENGTH, MAX_FILES_PER_ASSIGNMENT } from './tasking.model.js';
import type { AttachmentModel, CommentKind, CommentModel } from './tasking.model.js';
import { AttachmentRepository, CommentRepository, FileStorage } from './tasking.ports.js';
import { fold, TaskingService } from './tasking.service.js';
import type { Actor } from './tasking.service.js';

export { safeFileName } from './file-rules.js';
export type { UploadedFile } from './file-rules.js';

export interface FileSearchQuery {
  q?: string;
  uploaderPersonId?: string;
  /** Khoảng ngày tải lên, YYYY-MM-DD. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Một tệp trong màn "Tài liệu trong công việc", kèm việc chứa tệp. */
export interface TaskFile {
  id: string;
  assignmentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedByAccountId: string;
  uploadedByPersonId: string | null;
  taskTitle: string;
  catalogItemCode: string;
  assigneePersonId: string;
}

export interface FileSearchResult {
  items: TaskFile[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Conversation {
  comments: CommentModel[];
  attachments: AttachmentModel[];
}

/**
 * Trao đổi và tệp đính kèm trên một việc (ADR-024). Chỉ thành viên (người giao, người nhận, người duyệt, người tham vấn) viết
 * và tải lên; người có quyền xem toàn bộ chỉ đọc. Tin nhắn và tệp không sửa, không xóa.
 */
@Injectable()
export class CollaborationService {
  constructor(
    private readonly tasking: TaskingService,
    private readonly comments: CommentRepository,
    private readonly attachments: AttachmentRepository,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly notifier: Notifier,
  ) {}

  async conversation(actor: Actor, assignmentId: string, canReadAll: boolean): Promise<Conversation> {
    await this.requireAccess(actor, assignmentId, canReadAll, false);
    const [comments, attachments] = await Promise.all([this.comments.findByAssignment(assignmentId), this.attachments.findByAssignment(assignmentId)]);
    return { comments, attachments };
  }

  /**
   * Tệp của mọi việc mà người dùng là thành viên (ADR-025 mục 1); người xem toàn bộ thì thấy tất cả. Lọc theo từ khóa
   * (tên tệp, tên việc), người tải, khoảng ngày tải; mới nhất trước; phân trang.
   */
  async searchFiles(actor: Actor, query: FileSearchQuery, canReadAll: boolean): Promise<FileSearchResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('Trang phải là số nguyên từ 1');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('Cỡ trang từ 1 đến 100');
    for (const d of [query.from, query.to]) {
      if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('Ngày lọc có dạng YYYY-MM-DD');
    }

    const works = await this.tasking.memberWorks(actor, canReadAll);
    const files = await this.attachments.findByAssignments(works.map((w) => w.assignmentId));
    const workById = new Map(works.map((w) => [w.assignmentId, w]));
    const personOfAccount = new Map((await this.accounts.list()).map((a) => [a.id, a.personId]));
    const words = fold(query.q ?? '').split(/[\s,.;:]+/).filter(Boolean);

    const rows: TaskFile[] = files
      .map((f) => ({
        id: f.id,
        assignmentId: f.assignmentId,
        fileName: f.fileName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.uploadedAt,
        uploadedByPersonId: personOfAccount.get(f.uploadedByAccountId) ?? null,
        uploadedByAccountId: f.uploadedByAccountId,
        taskTitle: workById.get(f.assignmentId)?.taskTitle ?? '',
        catalogItemCode: workById.get(f.assignmentId)?.catalogItemCode ?? '',
        assigneePersonId: workById.get(f.assignmentId)?.assigneePersonId ?? '',
      }))
      .filter((r) => {
        if (query.uploaderPersonId && r.uploadedByPersonId !== query.uploaderPersonId) return false;
        const day = r.uploadedAt.toISOString().slice(0, 10);
        if (query.from && day < query.from) return false;
        if (query.to && day > query.to) return false;
        if (words.length > 0) {
          const haystack = fold(`${r.fileName} ${r.taskTitle} ${r.catalogItemCode}`);
          if (!words.every((w) => haystack.includes(w))) return false;
        }
        return true;
      })
      .sort((x, y) => y.uploadedAt.getTime() - x.uploadedAt.getTime());
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
  }

  async addComment(actor: Actor, assignmentId: string, input: { body: string; kind?: CommentKind }): Promise<CommentModel> {
    const roles = await this.requireAccess(actor, assignmentId, false, true);
    const body = input.body.trim();
    if (body.length < 1 || body.length > MAX_COMMENT_LENGTH) throw new BadRequestException(`Tin nhắn dài từ 1 đến ${MAX_COMMENT_LENGTH} ký tự`);
    const kind = input.kind ?? 'MESSAGE';
    if (kind !== 'MESSAGE' && kind !== 'OPINION') throw new BadRequestException('Loại tin nhắn là MESSAGE hoặc OPINION');
    if (kind === 'OPINION' && !roles.consultant) throw new ForbiddenException('Chỉ người tham vấn mới gửi được ý kiến tham vấn');

    const created = await this.comments.create({ assignmentId, authorAccountId: actor.id, authorPersonId: actor.personId, kind, body });
    await this.audit.record({
      action: 'tasking.comment.create',
      outcome: 'SUCCESS',
      targetType: 'work_comment',
      targetId: created.id,
      details: { assignmentId, kind, length: body.length },
    });
    const assignment = await this.tasking.requireExisting(assignmentId);
    await this.notifier.notify(await this.tasking.participantsOf(assignment, actor.personId), {
      type: 'TASK_COMMENT',
      title: `${kind === 'OPINION' ? 'Có ý kiến tham vấn mới' : 'Có tin nhắn mới'} trong việc: ${await this.tasking.titleOf(assignment)}`,
      link: `/tasks?open=${assignmentId}`,
    });
    return created;
  }

  /** Tải một tệp lên việc, hoặc gắn vào tin nhắn của chính người tải (`commentId`). */
  async upload(actor: Actor, assignmentId: string, file: UploadedFile, commentId?: string | null): Promise<AttachmentModel> {
    await this.requireAccess(actor, assignmentId, false, true);
    const { fileName, contentType } = validateUpload(file);
    if ((await this.attachments.findByAssignment(assignmentId)).length >= MAX_FILES_PER_ASSIGNMENT) {
      throw new ConflictException(`Mỗi việc tối đa ${MAX_FILES_PER_ASSIGNMENT} tệp`);
    }
    if (commentId) {
      const comment = await this.comments.findById(commentId);
      if (!comment || comment.assignmentId !== assignmentId) throw new NotFoundException('Không tìm thấy tin nhắn để gắn tệp');
      if (comment.authorAccountId !== actor.id) throw new ForbiddenException('Chỉ gắn tệp vào tin nhắn của chính mình');
    }

    const storageKey = `assignments/${assignmentId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    const created = await this.attachments.create({
      assignmentId,
      commentId: commentId ?? null,
      fileName,
      contentType,
      sizeBytes: file.buffer.length,
      storageKey,
      uploadedByAccountId: actor.id,
    });
    await this.audit.record({
      action: 'tasking.attachment.upload',
      outcome: 'SUCCESS',
      targetType: 'work_attachment',
      targetId: created.id,
      details: { assignmentId, fileName, sizeBytes: created.sizeBytes },
    });
    return created;
  }

  async download(actor: Actor, assignmentId: string, attachmentId: string, canReadAll: boolean): Promise<{ attachment: AttachmentModel; data: Buffer }> {
    await this.requireAccess(actor, assignmentId, canReadAll, false);
    const attachment = await this.attachments.findById(attachmentId);
    if (!attachment || attachment.assignmentId !== assignmentId) throw new NotFoundException('Không tìm thấy tệp');
    const data = await this.storage.get(attachment.storageKey);
    await this.audit.record({
      action: 'tasking.attachment.download',
      outcome: 'SUCCESS',
      targetType: 'work_attachment',
      targetId: attachmentId,
      details: { assignmentId, fileName: attachment.fileName, sizeBytes: attachment.sizeBytes },
    });
    return { attachment, data };
  }

  /**
   * Quyền truy cập trao đổi và tệp: thành viên được đọc và ghi; người có quyền xem toàn bộ chỉ được đọc.
   * Trả về vai trò của người thao tác.
   */
  private async requireAccess(actor: Actor, assignmentId: string, canReadAll: boolean, write: boolean) {
    const assignment = await this.tasking.requireExisting(assignmentId);
    const roles = await this.tasking.membership(actor, assignment);
    const member = roles.assigner || roles.assignee || roles.approver || roles.consultant;
    if (member) return roles;
    if (!write && canReadAll) return roles;
    throw new ForbiddenException(write ? 'Chỉ thành viên của việc mới trao đổi và tải tệp' : 'Chỉ thành viên của việc mới xem trao đổi và tệp');
  }
}
