import type {
  MemberModel,
  MemberRole,
  MilestoneModel,
  MilestonePatch,
  NewMilestone,
  NewProject,
  NewProjectAttachment,
  ProjectAttachmentModel,
  ProjectModel,
  ProjectPatch,
} from './project.model.js';

/** Các cổng của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class ProjectRepository {
  abstract findById(id: string): Promise<ProjectModel | null>;
  abstract findAll(): Promise<ProjectModel[]>;
  abstract findByIds(ids: readonly string[]): Promise<ProjectModel[]>;
  /** Số thứ tự kế tiếp trong năm cho tiền tố mã (DA, DUA). */
  abstract nextSequence(prefix: string, year: number): Promise<number>;
  abstract create(data: NewProject): Promise<ProjectModel>;
  abstract update(id: string, patch: ProjectPatch): Promise<ProjectModel>;
}

export abstract class MemberRepository {
  abstract findByProjects(projectIds: readonly string[]): Promise<MemberModel[]>;
  /** Mã các đề án mà cán bộ là thành viên (kể cả chủ trì). */
  abstract projectIdsOfPerson(personId: string): Promise<string[]>;
  /** Thêm thành viên; đã là thành viên thì đặt lại vai trò. */
  abstract add(projectId: string, personId: string, role: MemberRole): Promise<void>;
  abstract remove(projectId: string, personId: string): Promise<void>;
  abstract setRole(projectId: string, personId: string, role: MemberRole): Promise<void>;
}

export abstract class MilestoneRepository {
  abstract findByProjects(projectIds: readonly string[]): Promise<MilestoneModel[]>;
  abstract findById(id: string): Promise<MilestoneModel | null>;
  /** Mã các đề án có mốc giao cho cán bộ này. */
  abstract projectIdsOfAssignee(personId: string): Promise<string[]>;
  abstract create(data: NewMilestone): Promise<MilestoneModel>;
  abstract update(id: string, patch: MilestonePatch): Promise<MilestoneModel>;
  abstract delete(id: string): Promise<void>;
}

export abstract class ProjectAttachmentRepository {
  abstract findByProject(projectId: string): Promise<ProjectAttachmentModel[]>;
  abstract findById(id: string): Promise<ProjectAttachmentModel | null>;
  abstract create(data: NewProjectAttachment): Promise<ProjectAttachmentModel>;
}

/** Cổng sang mô-đun organization. */
export abstract class ProjectOrgDirectory {
  /** Người giữ các vị trí cấp dưới (mọi cấp, hoặc trực tiếp). */
  abstract subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]>;
  /** Trong các mã đã cho, những cán bộ còn được quản lý (chưa ngừng). */
  abstract activePersonIds(personIds: readonly string[]): Promise<Set<string>>;
  /** Đơn vị của vị trí chính mà cán bộ đang giữ, hoặc null. */
  abstract unitOf(personId: string): Promise<string | null>;
  /** Họ tên cán bộ và tên đơn vị, để ghép vào tệp xuất và thống kê. */
  abstract lookup(): Promise<{ persons: Map<string, { fullName: string }>; units: Map<string, { name: string }> }>;
}

/** Việc được giao gắn vào đề án (tóm tắt, không có nội dung chi tiết). */
export interface LinkedWork {
  assignmentId: string;
  title: string;
  taskTitle: string;
  assigneePersonId: string;
  dueDate: string;
  state: string;
  plannedQuantity: number;
  confirmedQuantity: number;
  lateCount: number;
  reworkCount: number;
}

/** Cổng sang mô-đun tasking (một chiều: đề án dùng việc, việc không biết đề án ngoài mã gắn). */
export abstract class ProjectWorkDirectory {
  abstract linkedWork(projectId: string): Promise<LinkedWork[]>;
  /** Số việc gắn vào mỗi đề án. */
  abstract countByProject(projectIds: readonly string[]): Promise<Map<string, number>>;
  /** Gắn hoặc gỡ việc; người thao tác phải là người giao có quyền với người nhận. */
  abstract link(actor: { id: string; username: string; personId: string | null }, assignmentId: string, projectId: string | null): Promise<{ title: string; assigneePersonId: string }>;
  /** Việc người này đã giao, chưa gắn đề án nào, còn hiệu lực. */
  abstract candidates(actor: { id: string; username: string; personId: string | null }): Promise<LinkedWork[]>;
}
