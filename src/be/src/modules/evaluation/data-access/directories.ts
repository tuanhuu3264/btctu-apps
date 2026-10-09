import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/index.js';
import { OrgQueryService } from '../../organization/index.js';
import { CatalogDirectory, OrgDirectory } from '../application/evaluation.ports.js';
import type { CatalogVersionInfo, Superior } from '../application/evaluation.ports.js';

/** Adapter sang mô-đun organization: dùng giao diện công khai của mô-đun đó, không đụng bảng của nó. */
@Injectable()
export class OrganizationDirectoryAdapter extends OrgDirectory {
  constructor(private readonly org: OrgQueryService) {
    super();
  }

  async positionOf(personId: string): Promise<{ positionId: string; unitId?: string; level: number; isLeader?: boolean } | null> {
    const position = await this.org.currentPositionOf(personId);
    return position ? { positionId: position.id, unitId: position.unitId, level: position.level, isLeader: position.isLeader } : null;
  }

  superiorsOf(personId: string): Promise<Superior[]> {
    return this.org.superiorsOf(personId);
  }

  subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]> {
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
        items: new Map(
          view.items.map((i) => [i.code, { name: i.name, points: i.points, coefficient: i.coefficient, unitIds: i.unitIds, positionIds: i.positionIds }]),
        ),
      };
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }
}
