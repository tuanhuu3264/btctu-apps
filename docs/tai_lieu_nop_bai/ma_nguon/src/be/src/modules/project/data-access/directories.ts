import { Injectable } from '@nestjs/common';
import { OrgQueryService, PersonService } from '../../organization/index.js';
import { TaskingService } from '../../tasking/index.js';
import type { LinkedWork } from '../application/project.ports.js';
import { ProjectOrgDirectory, ProjectWorkDirectory } from '../application/project.ports.js';

/** Adapter sang mô-đun organization: chỉ dùng giao diện công khai của mô-đun đó. */
@Injectable()
export class OrganizationDirectoryAdapter extends ProjectOrgDirectory {
  constructor(
    private readonly org: OrgQueryService,
    private readonly persons: PersonService,
  ) {
    super();
  }

  subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]> {
    return this.org.subordinateHolders(personId, options);
  }

  async activePersonIds(personIds: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(personIds);
    return new Set((await this.persons.list({ active: true })).filter((p) => wanted.has(p.id)).map((p) => p.id));
  }

  async unitOf(personId: string): Promise<string | null> {
    return (await this.org.currentPositionOf(personId))?.unitId ?? null;
  }

  async lookup() {
    const data = await this.org.lookup();
    return { persons: data.persons, units: data.units };
  }
}

/** Adapter sang mô-đun tasking. */
@Injectable()
export class TaskingDirectoryAdapter extends ProjectWorkDirectory {
  constructor(private readonly tasking: TaskingService) {
    super();
  }

  linkedWork(projectId: string): Promise<LinkedWork[]> {
    return this.tasking.workOfProject(projectId);
  }

  countByProject(projectIds: readonly string[]): Promise<Map<string, number>> {
    return this.tasking.workCountByProject(projectIds);
  }

  link(actor: { id: string; username: string; personId: string | null }, assignmentId: string, projectId: string | null) {
    return this.tasking.linkProject(actor, assignmentId, projectId);
  }

  candidates(actor: { id: string; username: string; personId: string | null }): Promise<LinkedWork[]> {
    return this.tasking.projectLinkCandidates(actor);
  }
}
