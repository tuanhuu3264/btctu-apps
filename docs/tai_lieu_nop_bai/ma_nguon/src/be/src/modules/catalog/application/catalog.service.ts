import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { coefficientOf, DEFAULT_TASK_NAME, GROUP_CODE_PATTERN, ITEM_CODE_PATTERN, MAX_COMPLEXITY, MAX_GROUPS, MIN_COMPLEXITY } from './catalog.model.js';
import type {
  CatalogItemModel,
  CatalogItemPatch,
  CatalogGroupModel,
  CatalogItemView,
  CatalogScope,
  CatalogTaskModel,
  CatalogTaskPatch,
  CatalogVersionModel,
  CatalogVersionView,
  DurationMode,
  DurationUnit,
  NewCatalogItem,
} from './catalog.model.js';
import { CatalogGroupRepository, CatalogItemRepository, CatalogScopeRepository, CatalogTaskRepository, CatalogVersionRepository, OrgDirectory } from './catalog.ports.js';

export interface AddItemInput {
  /** Bỏ trống khi có `taskId`: máy chủ tự sinh mã tiếp theo của nhóm. */
  code?: string;
  /** Nhiệm vụ chứa công việc. Bỏ trống thì vào nhiệm vụ mặc định của nhóm theo mã (ADR-019 mục 4). */
  taskId?: string;
  name: string;
  productUnits?: string | null;
  complexity: number;
  durationMode: DurationMode;
  durationValue?: number | null;
  durationUnit?: DurationUnit | null;
  points?: number | null;
  explanation?: string | null;
  sortOrder?: number;
}

export interface CreateVersionInput {
  /** Tên danh mục. Bỏ trống thì lấy tên của bản sao chép, hoặc nhãn nếu tạo bản trống. */
  name?: string;
  label: string;
  /** Sao chép toàn bộ công việc (và công việc chuẩn) từ một phiên bản có sẵn. */
  copyFromVersionId?: string;
  sourceNote?: string | null;
}

/**
 * Danh mục sản phẩm công việc chuẩn (ADR-013). Bản nháp sửa tự do; bản đã phê duyệt bất biến.
 * Hệ số quy đổi luôn tính khi đọc từ điểm chấm và điểm của công việc chuẩn.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly versions: CatalogVersionRepository,
    private readonly items: CatalogItemRepository,
    private readonly tasks: CatalogTaskRepository,
    private readonly scopes: CatalogScopeRepository,
    private readonly org: OrgDirectory,
    private readonly groups: CatalogGroupRepository,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  listVersions(): Promise<CatalogVersionModel[]> {
    return this.versions.findAll();
  }

  async getVersion(id: string): Promise<CatalogVersionView> {
    return this.view(await this.requireVersion(id));
  }

  /** Phiên bản đã phê duyệt đang có hiệu lực: bản có thời điểm hiệu lực muộn nhất không quá hiện tại. */
  async current(): Promise<CatalogVersionView> {
    const now = this.clock.now();
    const effective = (await this.versions.findAll())
      .filter((v) => v.status === 'APPROVED' && v.effectiveFrom && v.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom!.getTime() - a.effectiveFrom!.getTime());
    if (effective.length === 0) throw new NotFoundException('Chưa có danh mục nào được phê duyệt và đang có hiệu lực');
    return this.view(effective[0]);
  }

  async createVersion(input: CreateVersionInput): Promise<CatalogVersionModel> {
    const label = input.label.trim();
    if (label.length < 3 || label.length > 120) throw new BadRequestException('Nhãn phiên bản gồm 3–120 ký tự');
    if (await this.versions.findByLabel(label)) throw new ConflictException(`Nhãn phiên bản đã tồn tại: ${label}`);

    const source = input.copyFromVersionId ? await this.requireVersion(input.copyFromVersionId) : null;
    const created = await this.versions.create({
      name: normalizeVersionName(input.name ?? source?.name ?? label),
      label,
      baselineItemCode: source?.baselineItemCode ?? null,
      sourceNote: input.sourceNote ?? (source ? `Sao chép từ "${source.label}"` : null),
    });
    if (source) {
      // Sao chép nhiệm vụ trước, rồi công việc với quan hệ được giữ nguyên.
      const taskIds = new Map<string, string>();
      for (const task of await this.tasks.findByVersion(source.id)) {
        const { id, versionId: _versionId, status, inactiveAt, inactiveReason, ...rest } = task;
        const copy = await this.tasks.create({ ...rest, versionId: created.id });
        if (status === 'INACTIVE') await this.tasks.setStatus(copy.id, { status, inactiveAt, inactiveReason });
        taskIds.set(id, copy.id);
      }
      const itemIds = new Map<string, string>();
      for (const item of await this.items.findByVersion(source.id)) {
        const { id, versionId: _versionId, taskId, status, inactiveAt, inactiveReason, ...rest } = item;
        const copy = await this.items.create({ ...rest, versionId: created.id, taskId: taskIds.get(taskId)! });
        if (status === 'INACTIVE') await this.items.setStatus(copy.id, { status, inactiveAt, inactiveReason });
        itemIds.set(id, copy.id);
      }
      await this.scopes.createMany(
        (await this.scopes.findByVersion(source.id)).flatMap((s) => (itemIds.has(s.itemId) ? [{ ...s, itemId: itemIds.get(s.itemId)! }] : [])),
      );
    }
    await this.audit.record({
      action: 'catalog.version.create',
      outcome: 'SUCCESS',
      targetType: 'catalog_version',
      targetId: created.id,
      details: { label, name: created.name, copiedFrom: source?.label ?? null },
    });
    return created;
  }

  /** Gán phạm vi áp dụng cho một công việc của bản nháp (ADR-021). Rỗng cả hai danh sách là việc chung. */
  async setItemScope(itemId: string, scope: CatalogScope): Promise<CatalogScope> {
    const item = await this.requireItem(itemId);
    await this.requireDraft(item.versionId);
    const clean = await this.checkScope(scope);
    await this.scopes.replace([itemId], clean);
    await this.audit.record({
      action: 'catalog.item.scope',
      outcome: 'SUCCESS',
      targetType: 'catalog_item',
      targetId: itemId,
      details: { versionId: item.versionId, code: item.code, units: clean.unitIds.length, positions: clean.positionIds.length },
    });
    return clean;
  }

  /** Gán cùng một phạm vi cho mọi công việc của một nhiệm vụ (thay thế phạm vi cũ). Trả về số công việc được gán. */
  async setTaskScope(taskId: string, scope: CatalogScope): Promise<{ items: number; scope: CatalogScope }> {
    const task = await this.requireTask(taskId);
    await this.requireDraft(task.versionId);
    const clean = await this.checkScope(scope);
    const itemIds = (await this.items.findByVersion(task.versionId)).filter((i) => i.taskId === taskId).map((i) => i.id);
    await this.scopes.replace(itemIds, clean);
    await this.audit.record({
      action: 'catalog.task.scope',
      outcome: 'SUCCESS',
      targetType: 'catalog_task',
      targetId: taskId,
      details: { versionId: task.versionId, name: task.name, items: itemIds.length, units: clean.unitIds.length, positions: clean.positionIds.length },
    });
    return { items: itemIds.length, scope: clean };
  }

  /** Bỏ trùng và kiểm tra các mã đơn vị, vị trí có tồn tại. */
  private async checkScope(scope: CatalogScope): Promise<CatalogScope> {
    const unitIds = [...new Set(scope.unitIds)];
    const positionIds = [...new Set(scope.positionIds)];
    const [units, positions] = await Promise.all([this.org.unitIds(), this.org.positionIds()]);
    const missingUnit = unitIds.find((u) => !units.has(u));
    if (missingUnit) throw new BadRequestException(`Không có đơn vị: ${missingUnit}`);
    const missingPosition = positionIds.find((p) => !positions.has(p));
    if (missingPosition) throw new BadRequestException(`Không có vị trí việc làm: ${missingPosition}`);
    return { unitIds, positionIds };
  }

  /**
   * Thêm nhóm công việc dùng chung cho mọi phiên bản (ADR-020). Bỏ trống `code` thì lấy chữ cái kế tiếp còn trống.
   */
  async createGroup(input: { code?: string; name: string }): Promise<CatalogGroupModel> {
    const name = normalizeGroupName(input.name);
    const groups = await this.groups.findAll();
    if (groups.length >= MAX_GROUPS) throw new ConflictException(`Đã có ${MAX_GROUPS} nhóm, không thêm được nữa`);
    const code = input.code?.toUpperCase() ?? nextGroupCode(groups);
    if (!GROUP_CODE_PATTERN.test(code)) throw new BadRequestException('Mã nhóm là một chữ cái từ A đến Z');
    if (groups.some((g) => g.code === code)) throw new ConflictException(`Mã nhóm ${code} đã có`);
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new ConflictException(`Đã có nhóm tên "${name}"`);

    const group: CatalogGroupModel = { code, name, sortOrder: Math.max(0, ...groups.map((g) => g.sortOrder)) + 1 };
    await this.groups.upsert(group);
    await this.audit.record({
      action: 'catalog.group.create',
      outcome: 'SUCCESS',
      targetType: 'catalog_group',
      targetId: code,
      details: { code, name },
    });
    return group;
  }

  /** Sửa tên nhóm (mã không đổi). Tên dùng chung nên cũng đổi cách hiển thị ở các phiên bản đã phê duyệt. */
  async renameGroup(code: string, nameInput: string): Promise<CatalogGroupModel> {
    const group = await this.requireGroup(code);
    const name = normalizeGroupName(nameInput);
    const others = (await this.groups.findAll()).filter((g) => g.code !== code);
    if (others.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new ConflictException(`Đã có nhóm tên "${name}"`);
    const updated = await this.groups.rename(code, name);
    await this.audit.record({
      action: 'catalog.group.rename',
      outcome: 'SUCCESS',
      targetType: 'catalog_group',
      targetId: code,
      details: { code, before: group.name, after: name },
    });
    return updated;
  }

  /** Chỉ xóa được nhóm chưa có nhiệm vụ hay công việc nào ở bất kỳ phiên bản nào. */
  async deleteGroup(code: string): Promise<void> {
    const group = await this.requireGroup(code);
    if ((await this.tasks.countByGroup(code)) > 0 || (await this.items.countByGroup(code)) > 0) {
      throw new ConflictException(`Nhóm ${code} còn nhiệm vụ hoặc công việc (ở một phiên bản nào đó) nên chưa xóa được`);
    }
    await this.groups.delete(code);
    await this.audit.record({
      action: 'catalog.group.delete',
      outcome: 'SUCCESS',
      targetType: 'catalog_group',
      targetId: code,
      details: { code, name: group.name },
    });
  }

  /** Đổi tên danh mục của bản nháp. Nhãn phiên bản không đổi (là mã định danh duy nhất). */
  async renameVersion(versionId: string, name: string): Promise<CatalogVersionModel> {
    const version = await this.requireDraft(versionId);
    const next = normalizeVersionName(name);
    const updated = await this.versions.rename(versionId, next);
    await this.audit.record({
      action: 'catalog.version.rename',
      outcome: 'SUCCESS',
      targetType: 'catalog_version',
      targetId: versionId,
      details: { label: version.label, before: version.name, after: next },
    });
    return updated;
  }

  async addItem(versionId: string, input: AddItemInput): Promise<CatalogItemModel> {
    await this.requireDraft(versionId);
    const existing = await this.items.findByVersion(versionId);

    let task: CatalogTaskModel | null = null;
    if (input.taskId) {
      task = await this.requireTask(input.taskId);
      if (task.versionId !== versionId) throw new BadRequestException('Nhiệm vụ không thuộc phiên bản này');
      if (task.status !== 'ACTIVE') throw new ConflictException('Nhiệm vụ đã ngừng sử dụng');
    }
    if (input.code === undefined && task === null) throw new BadRequestException('Cần chọn nhiệm vụ hoặc nhập mã công việc');
    const code = input.code ?? nextCode(task!.groupCode, existing);

    if (existing.some((i) => i.code === code)) {
      throw new ConflictException(`Mã công việc đã có trong phiên bản này: ${code}`);
    }
    if (!ITEM_CODE_PATTERN.test(code)) {
      throw new BadRequestException('Mã công việc có dạng A.001 (chữ cái nhóm A–D, dấu chấm, 3 chữ số)');
    }
    const groupCode = code[0];
    if (!(await this.groups.findAll()).some((g) => g.code === groupCode)) {
      throw new BadRequestException(`Chưa có nhóm công việc ${groupCode}`);
    }
    if (task && task.groupCode !== groupCode) {
      throw new BadRequestException(`Mã ${code} không thuộc nhóm ${task.groupCode} của nhiệm vụ "${task.name}"`);
    }
    task ??= await this.defaultTask(versionId, groupCode);

    const item: NewCatalogItem = {
      versionId,
      taskId: task.id,
      code,
      groupCode,
      name: input.name.trim(),
      productUnits: input.productUnits ?? null,
      complexity: input.complexity,
      durationMode: input.durationMode,
      durationValue: input.durationValue ?? null,
      durationUnit: input.durationUnit ?? null,
      points: input.points ?? null,
      explanation: input.explanation ?? null,
      sortOrder: input.sortOrder ?? Math.max(0, ...existing.map((i) => i.sortOrder)) + 1,
    };
    this.assertItem(item);

    const created = await this.items.create(item);
    await this.audit.record({
      action: 'catalog.item.create',
      outcome: 'SUCCESS',
      targetType: 'catalog_item',
      targetId: created.id,
      details: { versionId, code: created.code, taskId: task.id, points: created.points },
    });
    return created;
  }

  async updateItem(itemId: string, patch: CatalogItemPatch): Promise<CatalogItemModel> {
    const item = await this.requireItem(itemId);
    const version = await this.requireDraft(item.versionId);
    if (patch.taskId !== undefined) {
      const target = await this.requireTask(patch.taskId);
      if (target.versionId !== item.versionId || target.groupCode !== item.groupCode) {
        throw new BadRequestException('Chỉ chuyển công việc sang nhiệm vụ cùng nhóm, cùng phiên bản');
      }
      if (target.status !== 'ACTIVE') throw new ConflictException('Nhiệm vụ đã ngừng sử dụng');
    }
    if (patch.durationMode !== undefined && patch.durationMode !== 'LIMITED') {
      // Đổi sang "Thực tế" hoặc bỏ trống thì giá trị và đơn vị không còn nghĩa.
      patch = { ...patch, durationValue: null, durationUnit: null };
    }
    const after: CatalogItemModel = { ...item, ...patch };
    this.assertItem(after);
    if (version.baselineItemCode === item.code && (after.points === null || after.points <= 0)) {
      throw new ConflictException('Công việc đang là công việc chuẩn, điểm chấm phải lớn hơn 0');
    }

    const before = pick(item, patch); // chụp trước khi cập nhật, không phụ thuộc kho dữ liệu trả về bản sao mới
    const updated = await this.items.update(itemId, patch);
    await this.audit.record({
      action: 'catalog.item.update',
      outcome: 'SUCCESS',
      targetType: 'catalog_item',
      targetId: itemId,
      details: {
        versionId: item.versionId,
        code: item.code,
        changed: Object.keys(patch),
        before,
        after: pick(updated, patch),
      },
    });
    return updated;
  }

  /** "Xóa" công việc của bản nháp = chuyển sang INACTIVE (mã được giữ, không dùng lại). */
  async deactivateItem(itemId: string, reason?: string): Promise<CatalogItemModel> {
    const item = await this.requireItem(itemId);
    const version = await this.requireDraft(item.versionId);
    if (item.status === 'INACTIVE') throw new ConflictException('Công việc đã ngừng sử dụng');
    if (version.baselineItemCode === item.code) {
      throw new ConflictException('Không ngừng được công việc chuẩn, hãy chọn công việc chuẩn khác trước');
    }
    const note = reason?.trim() || null;
    const updated = await this.items.setStatus(itemId, { status: 'INACTIVE', inactiveAt: this.clock.now(), inactiveReason: note });
    await this.audit.record({
      action: 'catalog.item.deactivate',
      outcome: 'SUCCESS',
      targetType: 'catalog_item',
      targetId: itemId,
      details: { versionId: item.versionId, code: item.code, reason: note },
    });
    return updated;
  }

  /** Kích hoạt lại công việc của bản nháp; nhiệm vụ chứa nó phải đang hoạt động. */
  async reactivateItem(itemId: string): Promise<CatalogItemModel> {
    const item = await this.requireItem(itemId);
    await this.requireDraft(item.versionId);
    if (item.status === 'ACTIVE') throw new ConflictException('Công việc đang hoạt động');
    if ((await this.requireTask(item.taskId)).status !== 'ACTIVE') {
      throw new ConflictException('Nhiệm vụ chứa công việc đã ngừng sử dụng; hãy kích hoạt nhiệm vụ trước');
    }
    const updated = await this.items.setStatus(itemId, { status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    await this.audit.record({
      action: 'catalog.item.reactivate',
      outcome: 'SUCCESS',
      targetType: 'catalog_item',
      targetId: itemId,
      details: { versionId: item.versionId, code: item.code },
    });
    return updated;
  }

  /** Tạo nhiệm vụ trong một nhóm của bản nháp. Tên không trùng (không phân biệt hoa thường) trong cùng nhóm. */
  async createTask(versionId: string, input: { groupCode: string; name: string; description?: string | null }): Promise<CatalogTaskModel> {
    await this.requireDraft(versionId);
    if (!(await this.groups.findAll()).some((g) => g.code === input.groupCode)) {
      throw new BadRequestException(`Chưa có nhóm công việc ${input.groupCode}`);
    }
    const name = normalizeTaskName(input.name);
    const existing = await this.tasks.findByVersion(versionId);
    if (existing.some((t) => t.groupCode === input.groupCode && t.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`Nhóm ${input.groupCode} đã có nhiệm vụ "${name}"`);
    }
    const created = await this.tasks.create({
      versionId,
      groupCode: input.groupCode,
      name,
      description: input.description?.trim() || null,
      sortOrder: Math.max(0, ...existing.map((t) => t.sortOrder)) + 1,
    });
    await this.audit.record({
      action: 'catalog.task.create',
      outcome: 'SUCCESS',
      targetType: 'catalog_task',
      targetId: created.id,
      details: { versionId, groupCode: created.groupCode, name },
    });
    return created;
  }

  async updateTask(taskId: string, patch: CatalogTaskPatch): Promise<CatalogTaskModel> {
    const task = await this.requireTask(taskId);
    await this.requireDraft(task.versionId);
    const next: CatalogTaskPatch = {};
    if (patch.name !== undefined) {
      next.name = normalizeTaskName(patch.name);
      const siblings = (await this.tasks.findByVersion(task.versionId)).filter((t) => t.id !== task.id && t.groupCode === task.groupCode);
      if (siblings.some((t) => t.name.toLowerCase() === next.name!.toLowerCase())) {
        throw new ConflictException(`Nhóm ${task.groupCode} đã có nhiệm vụ "${next.name}"`);
      }
    }
    if (patch.description !== undefined) next.description = patch.description?.trim() || null;

    const before = { name: task.name, description: task.description };
    const updated = await this.tasks.update(taskId, next);
    await this.audit.record({
      action: 'catalog.task.update',
      outcome: 'SUCCESS',
      targetType: 'catalog_task',
      targetId: taskId,
      details: { versionId: task.versionId, groupCode: task.groupCode, before, after: { name: updated.name, description: updated.description } },
    });
    return updated;
  }

  /** "Xóa" nhiệm vụ của bản nháp = chuyển sang INACTIVE; chỉ được khi không còn công việc đang hoạt động. */
  async deactivateTask(taskId: string, reason?: string): Promise<CatalogTaskModel> {
    const task = await this.requireTask(taskId);
    await this.requireDraft(task.versionId);
    if (task.status === 'INACTIVE') throw new ConflictException('Nhiệm vụ đã ngừng sử dụng');
    if ((await this.items.findByVersion(task.versionId)).some((i) => i.taskId === taskId && i.status === 'ACTIVE')) {
      throw new ConflictException('Nhiệm vụ còn công việc đang hoạt động, hãy chuyển hoặc ngừng các công việc trước');
    }
    const note = reason?.trim() || null;
    const updated = await this.tasks.setStatus(taskId, { status: 'INACTIVE', inactiveAt: this.clock.now(), inactiveReason: note });
    await this.audit.record({
      action: 'catalog.task.deactivate',
      outcome: 'SUCCESS',
      targetType: 'catalog_task',
      targetId: taskId,
      details: { versionId: task.versionId, groupCode: task.groupCode, name: task.name, reason: note },
    });
    return updated;
  }

  async reactivateTask(taskId: string): Promise<CatalogTaskModel> {
    const task = await this.requireTask(taskId);
    await this.requireDraft(task.versionId);
    if (task.status === 'ACTIVE') throw new ConflictException('Nhiệm vụ đang hoạt động');
    const updated = await this.tasks.setStatus(taskId, { status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    await this.audit.record({
      action: 'catalog.task.reactivate',
      outcome: 'SUCCESS',
      targetType: 'catalog_task',
      targetId: taskId,
      details: { versionId: task.versionId, groupCode: task.groupCode, name: task.name },
    });
    return updated;
  }

  async setBaseline(versionId: string, itemCode: string): Promise<CatalogVersionView> {
    const version = await this.requireDraft(versionId);
    const item = (await this.items.findByVersion(versionId)).find((i) => i.code === itemCode);
    if (!item) throw new NotFoundException(`Không có công việc ${itemCode} trong phiên bản này`);
    if (item.status !== 'ACTIVE') throw new ConflictException('Công việc đã ngừng sử dụng, không làm công việc chuẩn được');
    if (item.points === null || item.points <= 0) {
      throw new ConflictException('Công việc chuẩn phải có điểm chấm lớn hơn 0');
    }
    await this.versions.setBaseline(versionId, itemCode);
    await this.audit.record({
      action: 'catalog.baseline.set',
      outcome: 'SUCCESS',
      targetType: 'catalog_version',
      targetId: versionId,
      details: { label: version.label, previous: version.baselineItemCode, baseline: itemCode, baselinePoints: item.points },
    });
    return this.getVersion(versionId);
  }

  /**
   * Phê duyệt: từ đây phiên bản không sửa được (ADR-013 mục 2, 3). `approver` là tài khoản có quyền
   * `catalog:approve`. Công việc chưa có điểm không chặn phê duyệt nhưng được liệt kê trong cảnh báo.
   */
  async approve(approver: { id: string }, versionId: string, effectiveFrom?: Date): Promise<CatalogVersionView> {
    const version = await this.requireDraft(versionId);
    const items = (await this.items.findByVersion(versionId)).filter((i) => i.status === 'ACTIVE');
    if (items.length === 0) throw new ConflictException('Phiên bản chưa có công việc nào đang hoạt động');
    if (!version.baselineItemCode) throw new ConflictException('Chưa chọn công việc chuẩn');
    const baseline = items.find((i) => i.code === version.baselineItemCode);
    if (!baseline || baseline.points === null || baseline.points <= 0) {
      throw new ConflictException('Công việc chuẩn không tồn tại, đã ngừng sử dụng hoặc chưa có điểm chấm lớn hơn 0');
    }

    const now = this.clock.now();
    const from = effectiveFrom ?? now;
    const latest = (await this.versions.findAll())
      .filter((v) => v.status === 'APPROVED' && v.effectiveFrom)
      .sort((a, b) => b.effectiveFrom!.getTime() - a.effectiveFrom!.getTime())[0];
    if (latest && from <= latest.effectiveFrom!) {
      throw new ConflictException(`Thời điểm hiệu lực phải sau phiên bản đã phê duyệt trước đó ("${latest.label}")`);
    }

    await this.versions.approve(versionId, approver.id, now, from);
    const result = await this.getVersion(versionId);
    await this.audit.record({
      action: 'catalog.version.approve',
      outcome: 'SUCCESS',
      targetType: 'catalog_version',
      targetId: versionId,
      details: { label: version.label, items: items.length, effectiveFrom: from, warnings: result.warnings.length },
    });
    return result;
  }

  private async view(version: CatalogVersionModel): Promise<CatalogVersionView> {
    const [items, groups, tasks, scopeRows] = await Promise.all([
      this.items.findByVersion(version.id),
      this.groups.findAll(),
      this.tasks.findByVersion(version.id),
      this.scopes.findByVersion(version.id),
    ]);
    const baselineItem = items.find((i) => i.code === version.baselineItemCode);
    const baselinePoints = baselineItem?.points ?? null;

    const views: CatalogItemView[] = [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map((i) => ({
        ...i,
        coefficient: coefficientOf(i.points, baselinePoints),
        needsScoring: i.points === null,
        unitIds: scopeRows.filter((s) => s.itemId === i.id && s.unitId).map((s) => s.unitId!),
        positionIds: scopeRows.filter((s) => s.itemId === i.id && s.positionId).map((s) => s.positionId!),
      }));

    const warnings: string[] = [];
    if (!baselineItem || baselinePoints === null || baselinePoints <= 0) warnings.push('Chưa có công việc chuẩn hợp lệ nên chưa tính được hệ số');
    for (const i of views) if (i.needsScoring && i.status === 'ACTIVE') warnings.push(`Công việc ${i.code} chưa có điểm chấm`);

    return {
      version,
      groups,
      tasks: [...tasks]
        .sort((a, b) => a.groupCode.localeCompare(b.groupCode) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))
        .map((t) => ({ ...t, itemCount: items.filter((i) => i.taskId === t.id && i.status === 'ACTIVE').length })),
      baseline: baselineItem && baselinePoints !== null ? { code: baselineItem.code, points: baselinePoints } : null,
      items: views,
      warnings,
    };
  }

  private assertItem(item: Pick<NewCatalogItem, 'name' | 'complexity' | 'durationMode' | 'durationValue' | 'durationUnit' | 'points'>): void {
    if (!item.name.trim()) throw new BadRequestException('Tên công việc không được để trống');
    if (!Number.isInteger(item.complexity) || item.complexity < MIN_COMPLEXITY || item.complexity > MAX_COMPLEXITY) {
      throw new BadRequestException(`Mức độ phức tạp là số nguyên từ ${MIN_COMPLEXITY} đến ${MAX_COMPLEXITY}`);
    }
    if (item.points !== null && !(Number.isFinite(item.points) && item.points >= 0)) {
      throw new BadRequestException('Điểm chấm phải là số không âm');
    }
    if (item.durationMode === 'LIMITED') {
      if (item.durationValue === null || !(item.durationValue > 0) || item.durationUnit === null) {
        throw new BadRequestException('Thời gian có hạn mức cần giá trị lớn hơn 0 và đơn vị (giờ hoặc ngày)');
      }
    } else if (item.durationValue !== null || item.durationUnit !== null) {
      throw new BadRequestException('Chỉ thời gian có hạn mức mới có giá trị và đơn vị');
    }
  }

  private async requireVersion(id: string): Promise<CatalogVersionModel> {
    const version = await this.versions.findById(id);
    if (!version) throw new NotFoundException(`Không tìm thấy phiên bản danh mục: ${id}`);
    return version;
  }

  private async requireDraft(id: string): Promise<CatalogVersionModel> {
    const version = await this.requireVersion(id);
    if (version.status !== 'DRAFT') {
      throw new ConflictException('Phiên bản đã phê duyệt, không sửa được; hãy tạo phiên bản mới bằng cách sao chép');
    }
    return version;
  }

  private async requireGroup(code: string): Promise<CatalogGroupModel> {
    const group = await this.groups.findByCode(code);
    if (!group) throw new NotFoundException(`Không tìm thấy nhóm: ${code}`);
    return group;
  }

  private async requireTask(id: string): Promise<CatalogTaskModel> {
    const task = await this.tasks.findById(id);
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ: ${id}`);
    return task;
  }

  /** Nhiệm vụ mặc định của nhóm trong phiên bản, tạo nếu chưa có. */
  private async defaultTask(versionId: string, groupCode: string): Promise<CatalogTaskModel> {
    const existing = await this.tasks.findByVersion(versionId);
    const found = existing.find((t) => t.groupCode === groupCode && t.name.toLowerCase() === DEFAULT_TASK_NAME.toLowerCase());
    if (found?.status === 'ACTIVE') return found;
    if (found) return this.tasks.setStatus(found.id, { status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    return this.tasks.create({ versionId, groupCode, name: DEFAULT_TASK_NAME, description: null, sortOrder: 0 });
  }

  private async requireItem(id: string): Promise<CatalogItemModel> {
    const item = await this.items.findById(id);
    if (!item) throw new NotFoundException(`Không tìm thấy công việc: ${id}`);
    return item;
  }
}

function pick(item: CatalogItemModel, patch: CatalogItemPatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, item[k as keyof CatalogItemModel]]));
}

/** Chuẩn hóa khoảng trắng và kiểm tra độ dài tên nhiệm vụ (3–200 ký tự). */
function normalizeTaskName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 200) throw new BadRequestException('Tên nhiệm vụ gồm 3–200 ký tự');
  return clean;
}

/** Mã tiếp theo của nhóm: số lớn nhất đang có cộng 1, ví dụ A.007 → A.008. */
function nextCode(groupCode: string, items: readonly CatalogItemModel[]): string {
  const max = items.filter((i) => i.groupCode === groupCode).reduce((m, i) => Math.max(m, Number.parseInt(i.code.slice(2), 10) || 0), 0);
  if (max >= 999) throw new ConflictException(`Nhóm ${groupCode} đã hết mã công việc`);
  return `${groupCode}.${String(max + 1).padStart(3, '0')}`;
}

/** Chuẩn hóa khoảng trắng và kiểm tra độ dài tên danh mục (3–200 ký tự). */
function normalizeVersionName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 200) throw new BadRequestException('Tên danh mục gồm 3–200 ký tự');
  return clean;
}

/** Chuẩn hóa khoảng trắng và kiểm tra độ dài tên nhóm (3–255 ký tự). */
function normalizeGroupName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 255) throw new BadRequestException('Tên nhóm gồm 3–255 ký tự');
  return clean;
}

/** Chữ cái kế tiếp chưa dùng làm mã nhóm. */
function nextGroupCode(groups: readonly CatalogGroupModel[]): string {
  for (let i = 0; i < 26; i += 1) {
    const code = String.fromCharCode(65 + i);
    if (!groups.some((g) => g.code === code)) return code;
  }
  throw new ConflictException('Đã dùng hết mã nhóm A–Z');
}

