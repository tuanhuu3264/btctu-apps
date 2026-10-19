import { Controller, ForbiddenException, Get } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../application/audit.service.js';
import { AuthorizationService } from '../application/authorization.service.js';
import type { Permission } from '../application/authorization.model.js';
import { PermissionsGuard } from './permissions.guard.js';
import { Public } from './public.decorator.js';
import { Authenticated, RequirePermission } from './require-permission.decorator.js';

@Controller('demo')
class DemoController {
  @Get('open') @Public() open() {}
  @Get('me') @Authenticated() me() {}
  @Get('read') @RequirePermission('org:read') read() {}
  @Get('both') @RequirePermission('org:read', 'account:create') both() {}
  @Get('forgotten') forgotten() {}
}

function contextFor(handler: () => void, account?: { id: string }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => DemoController,
    switchToHttp: () => ({ getRequest: () => ({ account }) }),
  } as unknown as ExecutionContext;
}

const recorded: unknown[] = [];

function guardGranting(...granted: Permission[]) {
  const authorization = { permissionsOf: async () => new Set(granted) } as unknown as AuthorizationService;
  const audit = { record: async (e: unknown) => void recorded.push(e) } as unknown as AuditService;
  return new PermissionsGuard(new Reflector(), authorization, audit);
}

describe('PermissionsGuard', () => {
  const demo = new DemoController();
  const account = { id: 'a1' };

  it('cho qua route công khai và route chỉ cần đăng nhập', async () => {
    const guard = guardGranting();
    await expect(guard.canActivate(contextFor(demo.open))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(demo.me, account))).resolves.toBe(true);
  });

  it('từ chối route quên khai báo quyền truy cập (mặc định từ chối)', async () => {
    await expect(guardGranting('org:read').canActivate(contextFor(demo.forgotten, account))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cho qua khi đủ quyền, từ chối khi thiếu', async () => {
    await expect(guardGranting('org:read').canActivate(contextFor(demo.read, account))).resolves.toBe(true);
    await expect(guardGranting().canActivate(contextFor(demo.read, account))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('route đòi nhiều quyền thì phải đủ tất cả', async () => {
    await expect(guardGranting('org:read').canActivate(contextFor(demo.both, account))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      guardGranting('org:read', 'account:create').canActivate(contextFor(demo.both, account)),
    ).resolves.toBe(true);
  });

  it('ghi nhật ký khi từ chối vì thiếu quyền', async () => {
    recorded.length = 0;
    await expect(guardGranting().canActivate(contextFor(demo.read, account))).rejects.toBeInstanceOf(ForbiddenException);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ action: 'access.denied', outcome: 'DENIED', details: { missing: ['org:read'] } });
  });

  it('từ chối khi không có người dùng gắn vào request', async () => {
    await expect(guardGranting('org:read').canActivate(contextFor(demo.read))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
