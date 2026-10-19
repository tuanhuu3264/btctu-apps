import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/index.js';
import type { CatalogVersionView } from '../../catalog/index.js';
import { OrgQueryService, PersonService } from '../../organization/index.js';
import type { ParsedOkr } from '../../organization/index.js';
import { CatalogDirectory, OrgDirectory } from '../application/tasking.ports.js';
import type { CatalogItemInfo, Placement } from '../application/tasking.ports.js';

/** `onlyActive`: danh mục để giao việc mới bỏ công việc đã ngừng; tra cứu việc cũ thì giữ đủ. */
const toItems = (view: CatalogVersionView, onlyActive = false): Map<string, CatalogItemInfo> =>
  new Map(view.items.filter((i) => !onlyActive || i.status === 'ACTIVE').map((i) => [i.code, { name: i.name, coefficient: i.coefficient, unitIds: i.unitIds, positionIds: i.positionIds }]));

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

  async superiorHolders(personId: string, positionId?: string | null): Promise<string[]> {
    return (await this.org.superiorsOf(personId, positionId ?? undefined)).flatMap((s) => (s.personId ? [s.personId] : []));
  }

  subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]> {
    return this.org.subordinateHolders(personId, options);
  }

  okrOf(personId: string): Promise<ParsedOkr | null> {
    return this.org.okrOf(personId);
  }

  async lookup() {
    const data = await this.org.lookup();
    return { persons: data.persons, positions: data.positions };
  }

  async placementOf(personId: string, positionId?: string | null): Promise<Placement | null> {
    const position = positionId ? await this.org.positionById(positionId) : await this.org.currentPositionOf(personId);
    return position ? { unitId: position.unitId, positionId: position.id } : null;
  }

  async placementsOf(personId: string): Promise<(Placement & { kind: 'PRIMARY' | 'CONCURRENT' })[]> {
    return (await this.org.currentPlacementsOf(personId)).map((p) => ({ unitId: p.position.unitId, positionId: p.position.id, kind: p.kind }));
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
      return { versionId: view.version.id, items: toItems(view, true) };
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
