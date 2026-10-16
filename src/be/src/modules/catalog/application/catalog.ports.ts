import type {
  CatalogGroupModel,
  CatalogInactiveInfo,
  CatalogItemModel,
  CatalogItemPatch,
  CatalogScope,
  CatalogScopeRow,
  CatalogTaskModel,
  CatalogTaskPatch,
  CatalogVersionModel,
  NewCatalogItem,
  NewCatalogTask,
  NewCatalogVersion,
} from './catalog.model.js';

/** Các cổng truy cập dữ liệu của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class CatalogGroupRepository {
  abstract findAll(): Promise<CatalogGroupModel[]>;
  abstract findByCode(code: string): Promise<CatalogGroupModel | null>;
  abstract upsert(group: CatalogGroupModel): Promise<void>;
  abstract rename(code: string, name: string): Promise<CatalogGroupModel>;
  abstract delete(code: string): Promise<void>;
}

export abstract class CatalogVersionRepository {
  abstract findById(id: string): Promise<CatalogVersionModel | null>;
  abstract findByLabel(label: string): Promise<CatalogVersionModel | null>;
  abstract findAll(): Promise<CatalogVersionModel[]>;
  abstract create(data: NewCatalogVersion): Promise<CatalogVersionModel>;
  abstract rename(id: string, name: string): Promise<CatalogVersionModel>;
  abstract setBaseline(id: string, itemCode: string | null): Promise<void>;
  abstract approve(id: string, approvedBy: string, approvedAt: Date, effectiveFrom: Date): Promise<void>;
}

export abstract class CatalogTaskRepository {
  abstract findById(id: string): Promise<CatalogTaskModel | null>;
  abstract findByVersion(versionId: string): Promise<CatalogTaskModel[]>;
  abstract create(data: NewCatalogTask): Promise<CatalogTaskModel>;
  abstract update(id: string, patch: CatalogTaskPatch): Promise<CatalogTaskModel>;
  /** Đổi trạng thái (không xóa dòng). */
  abstract setStatus(id: string, info: CatalogInactiveInfo): Promise<CatalogTaskModel>;
  /** Số nhiệm vụ của nhóm ở mọi phiên bản. */
  abstract countByGroup(groupCode: string): Promise<number>;
}

export abstract class CatalogScopeRepository {
  /** Mọi dòng phạm vi của các công việc trong một phiên bản. */
  abstract findByVersion(versionId: string): Promise<CatalogScopeRow[]>;
  /** Thay toàn bộ phạm vi của các công việc bằng `scope` (rỗng thì thành việc chung). */
  abstract replace(itemIds: readonly string[], scope: CatalogScope): Promise<void>;
  abstract createMany(rows: readonly CatalogScopeRow[]): Promise<void>;
}

/** Cổng sang mô-đun organization: các đơn vị, vị trí hiện có, để kiểm tra mã khi gán phạm vi. */
export abstract class OrgDirectory {
  abstract unitIds(): Promise<Set<string>>;
  abstract positionIds(): Promise<Set<string>>;
}

export abstract class CatalogItemRepository {
  abstract findById(id: string): Promise<CatalogItemModel | null>;
  abstract findByVersion(versionId: string): Promise<CatalogItemModel[]>;
  abstract create(data: NewCatalogItem): Promise<CatalogItemModel>;
  abstract update(id: string, patch: CatalogItemPatch): Promise<CatalogItemModel>;
  /** Đổi trạng thái (không xóa dòng). */
  abstract setStatus(id: string, info: CatalogInactiveInfo): Promise<CatalogItemModel>;
  /** Số công việc của nhóm ở mọi phiên bản. */
  abstract countByGroup(groupCode: string): Promise<number>;
}
