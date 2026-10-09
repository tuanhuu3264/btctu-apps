import { Injectable } from '@nestjs/common';
import { requestContext } from '../../../common/request-context.js';
import { AuditService } from './audit.service.js';
import { Authenticator } from './ports.js';
import { SessionService } from './session.service.js';
import type { IssuedSession } from './session.service.js';
import type { Credentials, CurrentAccount } from './security.model.js';

export interface LoginResult {
  account: CurrentAccount;
  session: IssuedSession;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly authenticator: Authenticator,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(credentials: Credentials): Promise<LoginResult> {
    const account = await this.authenticator.authenticate(credentials);
    const session = await this.sessions.issue(account.id);
    await this.audit.record({
      action: 'auth.login.success',
      outcome: 'SUCCESS',
      actor: { id: account.id, username: account.username },
      targetType: 'account',
      targetId: account.id,
    });
    return { account, session };
  }

  async logout(token: string | undefined): Promise<void> {
    await this.sessions.revoke(token);
    const actor = requestContext.get()?.actor;
    if (actor) {
      await this.audit.record({ action: 'auth.logout', outcome: 'SUCCESS', targetType: 'account', targetId: actor.id });
    }
  }
}
