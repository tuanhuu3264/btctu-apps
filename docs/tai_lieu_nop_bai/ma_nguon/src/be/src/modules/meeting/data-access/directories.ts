import { Injectable } from '@nestjs/common';
import { OrgQueryService, PersonService } from '../../organization/index.js';
import { ProjectService } from '../../project/index.js';
import { AuthorizationService } from '../../security/index.js';
import { MeetingOrgDirectory, MeetingProjectDirectory } from '../application/meeting.ports.js';

/** Adapter sang mô-đun organization: chỉ dùng giao diện công khai của mô-đun đó. */
@Injectable()
export class OrganizationDirectoryAdapter extends MeetingOrgDirectory {
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

  async lookup() {
    return { persons: (await this.org.lookup()).persons };
  }
}

/** Adapter sang mô-đun project: một chiều, cuộc họp biết đề án chứ đề án không biết cuộc họp. */
@Injectable()
export class ProjectDirectoryAdapter extends MeetingProjectDirectory {
  constructor(
    private readonly projects: ProjectService,
    private readonly authorization: AuthorizationService,
  ) {
    super();
  }

  async viewable(actor: { id: string; username: string; personId: string | null }, projectId: string) {
    const permissions = await this.authorization.permissionsOf(actor.id);
    const detail = await this.projects.get(actor, projectId, { readAll: permissions.has('project:read-all'), approve: permissions.has('project:approve') });
    return { code: detail.project.code, title: detail.project.title };
  }

  async labels(projectIds: readonly string[]) {
    return this.projects.labels(projectIds);
  }
}
