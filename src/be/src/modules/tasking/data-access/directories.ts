import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/index.js';
import type { CatalogVersionView } from '../../catalog/index.js';
import { OrgQueryService, PersonService } from '../../organization/index.js';
import { CatalogDirectory, OrgDirectory } from '../application/tasking.ports.js';
import type { CatalogItemInfo, Placement } from '../application/tasking.ports.js';

const toItems = (view: CatalogVersionView): Map<string, CatalogItemInfo> =>
  new Map(view.items.map((i) => [i.code, { name: i.name, coefficient: i.coefficient, unitIds: i.unitIds, positionIds: i.positionIds }]));

/** Adapter sang mô-đun organization: dùng giao diện công khai của mô-đun đó, không đụng bảng của nó. */
@Injectable()
export class OrganizationDirectoryAdapter extends OrgDirectory {
  constructor(
    private readonly org: OrgQueryService,
    private readonly persons: PersonService,
  ) {
    super();
  }

  async activePersonIds(personIds: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(personIds);
    return new Set((await this.persons.list({ active: true })).filter((p) => wanted.has(p.id)).map((p) => p.id));
  }

  async superiorHolders(personId: string): Promise<string[]> {
    return (await this.org.superiorsOf(personId)).flatMap((s) => (s.personId ? [s.personId] : []));
  }

  subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]> {
    return this.org.subordinateHolders(personId, options);
  }

  async placementOf(personId: string): Promise<Placement | null> {
    const position = await this.org.currentPositionOf(personId);
    return position ? { unitId: position.unitId, positionId: position.id } : null;
  }
}

/** Adapter sang mô-đun catalog. */
@Injectable()
export class CatalogDirectoryAdapter extends CatalogDirectory {
  constructor(private readonly catalog: CatalogService) {
    super();
  }

  async currentApproved(): Promise<{ versionId: string; items: Map<string, CatalogItemInfo> } | null> {
    try {
      const view = await this.catalog.current();
      return { versionId: view.version.id, items: toItems(view) };
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }

  async itemsOf(versionId: string): Promise<Map<string, CatalogItemInfo> | null> {
    try {
      return toItems(await this.catalog.getVersion(versionId));
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }
}
