import { BadRequestException, Injectable } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CatalogGroupRepository } from './catalog.ports.js';
import type { CatalogImportPlan } from './catalog-import.plan.js';

export interface CatalogImportResult {
  versionId: string;
  label: string;
  itemsCreated: number;
  baselineCode: string | null;
  warnings: string[];
}

/**
 * Áp dụng kế hoạch nhập thành một **bản nháp mới** (ADR-013 mục 8). Không bao giờ ghi đè phiên bản
 * có sẵn: nhãn trùng thì dừng. Đi qua CatalogService nên mọi quy tắc và nhật ký đều áp dụng.
 */
@Injectable()
export class CatalogImportService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly groups: CatalogGroupRepository,
  ) {}

  async apply(plan: CatalogImportPlan, options: { label: string; name?: string; sourceNote?: string }): Promise<CatalogImportResult> {
    if (plan.errors.length > 0) {
      throw new BadRequestException(`Tệp có ${plan.errors.length} lỗi:\n${plan.errors.join('\n')}`);
    }
    for (const g of plan.groups) await this.groups.upsert(g);

    const version = await this.catalog.createVersion({ label: options.label, name: options.name, sourceNote: options.sourceNote ?? null });
    for (const item of plan.items) {
      await this.catalog.addItem(version.id, {
        code: item.code,
        name: item.name,
        productUnits: item.productUnits,
        complexity: item.complexity,
        durationMode: item.durationMode,
        durationValue: item.durationValue,
        durationUnit: item.durationUnit,
        points: item.points,
        explanation: item.explanation,
        sortOrder: item.sortOrder,
      });
    }
    if (plan.baselineCode) await this.catalog.setBaseline(version.id, plan.baselineCode);

    return {
      versionId: version.id,
      label: version.label,
      itemsCreated: plan.items.length,
      baselineCode: plan.baselineCode,
      warnings: plan.warnings,
    };
  }
}
