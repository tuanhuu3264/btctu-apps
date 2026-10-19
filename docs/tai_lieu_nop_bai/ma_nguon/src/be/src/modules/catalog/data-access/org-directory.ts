import { Injectable } from '@nestjs/common';
import { OrgQueryService } from '../../organization/index.js';
import { OrgDirectory } from '../application/catalog.ports.js';

/** Adapter sang mô-đun organization: dùng giao diện công khai của mô-đun đó, không đụng bảng của nó. */
@Injectable()
export class OrganizationDirectoryAdapter extends OrgDirectory {
  constructor(private readonly org: OrgQueryService) {
    super();
  }

  async unitIds(): Promise<Set<string>> {
    return new Set((await this.org.tree()).map((u) => u.id));
  }

  async positionIds(): Promise<Set<string>> {
    return new Set((await this.org.tree()).flatMap((u) => u.positions.map((p) => p.id)));
  }
}
