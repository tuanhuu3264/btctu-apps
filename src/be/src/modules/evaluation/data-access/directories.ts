import { AD_HOC_COEFFICIENTS, AD_HOC_LEVELS, adHocCode, adHocLabel } from '../../../common/ad-hoc.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/index.js';
import { OrgQueryService } from '../../organization/index.js';
import { classifyByScore } from '../../scoring/index.js';
import { CatalogDirectory, HeadedUnitRatingSource, OrgDirectory } from '../application/evaluation.ports.js';
import type { HeadedUnitRating } from '../application/evaluation.ports.js';
import type { UnitInfo } from '../application/unit-evaluation.model.js';
import { UnitDirectory, UnitEvaluationRepository } from '../application/unit-evaluation.ports.js';
import type { CatalogVersionInfo, Placement, PositionInfo, Superior } from '../application/evaluation.ports.js';
import type { PositionModel } from '../../organization/index.js';

const toInfo = (p: PositionModel): PositionInfo => ({ positionId: p.id, unitId: p.unitId, level: p.level, isLeader: p.isLeader });

/** Adapter sang mô-đun organization: dùng giao diện công khai của mô-đun đó, không đụng bảng của nó. */
@Injectable()
export class OrganizationDirectoryAdapter extends OrgDirectory {
  constructor(private readonly org: OrgQueryService) {
    super();
  }

  async positionOf(personId: string): Promise<PositionInfo | null> {
    const position = await this.org.currentPositionOf(personId);
    return position ? toInfo(position) : null;
  }

  async positionInfo(positionId: string): Promise<PositionInfo | null> {
    const position = await this.org.positionById(positionId);
    return position ? toInfo(position) : null;
  }

  async placementsDuring(personId: string, from: Date, to: Date): Promise<Placement[]> {
    return (await this.org.placementsDuring(personId, from, to)).map((p) => ({ ...toInfo(p.position), kind: p.kind }));
  }

  superiorsOf(personId: string, positionId?: string): Promise<Superior[]> {
    return this.org.superiorsOf(personId, positionId);
  }

  subordinateHolders(personId: string, options: { direct: boolean; positionId?: string }): Promise<string[]> {
    return this.org.subordinateHolders(personId, options);
  }
}

/** Adapter sang mô-đun catalog. */
@Injectable()
export class CatalogDirectoryAdapter extends CatalogDirectory {
  constructor(private readonly catalog: CatalogService) {
    super();
  }

  async currentApprovedVersionId(): Promise<string | null> {
    try {
      return (await this.catalog.current()).version.id;
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }

  async getVersion(versionId: string): Promise<CatalogVersionInfo | null> {
    try {
      const view = await this.catalog.getVersion(versionId);
      return {
        id: view.version.id,
        status: view.version.status,
        items: new Map([
          ...view.items.map((i) => [i.code, { name: i.name, points: i.points, coefficient: i.coefficient, unitIds: i.unitIds, positionIds: i.positionIds }] as const),
          // Mức độ khó của việc đột xuất (ADR-046): không thuộc danh mục nhưng có hệ số cố định để dòng hồ sơ tính được.
          ...AD_HOC_LEVELS.map((level) => [adHocCode(level), { name: adHocLabel(adHocCode(level))!, points: null, coefficient: AD_HOC_COEFFICIENTS[level], unitIds: [] as string[], positionIds: [] as string[] }] as const),
        ]),
      };
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }
}

/** Adapter sang mô-đun organization cho đánh giá tập thể: đơn vị, người đứng đầu và thành viên hiện tại. */
@Injectable()
export class OrganizationUnitDirectoryAdapter extends UnitDirectory {
  constructor(private readonly org: OrgQueryService) {
    super();
  }

  async units(): Promise<UnitInfo[]> {
    return (await this.org.tree()).map((u) => {
      // Người đứng đầu là người giữ vị trí cấp cao nhất (số cấp nhỏ nhất); vị trí đó trống thì đơn vị chưa có người đứng đầu.
      const top = [...u.positions].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))[0];
      return {
        id: u.id,
        code: u.code,
        name: u.name,
        type: u.type === 'BAN' ? 'BAN' : 'PHONG',
        parentId: u.parentId,
        headPersonId: top?.holder?.personId ?? null,
        headPositionId: top?.id ?? null,
        memberPersonIds: [...new Set(u.positions.flatMap((p) => (p.holder ? [p.holder.personId] : [])))],
      };
    });
  }
}

/**
 * Mức xếp loại năm của đơn vị mà cán bộ đứng đầu, để đối chiếu Điều 20.6 ở hồ sơ cá nhân.
 * Chỉ dùng mức chính thức khi hồ sơ tập thể đã phê duyệt; trước đó dùng mức do chính người đứng đầu tự đề xuất,
 * để hồ sơ cá nhân không lộ mức thẩm định chưa được công nhận.
 */
@Injectable()
export class UnitRatingAdapter extends HeadedUnitRatingSource {
  constructor(
    private readonly units: UnitDirectory,
    private readonly evaluations: UnitEvaluationRepository,
  ) {
    super();
  }

  async of(personId: string, periodId: string, positionId?: string): Promise<HeadedUnitRating | null> {
    // Người kiêm nhiệm: chỉ phiếu của đúng vị trí đứng đầu đơn vị mới đối chiếu với xếp loại đơn vị (ADR-047).
    const unit = (await this.units.units()).find((u) => u.headPersonId === personId && (!positionId || u.headPositionId === undefined || u.headPositionId === positionId));
    if (!unit) return null;
    const row = await this.evaluations.findByPeriodAndUnit(periodId, unit.id);
    if (!row) return null;
    const approved = row.status === 'APPROVED';
    const selfScore = row.selfGeneralScore !== null && row.selfResultScore !== null ? row.selfGeneralScore + row.selfResultScore : null;
    const rating = approved ? row.rating : selfScore !== null ? classifyByScore(selfScore) : null;
    return rating ? { unitName: unit.name, rating, approved } : null;
  }
}
