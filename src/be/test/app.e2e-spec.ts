import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import JSZip from 'jszip';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { planCatalogImport } from './../src/modules/catalog/application/catalog-import.plan.js';
import { CatalogImportService } from './../src/modules/catalog/application/catalog-import.service.js';
import { readCatalogRowsFromExcel } from './../src/modules/catalog/data-access/excel-catalog-source.js';
import { planOrgImport } from './../src/modules/organization/application/org-import.plan.js';
import { OrgImportService } from './../src/modules/organization/application/org-import.service.js';
import { readOrgRowsFromExcel } from './../src/modules/organization/data-access/excel-org-source.js';
import { AccountService, RoleService } from './../src/modules/security/index.js';
import type { Role } from './../src/modules/security/index.js';

const E2E_DB = 'kpi_e2e';

/**
 * Nhật ký không xóa được (có chủ đích), nên e2e chạy trên CSDL riêng, tạo lại từ đầu mỗi lần chạy.
 * Cần PostgreSQL đang chạy (xem database/docker-compose.yml); kết nối theo biến DB_* như ứng dụng.
 */
async function recreateE2eDatabase() {
  const admin = new pg.Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'kpi',
    password: process.env.DB_PASSWORD ?? 'kpi',
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${E2E_DB}`);
  } finally {
    await admin.end();
  }
  process.env.DB_NAME = E2E_DB;
}

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let accounts: AccountService;
  let roles: RoleService;
  const prefix = `e2e${Date.now()}`;
  const password = 'mat-khau-e2e-du-dai-12-ky-tu';
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

  /** Tạo tài khoản (kèm vai trò nếu có) rồi đăng nhập, trả về cookie phiên. */
  async function createUser(role?: Role) {
    const username = `${prefix}-${++counter}`;
    const account = await accounts.create({ username, password });
    if (role) await roles.grant(null, { accountId: account.id, role });
    const res = await http().post('/api/auth/login').send({ username, password }).expect(200);
    return { account, username, cookie: cookieOf(res) };
  }

  const auditRows = (sql: string, params: unknown[] = []) =>
    db.query(`SELECT * FROM audit_log ${sql}`, params) as Promise<Record<string, any>[]>;

  beforeAll(async () => {
    await recreateE2eDatabase();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.use(cookieParser());
    await app.init();
    // Test gửi nhiều request song song vào cùng một server.
    app.getHttpServer().setMaxListeners(100);

    db = app.get(DataSource);
    accounts = app.get(AccountService);
    roles = app.get(RoleService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('xác thực', () => {
    it('GET /api/health công khai', () => {
      return http().get('/api/health').expect(200).expect({ status: 'ok', database: 'up' });
    });

    it('route khác từ chối khi chưa đăng nhập', async () => {
      await http().get('/api/units').expect(401);
      await http().get('/api/auth/me').expect(401);
      await http().get('/api/accounts').expect(401);
      await http().get('/api/audit-logs').expect(401);
    });

    it('đăng nhập sai trả 401, không đặt cookie', async () => {
      const { username } = await createUser();
      const res = await http().post('/api/auth/login').send({ username, password: 'sai-mat-khau' }).expect(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('cookie phiên là httpOnly, SameSite=Lax; đăng xuất thu hồi phiên; CSDL chỉ lưu băm token', async () => {
      const username = `${prefix}-${++counter}`;
      await accounts.create({ username, password });
      const login = await http().post('/api/auth/login').send({ username, password }).expect(200);
      expect(login.body.passwordHash).toBeUndefined();

      const setCookie = (login.headers['set-cookie'] as unknown as string[])[0];
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      const cookie = setCookie.split(';')[0];
      const token = cookie.replace('sid=', '');

      const rows = await db.query(`SELECT token_hash FROM "session" ORDER BY created_at DESC LIMIT 1`);
      expect(rows[0].token_hash).not.toBe(token);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);

      await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      await http().get('/api/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('phân quyền', () => {
    it('tài khoản chưa có vai trò đăng nhập được nhưng không truy cập được dữ liệu', async () => {
      const { cookie } = await createUser();
      const me = await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body.roles).toEqual([]);
      expect(me.body.permissions).toEqual([]);
      await http().get('/api/units').set('Cookie', cookie).expect(403);
    });

    it('chuyên viên xem được đơn vị nhưng không tạo được; không quản lý được tài khoản', async () => {
      const { cookie } = await createUser('CHUYEN_VIEN');
      await http().get('/api/units').set('Cookie', cookie).expect(200);
      await http().post('/api/units').set('Cookie', cookie).send({ code: 'X', name: 'x', type: 'PHONG' }).expect(403);
      await http().get('/api/accounts').set('Cookie', cookie).expect(403);
      await http().post('/api/accounts').set('Cookie', cookie).send({ username: 'abc', password }).expect(403);
    });

    it('văn phòng tạo được đơn vị; dữ liệu sai bị từ chối', async () => {
      const { cookie } = await createUser('VAN_PHONG');
      const code = `${prefix.toUpperCase()}A`;
      await http().post('/api/units').set('Cookie', cookie).send({ code, name: 'Đơn vị thử', type: 'PHONG' }).expect(201);
      await http().post('/api/units').set('Cookie', cookie).send({ code: '', name: 'x', type: 'KHAC' }).expect(400);
    });

    it('quản trị dữ liệu xem được tài khoản và vai trò nhưng không cấp được vai trò', async () => {
      const { cookie } = await createUser('QUAN_TRI_DU_LIEU');
      const { account: target } = await createUser('CHUYEN_VIEN');
      await http().get('/api/accounts').set('Cookie', cookie).expect(200);
      await http().get(`/api/accounts/${target.id}/roles`).set('Cookie', cookie).expect(200);
      await http().post(`/api/accounts/${target.id}/roles`).set('Cookie', cookie).send({ role: 'VAN_PHONG' }).expect(403);
    });
  });

  describe('quản trị tài khoản và vai trò', () => {
    it('quản trị hệ thống tạo tài khoản, cấp và thu hồi vai trò; thay đổi có hiệu lực ngay', async () => {
      const { cookie: adminCookie } = await createUser('QUAN_TRI_HE_THONG');
      const username = `${prefix}-${++counter}`;

      const created = await http().post('/api/accounts').set('Cookie', adminCookie).send({ username, password }).expect(201);
      const id = created.body.id as string;
      const grant = await http().post(`/api/accounts/${id}/roles`).set('Cookie', adminCookie).send({ role: 'CHUYEN_VIEN' }).expect(201);

      const login = await http().post('/api/auth/login').send({ username, password }).expect(200);
      const cookie = cookieOf(login);
      const me = await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body.roles).toEqual(['CHUYEN_VIEN']);
      await http().get('/api/units').set('Cookie', cookie).expect(200);

      await http().delete(`/api/accounts/${id}/roles/${grant.body.id}`).set('Cookie', adminCookie).expect(204);
      await http().get('/api/units').set('Cookie', cookie).expect(403);
    });

    it('từ chối cấp vai trò sai, tự cấp cho mình, cấp vai trò kèm vai trò quản trị', async () => {
      const { account: admin, cookie } = await createUser('QUAN_TRI_HE_THONG');
      const { account: target } = await createUser('CHUYEN_VIEN');

      await http().post(`/api/accounts/${target.id}/roles`).set('Cookie', cookie).send({ role: 'SIEU_NHAN' }).expect(400);
      await http().post(`/api/accounts/${admin.id}/roles`).set('Cookie', cookie).send({ role: 'TRUONG_BAN' }).expect(403);
      await http().post(`/api/accounts/${target.id}/roles`).set('Cookie', cookie).send({ role: 'QUAN_TRI_DU_LIEU' }).expect(409);
      await http().get('/api/accounts/khong-phai-uuid/roles').set('Cookie', cookie).expect(400);
    });

    it('vô hiệu hóa tài khoản làm phiên đang mở mất hiệu lực ngay; không tự vô hiệu hóa mình', async () => {
      const { account: admin, cookie: adminCookie } = await createUser('QUAN_TRI_HE_THONG');
      const { account: victim, cookie: victimCookie } = await createUser('CHUYEN_VIEN');

      await http().get('/api/auth/me').set('Cookie', victimCookie).expect(200);
      await http().post(`/api/accounts/${victim.id}/disable`).set('Cookie', adminCookie).expect(204);
      await http().get('/api/auth/me').set('Cookie', victimCookie).expect(401);
      await http().post(`/api/accounts/${admin.id}/disable`).set('Cookie', adminCookie).expect(403);
    });
  });

  describe('tổ chức: đơn vị, cán bộ, vị trí, phân công', () => {
    let unitId: string;
    let vanPhong: { cookie: string };
    const P = prefix.toUpperCase();

    beforeAll(async () => {
      vanPhong = await createUser('VAN_PHONG');
      const res = await http()
        .post('/api/units')
        .set('Cookie', vanPhong.cookie)
        .send({ code: `${P}ORG`, name: 'Đơn vị thử tổ chức', type: 'BAN' })
        .expect(201);
      unitId = res.body.id;
    });

    const createPosition = (cookie: string, body: Record<string, unknown>) =>
      http().post('/api/positions').set('Cookie', cookie).send({ unitId, ...body });

    it('chuyên viên xem được sơ đồ và danh sách nhưng không sửa được', async () => {
      const { cookie } = await createUser('CHUYEN_VIEN');
      await http().get('/api/org/tree').set('Cookie', cookie).expect(200);
      await http().get('/api/persons').set('Cookie', cookie).expect(200);
      await http().get('/api/positions').set('Cookie', cookie).expect(200);
      await http().post('/api/persons').set('Cookie', cookie).send({ fullName: 'Nguyễn Văn Thử' }).expect(403);
      await http().post('/api/positions').set('Cookie', cookie).send({ code: 'E2E-X', unitId, title: 'x', level: 1 }).expect(403);
    });

    it('văn phòng dựng cây vị trí; quy tắc cây được thực thi qua HTTP', async () => {
      const { cookie } = vanPhong;
      const root = await createPosition(cookie, { code: `${P}-R`, title: 'Trưởng ban thử', level: 1 }).expect(201);
      const deputy = await createPosition(cookie, {
        code: `${P}-D`,
        title: 'Phó thử',
        level: 2,
        reportsToPositionId: root.body.id,
        duties: 'Nhiệm vụ gốc',
      }).expect(201);

      await createPosition(cookie, { code: `${P}-B1`, title: 'x', level: 1, reportsToPositionId: root.body.id }).expect(400);
      await createPosition(cookie, { code: `${P}-B2`, title: 'x', level: 3 }).expect(400);
      await createPosition(cookie, { code: `${P}-B3`, title: 'x', level: 2, reportsToPositionId: deputy.body.id }).expect(400);
      await createPosition(cookie, { code: `${P}-B4`, title: 'x', level: 9 }).expect(400);
      await createPosition(cookie, { code: 'thuong', title: 'x', level: 1 }).expect(400);
      await createPosition(cookie, { code: `${P}-R`, title: 'x', level: 1 }).expect(409);

      const subs = await http().get(`/api/positions/${root.body.id}/subordinates`).set('Cookie', cookie).expect(200);
      expect(subs.body.map((p: any) => p.id)).toEqual([deputy.body.id]);
      const chain = await http().get(`/api/positions/${deputy.body.id}/chain`).set('Cookie', cookie).expect(200);
      expect(chain.body.map((p: any) => p.id)).toEqual([root.body.id]);
    });

    it('cập nhật một phần không ghi đè các trường không gửi', async () => {
      const { cookie } = vanPhong;
      const root = await createPosition(cookie, { code: `${P}-PR`, title: 'Gốc', level: 1 }).expect(201);
      const pos = await createPosition(cookie, {
        code: `${P}-P`,
        title: 'Tên cũ',
        level: 2,
        reportsToPositionId: root.body.id,
        duties: 'Giữ nguyên nhiệm vụ',
        referenceOkr: 'Giữ nguyên OKR',
      }).expect(201);

      const patched = await http().patch(`/api/positions/${pos.body.id}`).set('Cookie', cookie).send({ title: 'Tên mới' }).expect(200);
      expect(patched.body).toMatchObject({
        title: 'Tên mới',
        duties: 'Giữ nguyên nhiệm vụ',
        referenceOkr: 'Giữ nguyên OKR',
        level: 2,
        reportsToPositionId: root.body.id,
      });
      await http().patch(`/api/positions/${pos.body.id}`).set('Cookie', cookie).send({ code: 'DOI-MA' }).expect(400); // mã không đổi được
      await http().patch(`/api/positions/${pos.body.id}`).set('Cookie', cookie).send({ level: 1 }).expect(400);
    });

    it('phân công, sơ đồ hiển thị người giữ, kết thúc và chuyển công tác', async () => {
      const { cookie } = vanPhong;
      const pos = await createPosition(cookie, { code: `${P}-AS`, title: 'Vị trí phân công', level: 1 }).expect(201);
      const person = await http().post('/api/persons').set('Cookie', cookie).send({ fullName: '  Trần   Thị   Thử ' }).expect(201);
      expect(person.body.fullName).toBe('Trần Thị Thử');

      const asg = await http().post(`/api/positions/${pos.body.id}/assignments`).set('Cookie', cookie).send({ personId: person.body.id }).expect(201);
      const other = await http().post('/api/persons').set('Cookie', cookie).send({ fullName: 'Lê Văn Khác' }).expect(201);
      await http().post(`/api/positions/${pos.body.id}/assignments`).set('Cookie', cookie).send({ personId: other.body.id }).expect(409);

      const tree = await http().get('/api/org/tree').set('Cookie', cookie).expect(200);
      const holder = tree.body.flatMap((u: any) => u.positions).find((p: any) => p.id === pos.body.id).holder;
      expect(holder).toEqual({ personId: person.body.id, fullName: 'Trần Thị Thử' });

      await http().post(`/api/persons/${person.body.id}/deactivate`).set('Cookie', cookie).expect(409);
      await new Promise((r) => setTimeout(r, 20));
      await http().post(`/api/assignments/${asg.body.id}/end`).set('Cookie', cookie).send({}).expect(204);
      await http().post(`/api/assignments/${asg.body.id}/end`).set('Cookie', cookie).send({}).expect(409);
      await http().post(`/api/persons/${person.body.id}/deactivate`).set('Cookie', cookie).expect(204);

      const history = await http().get(`/api/persons/${person.body.id}/assignments`).set('Cookie', cookie).expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].validTo).not.toBeNull();
      await http().get('/api/persons/khong-phai-uuid').set('Cookie', cookie).expect(400);
    });

    it('chỉ quản trị dữ liệu gắn tài khoản với cán bộ; mỗi cán bộ một tài khoản và ngược lại', async () => {
      const dataAdmin = await createUser('QUAN_TRI_DU_LIEU');
      const sysAdmin = await createUser('QUAN_TRI_HE_THONG');
      const person = await http().post('/api/persons').set('Cookie', vanPhong.cookie).send({ fullName: 'Cán Bộ Gắn Tài Khoản' }).expect(201);
      const other = await http().post('/api/persons').set('Cookie', vanPhong.cookie).send({ fullName: 'Cán Bộ Khác Nữa' }).expect(201);
      const target = await createUser('CHUYEN_VIEN');
      const link = (cookie: string, personId: string, accountId: string) =>
        http().put(`/api/persons/${personId}/account`).set('Cookie', cookie).send({ accountId });

      await link(sysAdmin.cookie, person.body.id, target.account.id).expect(403);
      await link(vanPhong.cookie, person.body.id, target.account.id).expect(403);
      await link(dataAdmin.cookie, person.body.id, target.account.id).expect(204);

      const me = await http().get('/api/auth/me').set('Cookie', target.cookie).expect(200);
      expect(me.body.personId).toBe(person.body.id);

      // Cán bộ đã có tài khoản; tài khoản đã gắn với người khác; mã sai định dạng.
      const second = await createUser('CHUYEN_VIEN');
      await link(dataAdmin.cookie, person.body.id, second.account.id).expect(409);
      await link(dataAdmin.cookie, other.body.id, target.account.id).expect(409);
      await link(dataAdmin.cookie, person.body.id, 'x').expect(400);

      await http().delete(`/api/persons/${person.body.id}/account`).set('Cookie', dataAdmin.cookie).expect(204);
      await link(dataAdmin.cookie, other.body.id, target.account.id).expect(204);
    });

    it('tạo tài khoản không nhận personId (phải gắn qua quyền riêng)', async () => {
      const { cookie } = await createUser('QUAN_TRI_HE_THONG');
      await http()
        .post('/api/accounts')
        .set('Cookie', cookie)
        .send({ username: `${prefix}-np-${++counter}`, password, personId: '11111111-1111-4111-8111-111111111111' })
        .expect(400);
    });

    it('CSDL tự bảo vệ các bất biến dù nghiệp vụ bị bỏ qua', async () => {
      const [unit] = await db.query(`SELECT id FROM unit LIMIT 1`);
      const insertPosition = (code: string, level: number, reportsTo: string | null) =>
        db.query(
          `INSERT INTO job_position (code, unit_id, title, level, reports_to_position_id) VALUES ($1, $2, 't', $3, $4)`,
          [code, unit.id, level, reportsTo],
        );
      await expect(insertPosition('DB-LV0', 0, null)).rejects.toThrow(/CHK_job_position_level/);
      await expect(insertPosition('DB-ORPHAN', 3, null)).rejects.toThrow(/CHK_job_position_reports_to/);

      const [root] = await db.query(`SELECT id FROM job_position WHERE level = 1 LIMIT 1`);
      await expect(insertPosition('DB-ROOT-PARENT', 1, root.id)).rejects.toThrow(/CHK_job_position_reports_to/);

      // Hai phân công đang mở cho cùng một người hoặc cùng một vị trí.
      const [p1] = await db.query(`INSERT INTO person (full_name) VALUES ('DB Người 1') RETURNING id`);
      const [p2] = await db.query(`INSERT INTO person (full_name) VALUES ('DB Người 2') RETURNING id`);
      await insertPosition('DB-POS-1', 1, null);
      await insertPosition('DB-POS-2', 1, null);
      const [pos1] = await db.query(`SELECT id FROM job_position WHERE code = 'DB-POS-1'`);
      const [pos2] = await db.query(`SELECT id FROM job_position WHERE code = 'DB-POS-2'`);
      const assign = (person: string, position: string) =>
        db.query(`INSERT INTO assignment (person_id, position_id, valid_from) VALUES ($1, $2, now())`, [person, position]);
      await assign(p1.id, pos1.id);
      await expect(assign(p1.id, pos2.id)).rejects.toThrow(/UQ_assignment_person_open/);
      await expect(assign(p2.id, pos1.id)).rejects.toThrow(/UQ_assignment_position_open/);
    });

    const REAL_FILE = fileURLToPath(
      new URL('../../../docs/tai_lieu_tham_khao/Cay_so_do_phan_cong_nhiem_vu_Ban_To_chuc_Tinh_uy (3).xlsx', import.meta.url),
    );

    it.skipIf(!existsSync(REAL_FILE))('nhập tệp Excel thật vào CSDL, chạy lại ổn định, truy vấn cây đúng', async () => {
      const importer = app.get(OrgImportService);
      const plan = planOrgImport(await readOrgRowsFromExcel(REAL_FILE));
      expect(plan.errors).toEqual([]);

      const first = await importer.apply(plan);
      expect(first).toMatchObject({ positionsCreated: 39, assignmentsCreated: 38, warnings: [] });
      const second = await importer.apply(plan);
      expect(second).toMatchObject({ unitsCreated: 0, personsCreated: 0, positionsCreated: 0, positionsUpdated: 0, assignmentsCreated: 0 });

      const { cookie } = await createUser('CHUYEN_VIEN');
      const tree = await http().get('/api/org/tree').set('Cookie', cookie).expect(200);
      const real = tree.body.filter((u: any) => ['BTCTU', 'TCCB', 'VP', 'TCDDV', 'BVCTNB'].includes(u.code));
      expect(real).toHaveLength(5);

      const positions = real.flatMap((u: any) => u.positions);
      expect(positions).toHaveLength(39);
      const head = positions.find((p: any) => p.level === 1);
      const all = await http().get(`/api/positions/${head.id}/subordinates`).set('Cookie', cookie).expect(200);
      expect(all.body).toHaveLength(38);
      const direct = await http().get(`/api/positions/${head.id}/subordinates?direct=true`).set('Cookie', cookie).expect(200);
      expect(direct.body).toHaveLength(5); // 5 Phó Trưởng ban

      const leaf = positions.find((p: any) => p.level === 5 && p.holder);
      const chain = await http().get(`/api/positions/${leaf.id}/chain`).set('Cookie', cookie).expect(200);
      expect(chain.body.at(-1).id).toBe(head.id);
      const levels = chain.body.map((p: any) => p.level);
      expect(levels).toEqual([...levels].sort((a: number, b: number) => b - a));
    });

    it('cờ lãnh đạo, sửa và xóa đơn vị, vị trí; chỉ văn phòng được làm (ADR-022)', async () => {
      const { cookie } = vanPhong;
      const reader = (await createUser('CHUYEN_VIEN')).cookie;
      const unitA = (await http().post('/api/units').set('Cookie', cookie).send({ code: `${P}UA`, name: 'Đơn vị thử A', type: 'BAN' }).expect(201)).body;
      const unitB = (await http().post('/api/units').set('Cookie', cookie).send({ code: `${P}UB`, name: 'Đơn vị thử B', type: 'PHONG', parentId: unitA.id }).expect(201)).body;

      // sửa đơn vị
      await http().patch(`/api/units/${unitB.id}`).set('Cookie', reader).send({ name: 'Không được' }).expect(403);
      const renamed = await http().patch(`/api/units/${unitB.id}`).set('Cookie', cookie).send({ name: 'Đơn vị thử B đã đổi' }).expect(200);
      expect(renamed.body).toMatchObject({ code: `${P}UB`, name: 'Đơn vị thử B đã đổi', parentId: unitA.id });
      await http().patch(`/api/units/${unitA.id}`).set('Cookie', cookie).send({ parentId: unitB.id }).expect(400); // vòng lặp
      await http().patch(`/api/units/${unitA.id}`).set('Cookie', cookie).send({ code: 'DOI-MA' }).expect(400); // mã không đổi được

      // cờ lãnh đạo: mặc định theo cấp, sửa độc lập với cấp
      const root = (await http().post('/api/positions').set('Cookie', cookie).send({ code: `${P}-UA-1`, unitId: unitB.id, title: 'Đứng đầu', level: 1 }).expect(201)).body;
      const staff = (await http().post('/api/positions').set('Cookie', cookie).send({ code: `${P}-UA-5`, unitId: unitB.id, title: 'Chuyên viên', level: 5, reportsToPositionId: root.id }).expect(201)).body;
      const lead = (await http().post('/api/positions').set('Cookie', cookie).send({ code: `${P}-UA-5L`, unitId: unitB.id, title: 'Chuyên viên phụ trách', level: 5, reportsToPositionId: root.id, isLeader: true }).expect(201)).body;
      expect([root.isLeader, staff.isLeader, lead.isLeader]).toEqual([true, false, true]);
      const off = await http().patch(`/api/positions/${root.id}`).set('Cookie', cookie).send({ isLeader: false }).expect(200);
      expect(off.body).toMatchObject({ level: 1, isLeader: false });
      await http().patch(`/api/positions/${root.id}`).set('Cookie', cookie).send({ isLeader: 'có' }).expect(400);
      const tree = await http().get('/api/org/tree').set('Cookie', cookie).expect(200);
      const treePositions = tree.body.flatMap((u: any) => u.positions);
      expect(treePositions.find((p: any) => p.id === lead.id)).toMatchObject({ isLeader: true });

      // xóa: bị chặn khi còn dùng, xóa được khi trống
      await http().delete(`/api/units/${unitA.id}`).set('Cookie', cookie).expect(409); // còn đơn vị con
      await http().delete(`/api/units/${unitB.id}`).set('Cookie', cookie).expect(409); // còn vị trí
      await http().delete(`/api/positions/${root.id}`).set('Cookie', cookie).expect(409); // còn cấp dưới
      const person = (await http().post('/api/persons').set('Cookie', cookie).send({ fullName: `Nhân sự thử xóa vị trí ${prefix}` }).expect(201)).body;
      await http().post(`/api/positions/${staff.id}/assignments`).set('Cookie', cookie).send({ personId: person.id }).expect(201);
      await http().delete(`/api/positions/${staff.id}`).set('Cookie', reader).expect(403);
      await http().delete(`/api/positions/${staff.id}`).set('Cookie', cookie).expect(409); // có lịch sử phân công

      await http().delete(`/api/positions/${lead.id}`).set('Cookie', cookie).expect(204);
      await http().delete(`/api/positions/${lead.id}`).set('Cookie', cookie).expect(404);
      await http().get(`/api/positions/${lead.id}`).set('Cookie', cookie).expect(404);
    });

    it('hồ sơ cán bộ mở rộng: trường nhạy cảm chỉ người quản lý thấy; mã, CCCD không trùng (ADR-023)', async () => {
      const { cookie } = vanPhong;
      const reader = (await createUser('CHUYEN_VIEN')).cookie;
      const nid = `0${Date.now()}`.slice(0, 12).padEnd(12, '7');
      const body = {
        fullName: `Hồ sơ mở rộng ${prefix}`,
        employeeCode: `cb-${prefix}`,
        gender: 'NAM',
        dateOfBirth: '1988-02-29',
        nationalId: nid,
        email: 'Test.User@Example.com',
        phone: '0912345678',
        rank: 'Chuyên viên',
        education: 'Đại học',
        politicalTheory: 'TRUNG_CAP',
        joinedAgencyOn: '2012-05-01',
      };
      await http().post('/api/persons').set('Cookie', reader).send(body).expect(403);
      const created = (await http().post('/api/persons').set('Cookie', cookie).send(body).expect(201)).body;
      expect(created).toMatchObject({ employeeCode: `CB-${prefix}`.toUpperCase(), email: 'test.user@example.com', nationalId: nid });

      // người chỉ xem: không thấy ngày sinh, CCCD, email, điện thoại; vẫn thấy thông tin công tác
      const asReader = (await http().get(`/api/persons/${created.id}`).set('Cookie', reader).expect(200)).body;
      for (const f of ['dateOfBirth', 'nationalId', 'email', 'phone']) expect(asReader).not.toHaveProperty(f);
      expect(asReader).toMatchObject({ rank: 'Chuyên viên', education: 'Đại học', politicalTheory: 'TRUNG_CAP' });
      const list = (await http().get('/api/persons').set('Cookie', reader).expect(200)).body as Record<string, unknown>[];
      expect(list.some((p) => 'nationalId' in p || 'phone' in p)).toBe(false);
      await http().get(`/api/persons/${created.id}/profile`).set('Cookie', reader).expect(403);
      const profile = (await http().get(`/api/persons/${created.id}/profile`).set('Cookie', cookie).expect(200)).body;
      expect(profile).toMatchObject({ nationalId: nid, phone: '0912345678', dateOfBirth: '1988-02-29' });

      // kiểm tra dữ liệu
      const bad = (extra: object) => http().post('/api/persons').set('Cookie', cookie).send({ fullName: `Sai dữ liệu ${prefix}`, ...extra });
      await bad({ nationalId: '123' }).expect(400);
      await bad({ email: 'khong-phai-email' }).expect(400);
      await bad({ phone: '12345' }).expect(400);
      await bad({ gender: 'X' }).expect(400);
      await bad({ dateOfBirth: '20/02/1990' }).expect(400);
      await bad({ dateOfBirth: '2099-01-01' }).expect(400);
      await bad({ dateOfBirth: '1990-01-01', partyJoinedOn: '1980-01-01' }).expect(400);
      await bad({ employeeCode: `CB-${prefix}` }).expect(409);
      await bad({ nationalId: nid }).expect(409);

      // sửa: xóa trường bằng null, đổi mã
      const patched = (await http().patch(`/api/persons/${created.id}`).set('Cookie', cookie).send({ phone: null, rank: 'Chuyên viên chính' }).expect(200)).body;
      expect(patched).toMatchObject({ phone: null, rank: 'Chuyên viên chính' });
      await http().patch(`/api/persons/${created.id}`).set('Cookie', reader).send({ rank: 'x' }).expect(403);
    });

    it('đơn vị và vị trí không còn dùng thì xóa được', async () => {
      const { cookie } = vanPhong;
      const unit = (await http().post('/api/units').set('Cookie', cookie).send({ code: `${P}UC`, name: 'Đơn vị thử xóa', type: 'PHONG' }).expect(201)).body;
      const pos = (await http().post('/api/positions').set('Cookie', cookie).send({ code: `${P}-UC-1`, unitId: unit.id, title: 'Trưởng', level: 1 }).expect(201)).body;
      await http().delete(`/api/positions/${pos.id}`).set('Cookie', cookie).expect(204);
      await http().delete(`/api/units/${unit.id}`).set('Cookie', cookie).expect(204);
      await http().delete(`/api/units/${unit.id}`).set('Cookie', cookie).expect(404);
    });
  });

  describe('danh mục sản phẩm công việc chuẩn', () => {
    let drafter: { cookie: string }; // VAN_PHONG: soạn
    let approverUser: { cookie: string }; // TRUONG_BAN: phê duyệt
    let reader: { cookie: string }; // CHUYEN_VIEN: chỉ đọc
    let flowVersionId: string;

    beforeAll(async () => {
      drafter = await createUser('VAN_PHONG');
      approverUser = await createUser('TRUONG_BAN');
      reader = await createUser('CHUYEN_VIEN');
    });

    const newItem = (code: string, points: number | null, extra: Record<string, unknown> = {}) => ({
      code,
      name: `Công việc ${code}`,
      complexity: 2,
      durationMode: 'LIMITED',
      durationValue: 4,
      durationUnit: 'HOUR',
      ...(points === null ? {} : { points }),
      ...extra,
    });

    it('chưa có danh mục được phê duyệt thì chưa có phiên bản hiệu lực', async () => {
      await http().get('/api/catalog/current').set('Cookie', reader.cookie).expect(404);
    });

    it('phân quyền: chuyên viên chỉ đọc, văn phòng soạn, chỉ trưởng ban phê duyệt', async () => {
      await http().get('/api/catalog/versions').set('Cookie', reader.cookie).expect(200);
      await http().post('/api/catalog/versions').set('Cookie', reader.cookie).send({ label: 'Không được' }).expect(403);

      const created = await http().post('/api/catalog/versions').set('Cookie', drafter.cookie).send({ label: `${prefix} quyền` }).expect(201);
      const id = created.body.id as string;
      await http().post(`/api/catalog/versions/${id}/items`).set('Cookie', drafter.cookie).send(newItem('B.009', 90)).expect(201);
      await http().put(`/api/catalog/versions/${id}/baseline`).set('Cookie', drafter.cookie).send({ itemCode: 'B.009' }).expect(200);

      await http().post(`/api/catalog/versions/${id}/approve`).set('Cookie', drafter.cookie).send({}).expect(403);
      await http().post(`/api/catalog/versions/${id}/approve`).set('Cookie', reader.cookie).send({}).expect(403);
      // Chưa phê duyệt: sẽ phê duyệt ở bài sau, bản này chỉ dùng để thử quyền.
    });

    it('soạn thảo đến phê duyệt: hệ số tính đúng, bản đã phê duyệt trở thành bản hiệu lực', async () => {
      const { cookie } = drafter;
      const created = await http().post('/api/catalog/versions').set('Cookie', cookie).send({ label: `${prefix} luồng` }).expect(201);
      flowVersionId = created.body.id;
      const add = (body: object) => http().post(`/api/catalog/versions/${flowVersionId}/items`).set('Cookie', cookie).send(body);

      await add(newItem('B.009', 90)).expect(201);
      const a3 = await add(newItem('A.003', 120, { complexity: 3 })).expect(201);
      await add(newItem('A.007', null, { complexity: 3, durationMode: 'ACTUAL', durationValue: undefined, durationUnit: undefined })).expect(201);
      await add(newItem('X.001', 1)).expect(400); // nhóm không tồn tại
      await add(newItem('A.003', 5)).expect(409); // trùng mã
      await add({ ...newItem('A.010', 5), durationUnit: undefined }).expect(400); // có hạn mức nhưng thiếu đơn vị

      // Chưa chọn chuẩn: không phê duyệt được.
      await http().post(`/api/catalog/versions/${flowVersionId}/approve`).set('Cookie', approverUser.cookie).send({}).expect(409);
      await http().put(`/api/catalog/versions/${flowVersionId}/baseline`).set('Cookie', cookie).send({ itemCode: 'A.007' }).expect(409); // chưa có điểm
      await http().put(`/api/catalog/versions/${flowVersionId}/baseline`).set('Cookie', cookie).send({ itemCode: 'B.009' }).expect(200);

      // Sửa một phần không ghi đè trường khác.
      const patched = await http().patch(`/api/catalog/items/${a3.body.id}`).set('Cookie', cookie).send({ name: 'Tên mới' }).expect(200);
      expect(patched.body).toMatchObject({ name: 'Tên mới', points: 120, durationMode: 'LIMITED', durationValue: 4, durationUnit: 'HOUR' });
      await http().patch(`/api/catalog/items/${a3.body.id}`).set('Cookie', cookie).send({ code: 'A.099' }).expect(400); // mã không đổi được

      const draftView = await http().get(`/api/catalog/versions/${flowVersionId}`).set('Cookie', reader.cookie).expect(200);
      const coef = Object.fromEntries(draftView.body.items.map((i: any) => [i.code, i.coefficient]));
      expect(coef['B.009']).toBe(1);
      expect(coef['A.003']).toBeCloseTo(120 / 90, 9);
      expect(coef['A.007']).toBeNull();
      expect(draftView.body.warnings).toEqual(['Công việc A.007 chưa có điểm chấm']);

      const approved = await http().post(`/api/catalog/versions/${flowVersionId}/approve`).set('Cookie', approverUser.cookie).send({}).expect(201);
      expect(approved.body.version).toMatchObject({ status: 'APPROVED', baselineItemCode: 'B.009' });
      expect(approved.body.version.approvedBy).toBeTruthy();

      const current = await http().get('/api/catalog/current').set('Cookie', reader.cookie).expect(200);
      expect(current.body.version.id).toBe(flowVersionId);
      expect(current.body.baseline).toEqual({ code: 'B.009', points: 90 });
    });

    it('bản đã phê duyệt bị khóa ở API', async () => {
      const view = await http().get(`/api/catalog/versions/${flowVersionId}`).set('Cookie', reader.cookie).expect(200);
      const item = view.body.items.find((i: any) => i.code === 'A.003');
      await http().patch(`/api/catalog/items/${item.id}`).set('Cookie', drafter.cookie).send({ points: 1 }).expect(409);
      await http().delete(`/api/catalog/items/${item.id}`).set('Cookie', drafter.cookie).expect(409);
      await http().post(`/api/catalog/versions/${flowVersionId}/items`).set('Cookie', drafter.cookie).send(newItem('A.050', 5)).expect(409);
      await http().put(`/api/catalog/versions/${flowVersionId}/baseline`).set('Cookie', drafter.cookie).send({ itemCode: 'A.003' }).expect(409);
      await http().post(`/api/catalog/versions/${flowVersionId}/approve`).set('Cookie', approverUser.cookie).send({}).expect(409);
    });

    it('CSDL tự khóa bản đã phê duyệt dù nghiệp vụ bị bỏ qua', async () => {
      const [item] = await db.query(`SELECT id FROM catalog_item WHERE version_id = $1 LIMIT 1`, [flowVersionId]);
      await expect(db.query(`UPDATE catalog_item SET points = 1 WHERE id = $1`, [item.id])).rejects.toThrow(/đã phê duyệt/);
      await expect(db.query(`DELETE FROM catalog_item WHERE id = $1`, [item.id])).rejects.toThrow(/đã phê duyệt/);
      await expect(
        db.query(
          `INSERT INTO catalog_item (version_id, code, group_code, name, complexity, duration_mode, sort_order)
           VALUES ($1, 'C.001', 'C', 'x', 1, 'ACTUAL', 99)`,
          [flowVersionId],
        ),
      ).rejects.toThrow(/đã phê duyệt/);
      await expect(db.query(`UPDATE catalog_version SET label = 'đổi tên' WHERE id = $1`, [flowVersionId])).rejects.toThrow(/đã phê duyệt/);
      await expect(db.query(`DELETE FROM catalog_version WHERE id = $1`, [flowVersionId])).rejects.toThrow(/đã phê duyệt/);
    });

    it('nhóm do người dùng thêm: mã tự sinh, dùng được cho nhiệm vụ và công việc, sửa tên, xóa khi rỗng; quyền', async () => {
      const post = (cookie: string, url: string, body: object = {}) => http().post(url).set('Cookie', cookie).send(body);
      for (const who of [reader, approverUser]) await post(who.cookie, '/api/catalog/groups', { name: 'Không được thêm' }).expect(403);

      const nameA = `Nhóm thử ${prefix}`;
      const created = (await post(drafter.cookie, '/api/catalog/groups', { name: nameA }).expect(201)).body;
      expect(created.code).toMatch(/^[E-Z]$/); // chữ cái kế tiếp còn trống sau A–D (có thể xa hơn nếu bài khác đã thêm)
      await post(drafter.cookie, '/api/catalog/groups', { name: nameA }).expect(409); // trùng tên
      await post(drafter.cookie, '/api/catalog/groups', { code: 'A', name: 'Nhóm trùng mã' }).expect(409);
      await post(drafter.cookie, '/api/catalog/groups', { code: '1', name: 'Mã sai' }).expect(400);
      await post(drafter.cookie, '/api/catalog/groups', { name: 'ab' }).expect(400);

      // Nhóm mới xuất hiện ở mọi phiên bản, kể cả bản đã phê duyệt (chỉ là tab trống).
      const approvedView = (await http().get(`/api/catalog/versions/${flowVersionId}`).set('Cookie', reader.cookie).expect(200)).body;
      expect(approvedView.groups.map((g: any) => g.code)).toContain(created.code);

      // Dùng cho nhiệm vụ và công việc: mã công việc theo chữ cái của nhóm.
      const draft = (await post(drafter.cookie, '/api/catalog/versions', { label: `${prefix} nhóm mới` }).expect(201)).body;
      const task = (await post(drafter.cookie, `/api/catalog/versions/${draft.id}/tasks`, { groupCode: created.code, name: 'Nhiệm vụ nhóm mới' }).expect(201)).body;
      const item = (await post(drafter.cookie, `/api/catalog/versions/${draft.id}/items`, { taskId: task.id, name: 'Việc nhóm mới', complexity: 2, durationMode: 'ACTUAL' }).expect(201)).body;
      expect(item).toMatchObject({ code: `${created.code}.001`, groupCode: created.code });

      // Sửa tên, xóa: chỉ khi rỗng.
      const renamed = await http().patch(`/api/catalog/groups/${created.code.toLowerCase()}`).set('Cookie', drafter.cookie).send({ name: `${nameA} đã đổi` }).expect(200);
      expect(renamed.body).toMatchObject({ code: created.code, name: `${nameA} đã đổi` });
      await http().patch(`/api/catalog/groups/${created.code}`).set('Cookie', reader.cookie).send({ name: 'Không được' }).expect(403);
      await http().delete(`/api/catalog/groups/${created.code}`).set('Cookie', drafter.cookie).expect(409); // còn nhiệm vụ và công việc
      await http().delete(`/api/catalog/items/${item.id}`).set('Cookie', drafter.cookie).expect(204);
      await http().delete(`/api/catalog/tasks/${task.id}`).set('Cookie', drafter.cookie).expect(204);
      await http().delete(`/api/catalog/groups/${created.code}`).set('Cookie', drafter.cookie).expect(204);
      await http().delete(`/api/catalog/groups/${created.code}`).set('Cookie', drafter.cookie).expect(404);

      // CSDL: mã nhóm chỉ là một chữ cái in hoa.
      await expect(db.query(`INSERT INTO catalog_group (code, name, sort_order) VALUES ('a', 'Nhóm thường', 99)`)).rejects.toThrow(/CHK_catalog_group_code/);
      const actions = (await auditRows(`WHERE action LIKE 'catalog.group.%'`)).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['catalog.group.create', 'catalog.group.rename', 'catalog.group.delete']));
    });

    it('tên danh mục của phiên bản: mặc định là nhãn, đặt riêng, kế thừa khi sao chép, đổi tên khi còn là bản nháp', async () => {
      const post = (body: object) => http().post('/api/catalog/versions').set('Cookie', drafter.cookie).send(body);
      const plain = (await post({ label: `${prefix} tên mặc định` }).expect(201)).body;
      expect(plain).toMatchObject({ name: `${prefix} tên mặc định`, label: `${prefix} tên mặc định` });

      const named = (await post({ label: `${prefix} tên riêng`, name: ' Danh mục   công việc BTCTU ' }).expect(201)).body;
      expect(named).toMatchObject({ name: 'Danh mục công việc BTCTU', label: `${prefix} tên riêng` });
      await post({ label: `${prefix} tên ngắn`, name: 'ab' }).expect(400);
      await post({ label: `${prefix} tên quá dài`, name: 'x'.repeat(201) }).expect(400);

      const copy = (await post({ label: `${prefix} bản sao tên`, copyFromVersionId: named.id }).expect(201)).body;
      expect(copy.name).toBe('Danh mục công việc BTCTU');

      const renamed = await http().patch(`/api/catalog/versions/${named.id}`).set('Cookie', drafter.cookie).send({ name: 'Tên đã đổi' }).expect(200);
      expect(renamed.body).toMatchObject({ name: 'Tên đã đổi', label: `${prefix} tên riêng` });
      await http().patch(`/api/catalog/versions/${named.id}`).set('Cookie', drafter.cookie).send({ name: 'ab' }).expect(400);
      await http().patch(`/api/catalog/versions/${named.id}`).set('Cookie', reader.cookie).send({ name: 'Không được' }).expect(403);
      await http().patch(`/api/catalog/versions/${flowVersionId}`).set('Cookie', drafter.cookie).send({ name: 'Sau khi duyệt' }).expect(409);

      const list = (await http().get('/api/catalog/versions').set('Cookie', reader.cookie).expect(200)).body;
      expect(list.every((v: any) => typeof v.name === 'string' && v.name.length >= 3)).toBe(true);
      await expect(db.query(`UPDATE catalog_version SET name = 'ab' WHERE id = $1`, [plain.id])).rejects.toThrow(/CHK_catalog_version_name/);
    });

    it('nhiệm vụ của danh mục: chọn nhiệm vụ trước, mã công việc tự sinh theo nhóm; quyền và quy tắc', async () => {
      const created = await http().post('/api/catalog/versions').set('Cookie', drafter.cookie).send({ label: `${prefix} nhiệm vụ` }).expect(201);
      const id = created.body.id as string;
      const post = (cookie: string, url: string, body: object = {}) => http().post(url).set('Cookie', cookie).send(body);

      // Chỉ người có quyền soạn mới tạo nhiệm vụ (trưởng ban chỉ phê duyệt, chuyên viên chỉ đọc).
      await post(reader.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'A', name: 'Không được' }).expect(403);
      await post(approverUser.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'A', name: 'Không được' }).expect(403);

      const taskA = (await post(drafter.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'A', name: 'Thẩm định văn bản' }).expect(201)).body;
      const taskB = (await post(drafter.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'B', name: 'Hành chính' }).expect(201)).body;
      await post(drafter.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'A', name: 'THẨM ĐỊNH văn bản' }).expect(409); // trùng tên trong nhóm
      await post(drafter.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'A', name: 'ab' }).expect(400);
      await post(drafter.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'E', name: 'Nhóm không có' }).expect(400);

      // Thêm công việc vào nhiệm vụ, không gửi mã: máy chủ tự sinh.
      const add = (body: object) => post(drafter.cookie, `/api/catalog/versions/${id}/items`, { name: 'Việc thử', complexity: 2, durationMode: 'ACTUAL', ...body });
      const a1 = (await add({ taskId: taskA.id }).expect(201)).body;
      const a2 = (await add({ taskId: taskA.id }).expect(201)).body;
      const b1 = (await add({ taskId: taskB.id, points: 90 }).expect(201)).body;
      expect([a1.code, a2.code, b1.code]).toEqual(['A.001', 'A.002', 'B.001']);
      expect(a1).toMatchObject({ taskId: taskA.id, groupCode: 'A' });

      await add({ taskId: taskA.id, code: 'B.050' }).expect(400); // mã không thuộc nhóm của nhiệm vụ
      await add({}).expect(400); // thiếu cả nhiệm vụ lẫn mã
      await add({ taskId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await add({ taskId: 'khong-phai-uuid' }).expect(400);

      const view = (await http().get(`/api/catalog/versions/${id}`).set('Cookie', reader.cookie).expect(200)).body;
      expect(view.tasks.map((t: any) => [t.name, t.itemCount])).toEqual([['Thẩm định văn bản', 2], ['Hành chính', 1]]);

      // Chuyển công việc: chỉ trong cùng nhóm.
      const taskA2 = (await post(drafter.cookie, `/api/catalog/versions/${id}/tasks`, { groupCode: 'A', name: 'Nhiệm vụ A thứ hai' }).expect(201)).body;
      await http().patch(`/api/catalog/items/${a1.id}`).set('Cookie', drafter.cookie).send({ taskId: taskA2.id }).expect(200);
      await http().patch(`/api/catalog/items/${a1.id}`).set('Cookie', drafter.cookie).send({ taskId: taskB.id }).expect(400);

      // Sửa tên, xóa: chỉ xóa nhiệm vụ rỗng.
      const renamed = await http().patch(`/api/catalog/tasks/${taskA2.id}`).set('Cookie', drafter.cookie).send({ name: 'Đổi tên nhiệm vụ', description: 'Mô tả' }).expect(200);
      expect(renamed.body).toMatchObject({ name: 'Đổi tên nhiệm vụ', description: 'Mô tả' });
      await http().patch(`/api/catalog/tasks/${taskA2.id}`).set('Cookie', reader.cookie).send({ name: 'Không được' }).expect(403);
      await http().delete(`/api/catalog/tasks/${taskA2.id}`).set('Cookie', drafter.cookie).expect(409); // còn công việc A.001
      await http().patch(`/api/catalog/items/${a1.id}`).set('Cookie', drafter.cookie).send({ taskId: taskA.id }).expect(200);
      await http().delete(`/api/catalog/tasks/${taskA2.id}`).set('Cookie', drafter.cookie).expect(204);

      // CSDL: khóa ngoại ghép không cho công việc chỉ vào nhiệm vụ của nhóm khác.
      await expect(db.query(`UPDATE catalog_item SET task_id = $1 WHERE id = $2`, [taskB.id, a1.id])).rejects.toThrow(/foreign key/i);

      // Nhật ký.
      const actions = (await auditRows(`WHERE action LIKE 'catalog.task.%' AND details->>'versionId' = $1`, [id])).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['catalog.task.create', 'catalog.task.update', 'catalog.task.delete']));
    });

    it('bản đã phê duyệt khóa cả nhiệm vụ, ở API và ở CSDL; công việc nhập từ mã vào nhiệm vụ mặc định', async () => {
      const view = (await http().get(`/api/catalog/versions/${flowVersionId}`).set('Cookie', reader.cookie).expect(200)).body;
      expect(view.tasks.map((t: any) => [t.groupCode, t.name]).sort()).toEqual([['A', 'Chưa phân nhiệm vụ'], ['B', 'Chưa phân nhiệm vụ']]);
      const task = view.tasks[0];

      await http().post(`/api/catalog/versions/${flowVersionId}/tasks`).set('Cookie', drafter.cookie).send({ groupCode: 'A', name: 'Nhiệm vụ mới' }).expect(409);
      await http().patch(`/api/catalog/tasks/${task.id}`).set('Cookie', drafter.cookie).send({ name: 'Đổi tên' }).expect(409);
      await http().delete(`/api/catalog/tasks/${task.id}`).set('Cookie', drafter.cookie).expect(409);
      await expect(db.query(`UPDATE catalog_task SET name = 'đổi tên' WHERE id = $1`, [task.id])).rejects.toThrow(/đã phê duyệt/);
      await expect(db.query(`DELETE FROM catalog_task WHERE id = $1`, [task.id])).rejects.toThrow(/đã phê duyệt/);
    });

    it('CSDL tự kiểm tra ràng buộc dữ liệu của công việc', async () => {
      const draft = await http().post('/api/catalog/versions').set('Cookie', drafter.cookie).send({ label: `${prefix} ràng buộc` }).expect(201);
      // Công việc phải thuộc một nhiệm vụ cùng phiên bản, cùng nhóm: tạo sẵn nhiệm vụ cho hai nhóm A và B.
      const taskOf: Record<string, string> = {};
      for (const g of ['A', 'B']) {
        const [row] = await db.query(`INSERT INTO catalog_task (version_id, group_code, name) VALUES ($1, $2, $3) RETURNING id`, [draft.body.id, g, `Nhiệm vụ thử ${g}`]);
        taskOf[g] = row.id;
      }
      const insert = (code: string, group: string, complexity: number, mode: string, value: number | null, unit: string | null, points: number | null) =>
        db.query(
          `INSERT INTO catalog_item (version_id, task_id, code, group_code, name, complexity, duration_mode, duration_value, duration_unit, points, sort_order)
           VALUES ($1, $2, $3, $4, 'x', $5, $6, $7, $8, $9, 1)`,
          [draft.body.id, taskOf[group], code, group, complexity, mode, value, unit, points],
        );
      await expect(insert('A.001', 'B', 1, 'ACTUAL', null, null, 1)).rejects.toThrow(/CHK_catalog_item_group/);
      await expect(insert('A.002', 'A', 7, 'ACTUAL', null, null, 1)).rejects.toThrow(/CHK_catalog_item_complexity/);
      await expect(insert('A.003', 'A', 1, 'LIMITED', null, null, 1)).rejects.toThrow(/CHK_catalog_item_duration/);
      await expect(insert('A.004', 'A', 1, 'ACTUAL', 3, 'HOUR', 1)).rejects.toThrow(/CHK_catalog_item_duration/);
      await expect(insert('A.005', 'A', 1, 'ACTUAL', null, null, -5)).rejects.toThrow(/CHK_catalog_item_points/);
      await expect(insert('a.006', 'A', 1, 'ACTUAL', null, null, 1)).rejects.toThrow(/CHK_catalog_item_code/);
    });

    it('sao chép thành bản nháp mới, phê duyệt sau với hiệu lực tương lai thì bản cũ vẫn là bản hiệu lực', async () => {
      const copy = await http()
        .post('/api/catalog/versions')
        .set('Cookie', drafter.cookie)
        .send({ label: `${prefix} bản 2`, copyFromVersionId: flowVersionId })
        .expect(201);
      const items = await http().get(`/api/catalog/versions/${copy.body.id}`).set('Cookie', reader.cookie).expect(200);
      expect(items.body.items).toHaveLength(3);
      expect(items.body.tasks.map((t: any) => t.name).sort()).toEqual(['Chưa phân nhiệm vụ', 'Chưa phân nhiệm vụ']); // nhóm A và B
      expect(items.body.items.every((i: any) => items.body.tasks.some((t: any) => t.id === i.taskId && t.versionId === copy.body.id))).toBe(true);
      expect(items.body.version.baselineItemCode).toBe('B.009');

      const a3 = items.body.items.find((i: any) => i.code === 'A.003');
      await http().patch(`/api/catalog/items/${a3.id}`).set('Cookie', drafter.cookie).send({ points: 150 }).expect(200);
      await http().post(`/api/catalog/versions/${copy.body.id}/approve`).set('Cookie', approverUser.cookie)
        .send({ effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() }).expect(409); // hiệu lực không được sớm hơn bản trước

      const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await http().post(`/api/catalog/versions/${copy.body.id}/approve`).set('Cookie', approverUser.cookie).send({ effectiveFrom: future }).expect(201);

      const current = await http().get('/api/catalog/current').set('Cookie', reader.cookie).expect(200);
      expect(current.body.version.id).toBe(flowVersionId); // bản 2 chưa tới ngày hiệu lực
      const original = current.body.items.find((i: any) => i.code === 'A.003');
      expect(original.points).toBe(120); // bản gốc không bị ảnh hưởng bởi sửa ở bản sao
    });

    const REAL_FILE = fileURLToPath(
      new URL('../../../docs/tai_lieu_tham_khao/Danh mục công việc của BTCTU 27.9.2026.xlsx', import.meta.url),
    );

    it.skipIf(!existsSync(REAL_FILE))('nhập tệp Excel thật thành bản nháp, hệ số đúng, trình phê duyệt được', async () => {
      const importer = app.get(CatalogImportService);
      const plan = planCatalogImport(await readCatalogRowsFromExcel(REAL_FILE));
      expect(plan.errors).toEqual([]);
      const result = await importer.apply(plan, { label: `${prefix} nhập từ Excel`, sourceNote: 'Nhập từ tệp thử' });
      expect(result).toMatchObject({ itemsCreated: 49, baselineCode: 'B.009' });

      const view = await http().get(`/api/catalog/versions/${result.versionId}`).set('Cookie', reader.cookie).expect(200);
      expect(view.body.version.status).toBe('DRAFT');
      expect(view.body.items).toHaveLength(49);
      const by = Object.fromEntries(view.body.items.map((i: any) => [i.code, i]));
      expect(by['B.009'].coefficient).toBe(1);
      expect(by['A.003'].coefficient).toBeCloseTo(120 / 90, 9);
      expect(by['C.014'].coefficient).toBeCloseTo(400 / 90, 9);
      expect(by['A.007']).toMatchObject({ needsScoring: true, coefficient: null });
      expect(by['B.023']).toMatchObject({ durationValue: 60, durationUnit: 'DAY' });
      expect(view.body.warnings).toEqual(['Công việc A.007 chưa có điểm chấm']);

      // Dùng lại nhãn thì dừng, không ghi đè.
      await expect(importer.apply(plan, { label: `${prefix} nhập từ Excel` })).rejects.toThrow(/đã tồn tại/);

      const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
      await http().post(`/api/catalog/versions/${result.versionId}/approve`).set('Cookie', approverUser.cookie).send({ effectiveFrom: later }).expect(201);
    });

    it('phạm vi áp dụng: gán cho đơn vị, vị trí; sao chép mang theo; bản đã phê duyệt khóa (ADR-021)', async () => {
      const E = `${prefix.toUpperCase()}PV`;
      const { cookie } = drafter;
      const unit = await http().post('/api/units').set('Cookie', cookie).send({ code: E, name: 'Đơn vị thử phạm vi', type: 'BAN' }).expect(201);
      const position = await http().post('/api/positions').set('Cookie', cookie)
        .send({ code: `${E}-P`, unitId: unit.body.id, title: 'Vị trí thử phạm vi', level: 1 }).expect(201);

      const created = await http().post('/api/catalog/versions').set('Cookie', cookie).send({ label: `${prefix} phạm vi` }).expect(201);
      const versionId = created.body.id as string;
      const add = (body: object) => http().post(`/api/catalog/versions/${versionId}/items`).set('Cookie', cookie).send(body);
      await add(newItem('B.009', 90)).expect(201);
      const a3 = await add(newItem('A.003', 120, { complexity: 3 })).expect(201);
      await http().put(`/api/catalog/versions/${versionId}/baseline`).set('Cookie', cookie).send({ itemCode: 'B.009' }).expect(200);

      const scopeBody = { unitIds: [unit.body.id], positionIds: [position.body.id] };
      await http().put(`/api/catalog/items/${a3.body.id}/scope`).set('Cookie', reader.cookie).send(scopeBody).expect(403);
      await http().put(`/api/catalog/items/${a3.body.id}/scope`).set('Cookie', cookie).send({ unitIds: ['khong-phai-uuid'], positionIds: [] }).expect(400);
      await http().put(`/api/catalog/items/${a3.body.id}/scope`).set('Cookie', cookie)
        .send({ unitIds: ['00000000-0000-4000-8000-00000000dead'], positionIds: [] }).expect(400); // đơn vị không có thật
      await http().put(`/api/catalog/items/${a3.body.id}/scope`).set('Cookie', cookie).send(scopeBody).expect(200).expect(scopeBody);

      const view = await http().get(`/api/catalog/versions/${versionId}`).set('Cookie', reader.cookie).expect(200);
      const by = Object.fromEntries(view.body.items.map((i: any) => [i.code, i]));
      expect(by['A.003']).toMatchObject(scopeBody);
      expect(by['B.009']).toMatchObject({ unitIds: [], positionIds: [] }); // việc chung

      // Gán hàng loạt cho cả nhiệm vụ thay thế phạm vi cũ.
      const bulk = await http().put(`/api/catalog/tasks/${a3.body.taskId}/scope`).set('Cookie', cookie)
        .send({ unitIds: [unit.body.id], positionIds: [] }).expect(200);
      expect(bulk.body.items).toBe(1);
      const afterBulk = await http().get(`/api/catalog/versions/${versionId}`).set('Cookie', reader.cookie).expect(200);
      expect(afterBulk.body.items.find((i: any) => i.code === 'A.003')).toMatchObject({ unitIds: [unit.body.id], positionIds: [] });

      // Sao chép mang theo phạm vi.
      const copy = await http().post('/api/catalog/versions').set('Cookie', cookie)
        .send({ label: `${prefix} phạm vi bản sao`, copyFromVersionId: versionId }).expect(201);
      const copied = await http().get(`/api/catalog/versions/${copy.body.id}`).set('Cookie', reader.cookie).expect(200);
      expect(copied.body.items.find((i: any) => i.code === 'A.003')).toMatchObject({ unitIds: [unit.body.id], positionIds: [] });

      // Phê duyệt rồi thì khóa.
      const later = new Date(Date.now() + 60 * 86_400_000).toISOString();
      await http().post(`/api/catalog/versions/${versionId}/approve`).set('Cookie', approverUser.cookie).send({ effectiveFrom: later }).expect(201);
      await http().put(`/api/catalog/items/${a3.body.id}/scope`).set('Cookie', cookie).send({ unitIds: [], positionIds: [] }).expect(409);
      await http().put(`/api/catalog/tasks/${a3.body.taskId}/scope`).set('Cookie', cookie).send({ unitIds: [], positionIds: [] }).expect(409);
    });
  });

  describe('đánh giá theo kỳ', () => {
    const E = `${prefix.toUpperCase()}EV`;
    type Who = 'boss' | 'deputy' | 'head' | 'staff' | 'other';
    const roleOf: Record<Who, Role> = {
      boss: 'TRUONG_BAN',
      deputy: 'PHO_TRUONG_BAN',
      head: 'TRUONG_PHO_PHONG',
      staff: 'CHUYEN_VIEN',
      other: 'CHUYEN_VIEN',
    };
    const people = {} as Record<Who, { cookie: string; accountId: string; personId: string }>;
    let vanPhong: { cookie: string };
    let sysAdmin: { cookie: string };
    let dataAdmin: { cookie: string };
    let unlinked: { cookie: string };
    let periodId: string;

    const post = (cookie: string, url: string, body: object = {}) => http().post(url).set('Cookie', cookie).send(body);
    const get = (cookie: string, url: string) => http().get(url).set('Cookie', cookie);

    beforeAll(async () => {
      vanPhong = await createUser('VAN_PHONG');
      sysAdmin = await createUser('QUAN_TRI_HE_THONG');
      dataAdmin = await createUser('QUAN_TRI_DU_LIEU');
      unlinked = await createUser('CHUYEN_VIEN');

      const unit = await post(vanPhong.cookie, '/api/units', { code: E, name: 'Đơn vị thử đánh giá', type: 'BAN' }).expect(201);
      const position = async (key: string, title: string, level: number, parent?: string) =>
        (await post(vanPhong.cookie, '/api/positions', {
          code: `${E}-${key}`, unitId: unit.body.id, title, level, reportsToPositionId: parent,
        }).expect(201)).body.id as string;

      const positions: Record<Who, string> = {} as Record<Who, string>;
      positions.boss = await position('BOSS', 'Trưởng ban thử', 1);
      positions.deputy = await position('DEPUTY', 'Phó thử', 2, positions.boss);
      positions.head = await position('HEAD', 'Trưởng phòng thử', 3, positions.deputy);
      positions.staff = await position('STAFF', 'Chuyên viên thử', 5, positions.head);
      positions.other = await position('OTHER', 'Chuyên viên khác', 5, positions.head);

      for (const key of Object.keys(roleOf) as Who[]) {
        const person = await post(vanPhong.cookie, '/api/persons', { fullName: `Cán bộ ${key} ${prefix}` }).expect(201);
        await post(vanPhong.cookie, `/api/positions/${positions[key]}/assignments`, { personId: person.body.id }).expect(201);
        const user = await createUser(roleOf[key]);
        await http().put(`/api/persons/${person.body.id}/account`).set('Cookie', dataAdmin.cookie).send({ accountId: user.account.id }).expect(204);
        people[key] = { cookie: user.cookie, accountId: user.account.id, personId: person.body.id };
      }

      const period = await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'QUARTER', year: 2031, number: 3 }).expect(201);
      periodId = period.body.id;
    });

    it('kỳ đánh giá: quý III gắn với danh mục đang hiệu lực; quý IV, kỳ trùng, người không có quyền bị từ chối', async () => {
      const current = await get(vanPhong.cookie, '/api/catalog/current').expect(200);
      const period = (await get(vanPhong.cookie, '/api/evaluation/periods').expect(200)).body.find((p: any) => p.id === periodId);
      expect(period).toMatchObject({ label: '2031-Q3', status: 'OPEN', startDate: '2031-07-01', endDate: '2031-09-30', catalogVersionId: current.body.version.id });

      await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'QUARTER', year: 2031, number: 4 }).expect(400);
      await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'QUARTER', year: 2031, number: 3 }).expect(409);
      await post(people.head.cookie, '/api/evaluation/periods', { type: 'MONTH', year: 2031, number: 1 }).expect(403);
      await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'WEEK', year: 2031 }).expect(400);
    });

    it('quản trị hệ thống và quản trị dữ liệu không có quyền nào về đánh giá (tách quyền)', async () => {
      for (const { cookie } of [sysAdmin, dataAdmin]) {
        await get(cookie, '/api/evaluation/periods').expect(403);
        await get(cookie, `/api/evaluation/periods/${periodId}/evaluations`).expect(403);
        await post(cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.staff.personId }).expect(403);
      }
    });

    it('chỉ cấp trên trực tiếp mới giao mục tiêu; tài khoản chưa gắn cán bộ không thao tác được', async () => {
      const create = (who: string, cookie: string) =>
        post(cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.staff.personId });
      await create('staff', people.staff.cookie).expect(403); // tự giao việc cho mình
      await create('deputy', people.deputy.cookie).expect(403); // cấp trên xa
      await create('boss', people.boss.cookie).expect(403);
      await create('other', people.other.cookie).expect(403); // đồng cấp
      await create('unlinked', unlinked.cookie).expect(403);
      await create('vanPhong', vanPhong.cookie).expect(403); // không có quyền giao việc
    });

    describe('luồng đầy đủ', () => {
      let evaluationId: string;
      let catalog: any;
      let t1: string;
      let t2: string;

      beforeAll(async () => {
        catalog = (await get(vanPhong.cookie, '/api/catalog/current').expect(200)).body;
      });

      it('bước 1: giao mục tiêu và chỉ tiêu', async () => {
        const created = await post(people.head.cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.staff.personId }).expect(201);
        evaluationId = created.body.id;
        expect(created.body).toMatchObject({ status: 'PLANNED', personId: people.staff.personId });
        await post(people.head.cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.staff.personId }).expect(409); // một hồ sơ một kỳ

        const add = (cookie: string, body: object) => post(cookie, `/api/evaluation/evaluations/${evaluationId}/tasks`, body);
        t1 = (await add(people.head.cookie, { catalogItemCode: 'B.009', plannedQuantity: 10 }).expect(201)).body.id;
        t2 = (await add(people.head.cookie, { catalogItemCode: 'A.003', plannedQuantity: 3 }).expect(201)).body.id;

        await add(people.head.cookie, { catalogItemCode: 'B.009', plannedQuantity: 1 }).expect(409); // trùng
        await add(people.head.cookie, { catalogItemCode: 'A.007', plannedQuantity: 1 }).expect(409); // chưa có điểm chấm
        await add(people.head.cookie, { catalogItemCode: 'ZZ.999', plannedQuantity: 1 }).expect(400); // sai định dạng mã
        await add(people.head.cookie, { catalogItemCode: 'Z.999', plannedQuantity: 1 }).expect(404); // đúng định dạng nhưng không có trong danh mục
        await add(people.head.cookie, { catalogItemCode: 'C.099', plannedQuantity: 1 }).expect(404); // không có trong danh mục
        await add(people.head.cookie, { catalogItemCode: 'A.003', plannedQuantity: 0 }).expect(400); // số lượng không hợp lệ
        await add(people.staff.cookie, { catalogItemCode: 'B.001', plannedQuantity: 1 }).expect(403); // cá nhân không tự giao
      });

      it('xem hồ sơ: chỉ chủ thể, các cấp trên và người có quyền xem tất cả', async () => {
        for (const who of ['staff', 'head', 'deputy', 'boss'] as Who[]) {
          await get(people[who].cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(200);
        }
        await get(people.other.cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(403);
        await get(unlinked.cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(403);
        await get(vanPhong.cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(200); // đọc tất cả

        const own = await get(people.staff.cookie, `/api/evaluation/periods/${periodId}/evaluations`).expect(200);
        expect(own.body.map((e: any) => e.id)).toEqual([evaluationId]);
        expect((await get(people.other.cookie, `/api/evaluation/periods/${periodId}/evaluations`).expect(200)).body).toEqual([]);
        expect((await get(unlinked.cookie, `/api/evaluation/periods/${periodId}/evaluations`).expect(200)).body).toEqual([]);
        expect((await get(vanPhong.cookie, `/api/evaluation/periods/${periodId}/evaluations`).expect(200)).body.length).toBeGreaterThanOrEqual(1);
      });

      it('bước 2: chỉ chính cán bộ nhập kết quả và tự chấm', async () => {
        const result = (cookie: string, task: string, body: object) =>
          http().patch(`/api/evaluation/tasks/${task}/result`).set('Cookie', cookie).send(body);
        await result(people.head.cookie, t1, { completedQuantity: 10 }).expect(403);
        await result(people.other.cookie, t1, { completedQuantity: 10 }).expect(403);
        await result(people.staff.cookie, t1, { completedQuantity: -1 }).expect(400);
        await result(people.staff.cookie, t1, { completedQuantity: 10, evidence: 'Hồ sơ lưu trữ' }).expect(200);
        await result(people.staff.cookie, t2, { completedQuantity: 3 }).expect(200);

        const self = (cookie: string, body: object) => post(cookie, `/api/evaluation/evaluations/${evaluationId}/self-submit`, body);
        await self(people.head.cookie, { generalScore: 25 }).expect(403);
        await self(people.staff.cookie, { generalScore: 31 }).expect(400);
        await self(people.staff.cookie, { generalScore: 26, comment: 'Tự đánh giá' }).expect(201);
        await self(people.staff.cookie, { generalScore: 26 }).expect(409); // đã nộp
        await result(people.staff.cookie, t1, { completedQuantity: 1 }).expect(409);
      });

      it('bước 3: chỉ cấp trên trực tiếp thẩm định; thiếu mức chất lượng thì không thẩm định được', async () => {
        const review = (cookie: string, body: object) => post(cookie, `/api/evaluation/evaluations/${evaluationId}/review`, body);
        const full = { generalScore: 25, comment: 'Hoàn thành tốt', tasks: [{ taskId: t1, qualityLevel: 1 }, { taskId: t2, qualityLevel: 2 }] };
        for (const who of ['staff', 'deputy', 'boss', 'other'] as Who[]) await review(people[who].cookie, full).expect(403);
        await review(sysAdmin.cookie, full).expect(403);

        await review(people.head.cookie, { generalScore: 25, tasks: [{ taskId: t1, qualityLevel: 1 }] }).expect(409); // thiếu dòng t2
        await review(people.head.cookie, { ...full, tasks: [{ taskId: t1, qualityLevel: 9 }, { taskId: t2, qualityLevel: 1 }] }).expect(400); // mức chất lượng ngoài 1–3
        await review(people.head.cookie, { ...full, generalScore: 99 }).expect(400);

        const reviewed = await review(people.head.cookie, full).expect(201);
        expect(reviewed.body.evaluation).toMatchObject({ status: 'REVIEWED', generalScore: 25, resultScore: 70, totalScore: 95, rating: 'XUAT_SAC' });
        expect(reviewed.body.evaluation.scoringParams).toMatchObject({ version: 'v3-nd335', isLeader: false });
        expect(reviewed.body.preview.breakdown).toEqual({ quantity: 1, quality: 1, timeliness: 1, leadership: null, kpi: 1 });
        expect(reviewed.body.reviewerPersonId).toBe(people.head.personId);
        expect(reviewed.body.approverPersonId).toBe(people.deputy.personId);
        const by = Object.fromEntries(reviewed.body.tasks.map((t: any) => [t.catalogItemCode, t]));
        expect(by['A.003'].coefficient).toBeCloseTo(120 / 90, 9);
        expect(catalog.baseline.code).toBe('B.009');
      });

      it('bước 4: chỉ cấp trên của người thẩm định phê duyệt; người thẩm định và chủ thể không tự phê duyệt', async () => {
        const approve = (cookie: string) => post(cookie, `/api/evaluation/evaluations/${evaluationId}/approve`, { comment: 'Đồng ý' });
        for (const who of ['head', 'staff', 'boss', 'other'] as Who[]) await approve(people[who].cookie).expect(403);
        await approve(unlinked.cookie).expect(403);
        await approve(sysAdmin.cookie).expect(403);

        const approved = await approve(people.deputy.cookie).expect(201);
        expect(approved.body.evaluation).toMatchObject({ status: 'APPROVED', approverAccountId: people.deputy.accountId, totalScore: 95, rating: 'XUAT_SAC' });
      });

      it('hồ sơ đã phê duyệt bị khóa ở API', async () => {
        await post(people.deputy.cookie, `/api/evaluation/evaluations/${evaluationId}/approve`).expect(409);
        await post(people.deputy.cookie, `/api/evaluation/evaluations/${evaluationId}/return`, { reason: 'xin trả lại' }).expect(409);
        await http().patch(`/api/evaluation/tasks/${t1}/result`).set('Cookie', people.staff.cookie).send({ completedQuantity: 1 }).expect(409);
        await http().delete(`/api/evaluation/tasks/${t1}`).set('Cookie', people.head.cookie).expect(409);
      });

      it('CSDL tự khóa hồ sơ đã phê duyệt dù nghiệp vụ bị bỏ qua', async () => {
        await expect(db.query(`UPDATE evaluation SET general_score = 1 WHERE id = $1`, [evaluationId])).rejects.toThrow(/đã phê duyệt/);
        await expect(db.query(`UPDATE evaluation SET status = 'PLANNED' WHERE id = $1`, [evaluationId])).rejects.toThrow(/đã phê duyệt/);
        await expect(db.query(`DELETE FROM evaluation WHERE id = $1`, [evaluationId])).rejects.toThrow(/đã phê duyệt/);
        await expect(db.query(`UPDATE evaluation_task SET completed_quantity = 99 WHERE id = $1`, [t1])).rejects.toThrow(/đã phê duyệt/);
        await expect(db.query(`DELETE FROM evaluation_task WHERE id = $1`, [t1])).rejects.toThrow(/đã phê duyệt/);
        await expect(
          db.query(`INSERT INTO evaluation_task (evaluation_id, catalog_item_code, planned_quantity) VALUES ($1, 'B.001', 1)`, [evaluationId]),
        ).rejects.toThrow(/đã phê duyệt/);
      });

      it('nhật ký ghi từng bước của hồ sơ với đúng người thực hiện', async () => {
        const rows = await auditRows(`WHERE target_id = $1 AND action LIKE 'evaluation.%' ORDER BY id`, [evaluationId]);
        expect(rows.map((r) => r.action)).toEqual(['evaluation.create', 'evaluation.self-submit', 'evaluation.review', 'evaluation.approve']);
        expect(rows.map((r) => r.actor_account_id)).toEqual([
          people.head.accountId, people.staff.accountId, people.head.accountId, people.deputy.accountId,
        ]);
        expect(rows[2].details).toMatchObject({ totalScore: 95, rating: 'XUAT_SAC', policy: 'v3-nd335' });
      });
    });

    it('trả lại hồ sơ: người thẩm định trả hồ sơ đã nộp, người phê duyệt trả hồ sơ đã thẩm định', async () => {
      const other = await post(people.head.cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.other.personId }).expect(201);
      const id = other.body.id as string;
      const task = (await post(people.head.cookie, `/api/evaluation/evaluations/${id}/tasks`, { catalogItemCode: 'B.009', plannedQuantity: 4 }).expect(201)).body.id;
      await post(people.head.cookie, `/api/evaluation/evaluations/${id}/return`, { reason: 'chưa nộp mà đòi trả' }).expect(409);

      await http().patch(`/api/evaluation/tasks/${task}/result`).set('Cookie', people.other.cookie).send({ completedQuantity: 4 }).expect(200);
      await post(people.other.cookie, `/api/evaluation/evaluations/${id}/self-submit`, { generalScore: 20 }).expect(201);

      await post(people.deputy.cookie, `/api/evaluation/evaluations/${id}/return`, { reason: 'không phải người thẩm định' }).expect(403);
      await post(people.head.cookie, `/api/evaluation/evaluations/${id}/return`, { reason: ' ' }).expect(400);
      const returned = await post(people.head.cookie, `/api/evaluation/evaluations/${id}/return`, { reason: 'Thiếu minh chứng' }).expect(201);
      expect(returned.body).toMatchObject({ status: 'PLANNED', returnReason: 'Thiếu minh chứng' });

      await post(people.other.cookie, `/api/evaluation/evaluations/${id}/self-submit`, { generalScore: 21 }).expect(201);
      await post(people.head.cookie, `/api/evaluation/evaluations/${id}/review`, { generalScore: 20, tasks: [{ taskId: task, qualityLevel: 1 }] }).expect(201);
      await post(people.head.cookie, `/api/evaluation/evaluations/${id}/return`, { reason: 'người thẩm định không trả ở bước này' }).expect(403);
      const back = await post(people.deputy.cookie, `/api/evaluation/evaluations/${id}/return`, { reason: 'Điểm chung cao quá' }).expect(201);
      expect(back.body).toMatchObject({ status: 'PLANNED', generalScore: null, resultScore: null, totalScore: null, rating: null });
    });

    it('CSDL tự kiểm tra ràng buộc của hồ sơ và chỉ tiêu', async () => {
      const [row] = await db.query(`SELECT id FROM evaluation WHERE status = 'PLANNED' LIMIT 1`);
      await expect(db.query(`UPDATE evaluation SET status = 'KHAC' WHERE id = $1`, [row.id])).rejects.toThrow(/CHK_evaluation_status/);
      await expect(db.query(`UPDATE evaluation SET general_score = 31 WHERE id = $1`, [row.id])).rejects.toThrow(/CHK_evaluation_general/);
      await expect(db.query(`UPDATE evaluation SET result_score = 71 WHERE id = $1`, [row.id])).rejects.toThrow(/CHK_evaluation_result/);
      await expect(db.query(`UPDATE evaluation SET rating = 'GIOI' WHERE id = $1`, [row.id])).rejects.toThrow(/CHK_evaluation_rating/);
      // Đã thẩm định mà thiếu điểm thì CSDL từ chối.
      await expect(db.query(`UPDATE evaluation SET status = 'REVIEWED' WHERE id = $1`, [row.id])).rejects.toThrow(/CHK_evaluation_reviewed_fields/);

      const [task] = await db.query(`SELECT id FROM evaluation_task WHERE evaluation_id = $1 LIMIT 1`, [row.id]);
      await expect(db.query(`UPDATE evaluation_task SET quality_level = 4 WHERE id = $1`, [task.id])).rejects.toThrow(/CHK_evaluation_task_quality/);
      await expect(db.query(`UPDATE evaluation_task SET planned_quantity = 0 WHERE id = $1`, [task.id])).rejects.toThrow(/CHK_evaluation_task_planned/);
      await expect(db.query(`UPDATE evaluation_task SET completed_quantity = -1 WHERE id = $1`, [task.id])).rejects.toThrow(/CHK_evaluation_task_completed/);
      await expect(
        db.query(`INSERT INTO evaluation_period (type, year, number, label, start_date, end_date, catalog_version_id) SELECT 'QUARTER', 2031, 4, 'x', '2031-10-01', '2031-12-31', catalog_version_id FROM evaluation_period LIMIT 1`),
      ).rejects.toThrow(/CHK_evaluation_period_number/);
    });

    it('kỳ đã đóng: chặn mọi thao tác trên hồ sơ', async () => {
      const month = await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'MONTH', year: 2031, number: 1 }).expect(201);
      const created = await post(people.head.cookie, `/api/evaluation/periods/${month.body.id}/evaluations`, { personId: people.staff.personId }).expect(201);
      await post(people.head.cookie, `/api/evaluation/periods/${month.body.id}/close`).expect(403); // chỉ người quản lý kỳ
      await post(vanPhong.cookie, `/api/evaluation/periods/${month.body.id}/close`).expect(204);
      await post(people.head.cookie, `/api/evaluation/evaluations/${created.body.id}/tasks`, { catalogItemCode: 'B.009', plannedQuantity: 1 }).expect(409);
      await post(people.head.cookie, `/api/evaluation/periods/${month.body.id}/evaluations`, { personId: people.other.personId }).expect(409);
    });

    it('hồ sơ của vị trí cấp 1 không tạo được (không có cấp trên trong hệ thống)', async () => {
      // Không ai có thẩm quyền thẩm định vị trí cấp 1 trong hệ thống, nên mọi người đều bị từ chối như nhau.
      await post(people.deputy.cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.boss.personId }).expect(409);
      await post(people.boss.cookie, `/api/evaluation/periods/${periodId}/evaluations`, { personId: people.boss.personId }).expect(409);
    });
  });

  describe('giao việc, báo cáo hoàn thành và tạo hồ sơ từ việc', () => {
    const E = `${prefix.toUpperCase()}TK`;
    type Who = 'boss' | 'deputy' | 'head' | 'staff' | 'other';
    const roleOf: Record<Who, Role> = {
      boss: 'TRUONG_BAN',
      deputy: 'PHO_TRUONG_BAN',
      head: 'TRUONG_PHO_PHONG',
      staff: 'CHUYEN_VIEN',
      other: 'CHUYEN_VIEN',
    };
    const people = {} as Record<Who, { cookie: string; accountId: string; personId: string }>;
    let vanPhong: { cookie: string };
    let sysAdmin: { cookie: string };
    let dataAdmin: { cookie: string };
    let unlinked: { cookie: string };
    let assignmentId: string;
    let staffTask: string;
    let headTask: string;
    let progressIds: string[] = [];

    const post = (cookie: string, url: string, body: object = {}) => http().post(url).set('Cookie', cookie).send(body);
    const get = (cookie: string, url: string) => http().get(url).set('Cookie', cookie);
    const assignBody = (over: object = {}) => ({
      taskId: staffTask,
      catalogItemCode: 'B.009',
      plannedQuantity: 10,
      dueDate: '2025-02-20',
      periodMode: 'AUTO',
      ...over,
    });

    beforeAll(async () => {
      vanPhong = await createUser('VAN_PHONG');
      sysAdmin = await createUser('QUAN_TRI_HE_THONG');
      dataAdmin = await createUser('QUAN_TRI_DU_LIEU');
      unlinked = await createUser('CHUYEN_VIEN');

      const unit = await post(vanPhong.cookie, '/api/units', { code: E, name: 'Đơn vị thử giao việc', type: 'BAN' }).expect(201);
      const position = async (key: string, title: string, level: number, parent?: string) =>
        (await post(vanPhong.cookie, '/api/positions', {
          code: `${E}-${key}`, unitId: unit.body.id, title, level, reportsToPositionId: parent,
        }).expect(201)).body.id as string;

      const positions = {} as Record<Who, string>;
      positions.boss = await position('BOSS', 'Trưởng ban thử', 1);
      positions.deputy = await position('DEPUTY', 'Phó thử', 2, positions.boss);
      positions.head = await position('HEAD', 'Trưởng phòng thử', 3, positions.deputy);
      positions.staff = await position('STAFF', 'Chuyên viên thử', 5, positions.head);
      positions.other = await position('OTHER', 'Chuyên viên khác', 5, positions.head);

      for (const key of Object.keys(roleOf) as Who[]) {
        const person = await post(vanPhong.cookie, '/api/persons', { fullName: `Nhân sự giao việc ${key} ${prefix}` }).expect(201);
        await post(vanPhong.cookie, `/api/positions/${positions[key]}/assignments`, { personId: person.body.id }).expect(201);
        const user = await createUser(roleOf[key]);
        await http().put(`/api/persons/${person.body.id}/account`).set('Cookie', dataAdmin.cookie).send({ accountId: user.account.id }).expect(204);
        people[key] = { cookie: user.cookie, accountId: user.account.id, personId: person.body.id };
      }

      staffTask = (await post(people.head.cookie, '/api/tasking/tasks', { assigneePersonId: people.staff.personId, title: 'Nhiệm vụ thử giao việc' }).expect(201)).body.id;
      headTask = (await post(people.deputy.cookie, '/api/tasking/tasks', { assigneePersonId: people.head.personId, title: 'Nhiệm vụ của trưởng phòng' }).expect(201)).body.id;
    });

    it('quản trị hệ thống và quản trị dữ liệu không có quyền nào về việc được giao (tách quyền)', async () => {
      for (const { cookie } of [sysAdmin, dataAdmin]) {
        await get(cookie, '/api/tasking/assignments').expect(403);
        await get(cookie, '/api/tasking/tasks').expect(403);
        await post(cookie, '/api/tasking/assignments', assignBody()).expect(403);
        await post(cookie, '/api/tasking/tasks', { assigneePersonId: people.staff.personId, title: 'Nhiệm vụ không được tạo' }).expect(403);
      }
    });

    it('chỉ cấp trên trực tiếp giao việc; dữ liệu sai bị từ chối', async () => {
      for (const who of ['staff', 'other', 'deputy', 'boss'] as Who[]) {
        await post(people[who].cookie, '/api/tasking/assignments', assignBody()).expect(403);
      }
      await post(unlinked.cookie, '/api/tasking/assignments', assignBody()).expect(403);
      await post(vanPhong.cookie, '/api/tasking/assignments', assignBody()).expect(403); // không có quyền giao việc

      const head = people.head.cookie;
      await post(head, '/api/tasking/assignments', assignBody({ periodMode: 'MANUAL' })).expect(400);
      await post(head, '/api/tasking/assignments', assignBody({ dueDate: '20/02/2025' })).expect(400);
      await post(head, '/api/tasking/assignments', assignBody({ plannedQuantity: 0 })).expect(400);
      await post(head, '/api/tasking/assignments', assignBody({ catalogItemCode: 'C.099' })).expect(404);
      await post(head, '/api/tasking/assignments', assignBody({ catalogItemCode: 'A.007' })).expect(409); // chưa có điểm chấm
      await post(head, '/api/tasking/assignments', assignBody({ taskId: headTask })).expect(403); // head không phải cấp trên của chính mình
      await post(head, '/api/tasking/assignments', assignBody({ taskId: '00000000-0000-4000-8000-000000000000' })).expect(404); // nhiệm vụ không tồn tại
      await post(head, '/api/tasking/assignments', assignBody({ taskId: 'khong-phai-uuid' })).expect(400);
    });

    it('nhiệm vụ: chỉ cấp trên trực tiếp tạo; tên ngắn hoặc trùng bị từ chối; xem theo phạm vi', async () => {
      const create = (cookie: string, body: object) => post(cookie, '/api/tasking/tasks', { assigneePersonId: people.staff.personId, title: 'Nhiệm vụ khác', ...body });
      for (const who of ['staff', 'other', 'deputy', 'boss'] as Who[]) await create(people[who].cookie, {}).expect(403);
      await create(unlinked.cookie, {}).expect(403);
      await create(vanPhong.cookie, {}).expect(403);
      await create(people.head.cookie, { title: 'ab' }).expect(400);
      await create(people.head.cookie, { title: 'NHIỆM VỤ THỬ GIAO VIỆC' }).expect(409); // trùng không phân biệt hoa thường
      await create(people.head.cookie, { assigneePersonId: 'khong-phai-uuid' }).expect(400);

      const titles = (res: request.Response) => res.body.map((t: any) => t.title);
      expect(titles(await get(people.staff.cookie, '/api/tasking/tasks').expect(200))).toEqual(['Nhiệm vụ thử giao việc']);
      expect(titles(await get(people.head.cookie, '/api/tasking/tasks?scope=team').expect(200))).toContain('Nhiệm vụ thử giao việc');
      expect(titles(await get(people.deputy.cookie, '/api/tasking/tasks?scope=team').expect(200))).toEqual(expect.arrayContaining(['Nhiệm vụ thử giao việc', 'Nhiệm vụ của trưởng phòng']));
      expect(await get(people.other.cookie, '/api/tasking/tasks').then((r) => r.body)).toEqual([]);
      await get(people.staff.cookie, '/api/tasking/tasks?scope=all').expect(403);
      expect((await get(vanPhong.cookie, '/api/tasking/tasks?scope=all').expect(200)).body.length).toBeGreaterThanOrEqual(2);
    });

    it('giao việc: ghi nhận, ai xem được việc', async () => {
      const created = await post(people.head.cookie, '/api/tasking/assignments', assignBody({ note: 'Việc thử' })).expect(201);
      assignmentId = created.body.assignment.id;
      expect(created.body.assignment).toMatchObject({ status: 'OPEN', periodMode: 'AUTO', reportKinds: ['MONTH', 'QUARTER', 'YEAR'], dueDate: '2025-02-20', note: 'Việc thử' });
      expect(created.body.confirmerPersonId).toBe(people.head.personId);
      expect(created.body.task).toEqual({ id: staffTask, title: 'Nhiệm vụ thử giao việc' });
      expect(created.body.assignment).toMatchObject({ taskId: staffTask, assigneePersonId: people.staff.personId });

      expect((await get(people.staff.cookie, '/api/tasking/assignments').expect(200)).body.map((v: any) => v.assignment.id)).toEqual([assignmentId]);
      expect((await get(people.head.cookie, '/api/tasking/assignments?scope=team').expect(200)).body.map((v: any) => v.assignment.id)).toContain(assignmentId);
      expect((await get(people.other.cookie, '/api/tasking/assignments').expect(200)).body).toEqual([]);
      await get(people.staff.cookie, '/api/tasking/assignments?scope=all').expect(403);
      expect((await get(vanPhong.cookie, '/api/tasking/assignments?scope=all').expect(200)).body.length).toBeGreaterThanOrEqual(1);
      await get(people.other.cookie, `/api/tasking/assignments/${assignmentId}`).expect(403);
      await get(people.deputy.cookie, `/api/tasking/assignments/${assignmentId}`).expect(200);
      await get(people.staff.cookie, '/api/tasking/assignments?scope=khac').expect(400);
    });

    it('báo cáo hoàn thành, cấp trên xác nhận hoặc từ chối; chậm và chưa đạt được ghi nhận', async () => {
      const report = (cookie: string, body: object) => post(cookie, `/api/tasking/assignments/${assignmentId}/progress`, body);
      await report(people.head.cookie, { quantity: 1, completedOn: '2025-02-10' }).expect(403); // chỉ người được giao
      await report(people.staff.cookie, { quantity: 1, completedOn: '2999-01-01' }).expect(400); // tương lai
      await report(people.staff.cookie, { quantity: 0, completedOn: '2025-02-10' }).expect(400);

      const onTime = (await report(people.staff.cookie, { quantity: 6, completedOn: '2025-02-10', evidence: 'Biên bản 1' }).expect(201)).body;
      const rejected = (await report(people.staff.cookie, { quantity: 3, completedOn: '2025-02-15' }).expect(201)).body;
      const late = (await report(people.staff.cookie, { quantity: 4, completedOn: '2025-02-26', evidence: 'Biên bản 2' }).expect(201)).body;
      progressIds = [onTime.id, rejected.id, late.id];
      expect(onTime.status).toBe('REPORTED');

      const decide = (cookie: string, id: string, body: object) => post(cookie, `/api/tasking/progress/${id}/decision`, body);
      await decide(people.staff.cookie, onTime.id, { decision: 'CONFIRM' }).expect(403);
      await decide(people.deputy.cookie, onTime.id, { decision: 'CONFIRM' }).expect(403); // không phải cấp trên trực tiếp
      await decide(people.head.cookie, rejected.id, { decision: 'REJECT' }).expect(400); // thiếu lý do
      await decide(people.head.cookie, onTime.id, { decision: 'CONFIRM' }).expect(201);
      await decide(people.head.cookie, rejected.id, { decision: 'REJECT', note: 'Thiếu căn cứ' }).expect(400); // thiếu majorError
      await decide(people.head.cookie, rejected.id, { decision: 'REJECT', note: 'Thiếu căn cứ', majorError: true }).expect(201);
      await decide(people.head.cookie, late.id, { decision: 'CONFIRM' }).expect(201);
      await decide(people.head.cookie, onTime.id, { decision: 'REJECT', note: 'đổi ý', majorError: true }).expect(409); // xử lý một lần

      const view = (await get(people.staff.cookie, `/api/tasking/assignments/${assignmentId}`).expect(200)).body;
      expect(view.summary).toMatchObject({ confirmedQuantity: 10, pendingQuantity: 0, lateCount: 1, reworkCount: 1, done: true });
    });

    it('CSDL: lần báo cáo đã xử lý không sửa, không xóa được', async () => {
      await expect(db.query(`UPDATE work_progress SET quantity = 1 WHERE id = $1`, [progressIds[0]])).rejects.toThrow(/đã được xử lý/);
      await expect(db.query(`DELETE FROM work_progress WHERE id = $1`, [progressIds[1]])).rejects.toThrow(/đã được xử lý/);
    });

    it('hủy việc: chỉ cấp trên trực tiếp, không hủy được việc đã có kết quả xác nhận, việc hủy không nhận báo cáo', async () => {
      await post(people.head.cookie, `/api/tasking/assignments/${assignmentId}/cancel`).expect(409);

      const extra = (await post(people.head.cookie, '/api/tasking/assignments', assignBody({ catalogItemCode: 'A.003', plannedQuantity: 2 })).expect(201)).body.assignment.id;
      await post(people.deputy.cookie, `/api/tasking/assignments/${extra}/cancel`).expect(403);
      await post(people.head.cookie, `/api/tasking/assignments/${extra}/cancel`).expect(201);
      await post(people.staff.cookie, `/api/tasking/assignments/${extra}/progress`, { quantity: 1, completedOn: '2025-02-10' }).expect(409);
    });

    it('thông báo (ADR-029): đúng người nhận, chỉ đọc và đánh dấu của chính mình, không lộ nội dung nhạy cảm', async () => {
      const mine = async (who: Who, query = '') => (await get(people[who].cookie, `/api/notifications${query}`).expect(200)).body;

      const staff = await mine('staff');
      const types = staff.items.map((n: any) => n.type);
      expect(types).toEqual(expect.arrayContaining(['TASK_ASSIGNED', 'TASK_CONFIRMED', 'TASK_REJECTED', 'TASK_CANCELLED']));
      expect(staff.unread).toBe(staff.total);
      expect(staff.items.every((n: any) => n.link === null || n.link.startsWith('/tasks?open='))).toBe(true);
      expect((await mine('head')).items.map((n: any) => n.type)).toContain('TASK_REPORTED');

      // chỉ đọc của chính mình: người khác không thấy, không đánh dấu được
      const first = staff.items[0];
      expect((await mine('other')).items.map((n: any) => n.id)).not.toContain(first.id);
      await post(people.other.cookie, `/api/notifications/${first.id}/read`).expect(404);
      await post(people.staff.cookie, '/api/notifications/khong-phai-uuid/read').expect(400);

      await post(people.staff.cookie, `/api/notifications/${first.id}/read`).expect(204);
      await post(people.staff.cookie, `/api/notifications/${first.id}/read`).expect(204); // đánh dấu lặp lại vẫn ổn
      const count = (await get(people.staff.cookie, '/api/notifications/unread-count').expect(200)).body.unread;
      expect(count).toBe(staff.total - 1);
      expect((await mine('staff', '?unread=1')).items.map((n: any) => n.id)).not.toContain(first.id);
      expect((await mine('staff', '?pageSize=1')).items).toHaveLength(1);
      await get(people.staff.cookie, '/api/notifications?pageSize=1000').expect(400);

      const all = await post(people.staff.cookie, '/api/notifications/read-all').expect(200);
      expect(all.body.marked).toBe(count);
      expect((await get(people.staff.cookie, '/api/notifications/unread-count').expect(200)).body.unread).toBe(0);
      expect((await mine('head')).unread).toBeGreaterThan(0); // đánh dấu của staff không ảnh hưởng người khác

      // người chưa gắn cán bộ không có thông báo; chưa đăng nhập bị chặn
      expect((await get(unlinked.cookie, '/api/notifications').expect(200)).body).toMatchObject({ items: [], total: 0, unread: 0 });
      await http().get('/api/notifications').expect(401);
      await http().get('/api/notifications/unread-count').expect(401);
    });

    describe('tạo hồ sơ từ việc', () => {
      let quarterId: string;
      let monthId: string;
      let evaluationId: string;
      let lineId: string;

      beforeAll(async () => {
        quarterId = (await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'QUARTER', year: 2025, number: 1 }).expect(201)).body.id;
        monthId = (await post(vanPhong.cookie, '/api/evaluation/periods', { type: 'MONTH', year: 2025, number: 3 }).expect(201)).body.id;
      });

      it('chỉ người có quyền quản lý kỳ mới tạo được', async () => {
        for (const cookie of [people.head.cookie, people.staff.cookie, people.boss.cookie, sysAdmin.cookie, dataAdmin.cookie]) {
          await post(cookie, `/api/evaluation/periods/${quarterId}/generate`).expect(403);
        }
        await post(vanPhong.cookie, '/api/evaluation/periods/00000000-0000-0000-0000-000000000000/generate').expect(404);
      });

      it('điền hồ sơ từ việc đã xác nhận: số lượng, số lần chậm, số lần chưa đạt, nguồn; làm lại cho kết quả như nhau', async () => {
        const first = (await post(vanPhong.cookie, `/api/evaluation/periods/${quarterId}/generate`).expect(200)).body;
        expect(first).toMatchObject({ period: '2025-Q1', skipped: [] });
        const mine = first.evaluations.find((e: any) => e.personId === people.staff.personId);
        expect(mine).toMatchObject({ created: true, lines: 1 });
        evaluationId = mine.evaluationId;

        const view = (await get(people.staff.cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(200)).body;
        expect(view.evaluation).toMatchObject({ status: 'PLANNED', createdBy: expect.any(String) });
        expect(view.tasks).toHaveLength(1);
        expect(view.tasks[0]).toMatchObject({ catalogItemCode: 'B.009', plannedQuantity: 10, completedQuantity: 10, lateCount: 1, reworkCount: 1, evidence: 'Biên bản 1 | Biên bản 2', sourceTaskTitles: ['Nhiệm vụ thử giao việc'] });
        expect(view.tasks[0].sourceAssignmentIds).toEqual([assignmentId]);
        lineId = view.tasks[0].id;

        const second = (await post(vanPhong.cookie, `/api/evaluation/periods/${quarterId}/generate`).expect(200)).body;
        const again = second.evaluations.find((e: any) => e.personId === people.staff.personId);
        expect(again).toMatchObject({ created: false, evaluationId });
        expect((await get(people.staff.cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(200)).body.tasks).toHaveLength(1);
      });

      it('việc không thuộc kỳ thì không vào hồ sơ: tháng 3/2025 không có việc nào của cán bộ này', async () => {
        const result = (await post(vanPhong.cookie, `/api/evaluation/periods/${monthId}/generate`).expect(200)).body;
        expect(result.evaluations.find((e: any) => e.personId === people.staff.personId)).toBeUndefined();
      });

      it('dòng lấy từ việc: cán bộ không tự sửa kết quả, cấp trên không xóa tay', async () => {
        await http().patch(`/api/evaluation/tasks/${lineId}/result`).set('Cookie', people.staff.cookie).send({ completedQuantity: 10 }).expect(409);
        await http().delete(`/api/evaluation/tasks/${lineId}`).set('Cookie', people.head.cookie).expect(409);
      });

      it('đi tiếp luồng thẩm định và phê duyệt; hồ sơ đã tự chấm trở đi không bị tạo lại; điểm đúng', async () => {
        await post(people.staff.cookie, `/api/evaluation/evaluations/${evaluationId}/self-submit`, { generalScore: 25 }).expect(201);
        const reviewed = await post(people.head.cookie, `/api/evaluation/evaluations/${evaluationId}/review`, {
          generalScore: 25,
          tasks: [{ taskId: lineId, qualityLevel: 1 }],
        }).expect(201);
        // B.009 là công việc chuẩn (hệ số 1): hoàn thành đủ 10/10, chất lượng mức 1 → 70 điểm kết quả.
        // Việc nguồn có 1 lần chậm và 1 lần chưa đạt: B = C = 75% → KPI = (1 + 0,75 + 0,75) / 3 → 58,33; tổng 25 + 58,33 = 83,33.
        expect(reviewed.body.evaluation).toMatchObject({ status: 'REVIEWED', resultScore: 58.33, totalScore: 83.33, rating: 'HOAN_THANH_TOT' });
        expect(reviewed.body.preview.breakdown).toEqual({ quantity: 1, quality: 0.75, timeliness: 0.75, leadership: null, kpi: 0.8333 });
        await post(people.deputy.cookie, `/api/evaluation/evaluations/${evaluationId}/approve`, {}).expect(201);

        const again = (await post(vanPhong.cookie, `/api/evaluation/periods/${quarterId}/generate`).expect(200)).body;
        expect(again.skipped).toEqual([expect.objectContaining({ personId: people.staff.personId, reason: expect.stringContaining('APPROVED') })]);
        expect((await get(people.staff.cookie, `/api/evaluation/evaluations/${evaluationId}`).expect(200)).body.tasks[0]).toMatchObject({ completedQuantity: 10 });
      });

      it('cán bộ lãnh đạo (trưởng phòng) phải được chấm tiêu chí D; điểm = KPI × 70 với KPI = (a + b + c + d + đ + e) / 6', async () => {
        const created = await post(people.deputy.cookie, `/api/evaluation/periods/${monthId}/evaluations`, { personId: people.head.personId }).expect(201);
        const id = created.body.id;
        const task = (await post(people.deputy.cookie, `/api/evaluation/evaluations/${id}/tasks`, { catalogItemCode: 'B.009', plannedQuantity: 4 }).expect(201)).body.id;
        await http().patch(`/api/evaluation/tasks/${task}/result`).set('Cookie', people.head.cookie).send({ completedQuantity: 4 }).expect(200);
        await post(people.head.cookie, `/api/evaluation/evaluations/${id}/self-submit`, { generalScore: 25 }).expect(201);

        const view = (await get(people.deputy.cookie, `/api/evaluation/evaluations/${id}`).expect(200)).body;
        expect(view).toMatchObject({ isLeader: true, leadershipSuggestion: { unitResult: null } });

        const review = (body: object) => post(people.deputy.cookie, `/api/evaluation/evaluations/${id}/review`, { generalScore: 25, tasks: [{ taskId: task, qualityLevel: 1 }], ...body });
        await review({}).expect(400); // thiếu D
        await review({ leadership: { unitResult: 0.7, organizing: 1, solidarity: 1 } }).expect(400); // chỉ 100% hoặc 50%
        const reviewed = await review({ leadership: { unitResult: 1, organizing: 1, solidarity: 0.5 } }).expect(201);
        expect(reviewed.body.evaluation).toMatchObject({ resultScore: 64.17, totalScore: 89.17, rating: 'HOAN_THANH_TOT', leadership: { unitResult: 1, organizing: 1, solidarity: 0.5 } });
        expect(reviewed.body.preview.breakdown).toEqual({ quantity: 1, quality: 1, timeliness: 1, leadership: 0.8333, kpi: 0.9167 });

        // người không lãnh đạo thì không được gửi D
        const staffEval = (await post(people.head.cookie, `/api/evaluation/periods/${monthId}/evaluations`, { personId: people.staff.personId }).expect(201)).body.id;
        await post(people.head.cookie, `/api/evaluation/evaluations/${staffEval}/tasks`, { catalogItemCode: 'B.009', plannedQuantity: 1 }).expect(201);
        await post(people.staff.cookie, `/api/evaluation/evaluations/${staffEval}/self-submit`, { generalScore: 20 }).expect(201);
        await post(people.head.cookie, `/api/evaluation/evaluations/${staffEval}/review`, {
          generalScore: 20, leadership: { unitResult: 1, organizing: 1, solidarity: 1 }, tasks: [],
        }).expect(400);
      });

      it('cộng tác trên việc: người duyệt (cc), người tham vấn, theo dõi có lọc, trao đổi, tệp đính kèm (ADR-024)', async () => {
      const body = (over: object = {}) => assignBody({ dueDate: '2027-03-01', note: 'Soạn báo cáo kèm số liệu quý I', ...over });

      // người duyệt phải là cấp trên của người nhận; người tham vấn không phải người nhận
      await post(people.head.cookie, '/api/tasking/assignments', body({ approverPersonId: people.other.personId })).expect(400);
      await post(people.head.cookie, '/api/tasking/assignments', body({ consultantPersonIds: [people.staff.personId] })).expect(400);
      await post(people.head.cookie, '/api/tasking/assignments', body({ consultantPersonIds: ['khong-phai-uuid'] })).expect(400);
      await post(people.head.cookie, '/api/tasking/assignments', body({ note: 'x'.repeat(4001) })).expect(400);

      const created = await post(people.head.cookie, '/api/tasking/assignments', body({ approverPersonId: people.deputy.personId, consultantPersonIds: [people.other.personId] })).expect(201);
      const id = created.body.assignment.id as string;
      expect(created.body).toMatchObject({
        approverPersonId: people.deputy.personId,
        confirmerPersonId: people.deputy.personId,
        consultantPersonIds: [people.other.personId],
        state: 'IN_PROGRESS',
      });
      expect(created.body.assignment.note).toBe('Soạn báo cáo kèm số liệu quý I');
      expect(typeof created.body.assignment.createdAt).toBe('string');

      // người duyệt được chọn mới xác nhận được
      const report = await post(people.staff.cookie, `/api/tasking/assignments/${id}/progress`, { quantity: 2, completedOn: '2025-03-01' }).expect(201);
      await post(people.head.cookie, `/api/tasking/progress/${report.body.id}/decision`, { decision: 'CONFIRM' }).expect(403);
      await post(people.deputy.cookie, `/api/tasking/progress/${report.body.id}/decision`, { decision: 'CONFIRM' }).expect(201);

      // theo dõi: được tham vấn, chờ tôi duyệt, tôi đã giao; lọc và phân trang
      const search = (cookie: string, query: string) => get(cookie, `/api/tasking/assignments/search?${query}`);
      expect((await search(people.other.cookie, 'scope=consulted').expect(200)).body.items.map((v: any) => v.assignment.id)).toContain(id);
      expect((await search(people.staff.cookie, 'scope=consulted').expect(200)).body.items).toHaveLength(0);
      expect((await search(people.deputy.cookie, 'scope=approving').expect(200)).body.items.map((v: any) => v.assignment.id)).toContain(id);
      expect((await search(people.head.cookie, 'scope=assigned').expect(200)).body.items.map((v: any) => v.assignment.id)).toContain(id);
      const page = (await search(people.staff.cookie, 'scope=mine&pageSize=1&page=1&sort=created').expect(200)).body;
      expect(page).toMatchObject({ page: 1, pageSize: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBeGreaterThan(1);
      expect(Object.keys(page.stateCounts).sort()).toEqual(['CANCELLED', 'DONE', 'IN_PROGRESS', 'OVERDUE', 'PENDING_CONFIRM']);
      const found = (await search(people.staff.cookie, `scope=mine&q=${encodeURIComponent('so lieu quy i')}&states=IN_PROGRESS,OVERDUE`).expect(200)).body;
      expect(found.items.map((v: any) => v.assignment.id)).toEqual([id]); // khớp nội dung không cần dấu
      await search(people.staff.cookie, 'scope=mine&page=0').expect(400);
      await search(people.staff.cookie, 'scope=mine&pageSize=500').expect(400);
      await search(people.staff.cookie, 'scope=mine&states=XONG').expect(400);
      await search(people.staff.cookie, 'scope=mine&dueFrom=01/01/2027').expect(400);
      await search(people.staff.cookie, 'scope=all').expect(403);
      await search(people.boss.cookie, 'scope=all').expect(200);
      await search(unlinked.cookie, 'scope=mine').expect(200);
      await http().get('/api/tasking/assignments/search?scope=mine').expect(401);

      // sửa: chỉ người giao
      const patch = (cookie: string, b: object) => http().patch(`/api/tasking/assignments/${id}`).set('Cookie', cookie).send(b);
      await patch(people.staff.cookie, { note: 'x' }).expect(403);
      await patch(people.deputy.cookie, { note: 'x' }).expect(403);
      const edited = await patch(people.head.cookie, { note: 'Nội dung đã sửa', consultantPersonIds: [people.other.personId, people.boss.personId] }).expect(200);
      expect(edited.body.assignment.note).toBe('Nội dung đã sửa');
      expect(edited.body.consultantPersonIds).toHaveLength(2);
      await patch(people.head.cookie, { approverPersonId: people.other.personId }).expect(400);

      // trao đổi
      const comments = (cookie: string, b: object) => post(cookie, `/api/tasking/assignments/${id}/comments`, b);
      await comments(people.staff.cookie, { body: '   ' }).expect(400);
      await comments(people.staff.cookie, { body: 'Em đã gửi bản nháp', kind: 'OPINION' }).expect(403); // không phải người tham vấn
      await comments(unlinked.cookie, { body: 'Tôi xin góp ý' }).expect(403); // không phải thành viên
      const message = (await comments(people.staff.cookie, { body: 'Em đã gửi bản nháp' }).expect(201)).body;
      const opinion = (await comments(people.other.cookie, { body: 'Nên bổ sung số liệu quý II', kind: 'OPINION' }).expect(201)).body;
      expect([message.kind, opinion.kind]).toEqual(['MESSAGE', 'OPINION']);
      await comments(people.boss.cookie, { body: 'Đã theo dõi' }).expect(201); // boss là người tham vấn sau khi được thêm

      // tệp đính kèm: MinIO
      const pdfBytes = Buffer.from('%PDF-1.4 tep e2e');
      const upload = (cookie: string, name: string, bytes: Buffer, fields: Record<string, string> = {}) => {
        let req = http().post(`/api/tasking/assignments/${id}/attachments`).set('Cookie', cookie);
        for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
        return req.attach('file', bytes, name);
      };
      await http().post(`/api/tasking/assignments/${id}/attachments`).set('Cookie', people.staff.cookie).expect(400); // chưa chọn tệp
      await upload(people.staff.cookie, 'chay.exe', Buffer.from('MZ....')).expect(400);
      await upload(people.staff.cookie, 'gia.pdf', Buffer.from('MZ không phải pdf')).expect(400);
      await upload(unlinked.cookie, 'a.pdf', pdfBytes).expect(403);
      const stored = (await upload(people.staff.cookie, 'Báo cáo quý I.pdf', pdfBytes, { commentId: message.id }).expect(201)).body;
      expect(stored).toMatchObject({ fileName: 'Báo cáo quý I.pdf', contentType: 'application/pdf', sizeBytes: pdfBytes.length, commentId: message.id });
      await upload(people.staff.cookie, 'b.pdf', pdfBytes, { commentId: opinion.id }).expect(403); // tin nhắn của người khác

      const conversation = (await get(people.other.cookie, `/api/tasking/assignments/${id}/conversation`).expect(200)).body;
      expect(conversation.comments.map((c: any) => c.body)).toEqual(['Em đã gửi bản nháp', 'Nên bổ sung số liệu quý II', 'Đã theo dõi']);
      expect(conversation.attachments).toHaveLength(1);
      await get(unlinked.cookie, `/api/tasking/assignments/${id}/conversation`).expect(403);
      await get(people.deputy.cookie, `/api/tasking/assignments/${id}/conversation`).expect(200); // người duyệt

      const download = (cookie: string, fileId: string) =>
        get(cookie, `/api/tasking/assignments/${id}/attachments/${fileId}`)
          .buffer(true)
          .parse((res, cb) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
          });
      const file = await download(people.other.cookie, stored.id).expect(200);
      expect((file.body as Buffer).toString()).toBe('%PDF-1.4 tep e2e');
      expect(file.headers['content-disposition']).toContain('attachment; filename="B_o c_o qu_ I.pdf"');
      expect(file.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('Báo cáo quý I.pdf')}`);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      const viewed = await get(people.other.cookie, `/api/tasking/assignments/${id}/attachments/${stored.id}?inline=1`).expect(200);
      expect(viewed.headers['content-disposition']).toMatch(/^inline;/);
      await get(unlinked.cookie, `/api/tasking/assignments/${id}/attachments/${stored.id}?inline=1`).expect(403);
      await download(unlinked.cookie, stored.id).expect(403);
      await download(people.other.cookie, '00000000-0000-4000-8000-000000000000').expect(404);
      await http().get(`/api/tasking/assignments/${id}/attachments/${stored.id}`).expect(401);

      // tin nhắn và tệp là nhật ký: CSDL không cho sửa, xóa
      await expect(db.query(`UPDATE work_comment SET body = 'sửa' WHERE id = $1`, [message.id])).rejects.toThrow(/không được sửa hoặc xóa/);
      await expect(db.query(`DELETE FROM work_comment WHERE id = $1`, [message.id])).rejects.toThrow(/không được sửa hoặc xóa/);
      await expect(db.query(`DELETE FROM work_attachment WHERE id = $1`, [stored.id])).rejects.toThrow(/không được sửa hoặc xóa/);

      // nhật ký hệ thống ghi tải lên và tải xuống, không ghi nội dung tin nhắn
      const logs = await auditRows(`WHERE action IN ('tasking.attachment.upload', 'tasking.attachment.download', 'tasking.comment.create') AND target_id IN ($1, $2, $3)`, [stored.id, message.id, opinion.id]);
      expect(logs.map((r) => r.action).sort()).toEqual(['tasking.attachment.download', 'tasking.attachment.download', 'tasking.attachment.upload', 'tasking.comment.create', 'tasking.comment.create']);
      expect(JSON.stringify(logs)).not.toContain('Nên bổ sung số liệu');

      // màn "Tài liệu trong công việc" (ADR-025): thành viên thấy tệp, người ngoài không thấy
      const mine = (await get(people.staff.cookie, `/api/tasking/files?q=${encodeURIComponent('bao cao quy i')}`).expect(200)).body;
      expect(mine.items.map((f: any) => f.id)).toContain(stored.id);
      expect(mine.items[0]).not.toHaveProperty('storageKey');
      expect(mine.items.find((f: any) => f.id === stored.id)).toMatchObject({ assignmentId: id, uploadedByPersonId: people.staff.personId });
      expect((await get(unlinked.cookie, '/api/tasking/files').expect(200)).body.total).toBe(0);
      await get(people.staff.cookie, '/api/tasking/files?page=0').expect(400);
      await get(people.staff.cookie, '/api/tasking/files?from=01/01/2027').expect(400);
      await http().get('/api/tasking/files').expect(401);

      // dọn: việc đã có kết quả xác nhận nên không hủy được; đổi hạn không cần vì đã nằm ngoài các kỳ thử
      await post(people.head.cookie, `/api/tasking/assignments/${id}/cancel`).expect(409);
    });

    it('nhật ký ghi giao việc, báo cáo, xác nhận, từ chối, hủy và tạo hồ sơ', async () => {
        const actions = (await auditRows(`WHERE action LIKE 'tasking.%' OR action = 'evaluation.generate'`)).map((r) => r.action);
        for (const expected of [
          'tasking.task.create',
          'tasking.assignment.create',
          'tasking.progress.report',
          'tasking.progress.confirm',
          'tasking.progress.reject',
          'tasking.assignment.cancel',
          'evaluation.generate',
        ]) {
          expect(actions).toContain(expected);
        }
      });
    });
  });

  describe('quản lý tài liệu (ADR-025)', () => {
    const post = (cookie: string, url: string, body: object = {}) => http().post(url).set('Cookie', cookie).send(body);
    const get = (cookie: string, url: string) => http().get(url).set('Cookie', cookie);

    it('danh mục và bài đăng: chỉ người quản lý tạo; mọi người dùng xem; tệp tải qua máy chủ; có nhật ký', async () => {
      const office = await createUser('VAN_PHONG');
      const staff = await createUser('CHUYEN_VIEN');
      const admin = await createUser('QUAN_TRI_HE_THONG');
      const name = `Quy chế ${prefix}`;

      // danh mục
      await post(staff.cookie, '/api/documents/categories', { name }).expect(403);
      await post(office.cookie, '/api/documents/categories', {}).expect(400);
      const category = (await post(office.cookie, '/api/documents/categories', { name, description: 'Văn bản quy định' }).expect(201)).body;
      await post(office.cookie, '/api/documents/categories', { name: name.toLowerCase() }).expect(409);
      expect((await get(staff.cookie, '/api/documents/categories').expect(200)).body.map((c: any) => c.id)).toContain(category.id);
      await get(admin.cookie, '/api/documents/categories').expect(403); // quản trị hệ thống không có quyền xem tài liệu
      await http().get('/api/documents/categories').expect(401);

      // đăng bài kèm tệp (multipart)
      const publish = (cookie: string, fields: Record<string, string>, files: { name: string; bytes: Buffer }[] = []) => {
        let req = http().post('/api/documents/posts').set('Cookie', cookie);
        for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
        for (const f of files) req = req.attach('files', f.bytes, f.name);
        return req;
      };
      const pdfBytes = Buffer.from('%PDF-1.4 tai lieu e2e');
      await publish(staff.cookie, { categoryId: category.id, title: 'Không được đăng' }).expect(403);
      await publish(office.cookie, { categoryId: category.id }).expect(400); // thiếu tiêu đề
      await publish(office.cookie, { categoryId: category.id, title: 'Có tệp xấu' }, [{ name: 'chay.exe', bytes: Buffer.from('MZ') }]).expect(400);
      const created = (
        await publish(office.cookie, { categoryId: category.id, title: 'Quy chế làm việc 2026', summary: 'Áp dụng từ tháng 10' }, [{ name: 'Quy chế làm việc.pdf', bytes: pdfBytes }]).expect(201)
      ).body;
      expect(created).toMatchObject({ title: 'Quy chế làm việc 2026', categoryName: name, status: 'PUBLISHED' });
      expect(created.files).toHaveLength(1);
      expect(created.files[0]).not.toHaveProperty('storageKey');

      // xem, lọc, phân trang
      const list = (await get(staff.cookie, `/api/documents/posts?q=${encodeURIComponent('quy che lam viec')}&categoryId=${category.id}`).expect(200)).body;
      expect(list.items.map((p: any) => p.id)).toEqual([created.id]);
      await get(staff.cookie, '/api/documents/posts?page=0').expect(400);
      await get(staff.cookie, '/api/documents/posts?pageSize=101').expect(400);
      expect((await get(staff.cookie, '/api/documents/categories').expect(200)).body.find((c: any) => c.id === category.id).postCount).toBe(1);

      // tải tệp
      const fileId = created.files[0].id as string;
      const file = await get(staff.cookie, `/api/documents/posts/${created.id}/files/${fileId}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((file.body as Buffer).toString()).toBe('%PDF-1.4 tai lieu e2e');
      expect(file.headers['content-disposition']).toContain('attachment;');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      await get(admin.cookie, `/api/documents/posts/${created.id}/files/${fileId}`).expect(403);
      // xem trực tiếp (?inline=1): pdf xem được, định dạng Office thì phải tải về
      const inline = await get(staff.cookie, `/api/documents/posts/${created.id}/files/${fileId}?inline=1`).expect(200);
      expect(inline.headers['content-disposition']).toMatch(/^inline;/);
      expect(inline.headers['content-security-policy']).toMatch(/^frame-ancestors /);
      expect(inline.headers['x-content-type-options']).toBe('nosniff');
      const docxPost = (
        await publish(office.cookie, { categoryId: category.id, title: 'Tệp Word' }, [{ name: 'Mau.docx', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]) }]).expect(201)
      ).body;
      const docxId = docxPost.files[0].id as string;
      await get(staff.cookie, `/api/documents/posts/${docxPost.id}/files/${docxId}?inline=1`).expect(400);
      await get(staff.cookie, `/api/documents/posts/${docxPost.id}/files/${docxId}`).expect(200).expect((r) => expect(r.headers['content-disposition']).toMatch(/^attachment;/));
      await http().delete(`/api/documents/posts/${docxPost.id}`).set('Cookie', office.cookie).expect(204);

      // sửa, gỡ
      await http().patch(`/api/documents/posts/${created.id}`).set('Cookie', staff.cookie).send({ title: 'x' }).expect(403);
      const edited = await http().patch(`/api/documents/posts/${created.id}`).set('Cookie', office.cookie).send({ title: 'Quy chế làm việc (sửa)' }).expect(200);
      expect(edited.body.title).toBe('Quy chế làm việc (sửa)');
      await http().delete(`/api/documents/categories/${category.id}`).set('Cookie', office.cookie).expect(409); // còn bài
      await http().delete(`/api/documents/posts/${created.id}`).set('Cookie', staff.cookie).expect(403);
      await http().delete(`/api/documents/posts/${created.id}`).set('Cookie', office.cookie).expect(204);
      await get(staff.cookie, `/api/documents/posts/${created.id}`).expect(404);
      expect((await get(staff.cookie, '/api/documents/posts?q=quy%20che%20lam%20viec').expect(200)).body.items.map((p: any) => p.id)).not.toContain(created.id);
      await http().delete(`/api/documents/categories/${category.id}`).set('Cookie', office.cookie).expect(409); // bài đã gỡ vẫn được lưu
      const empty = (await post(office.cookie, '/api/documents/categories', { name: `Trống ${prefix}` }).expect(201)).body;
      await http().delete(`/api/documents/categories/${empty.id}`).set('Cookie', office.cookie).expect(204);

      // tệp của bài là nhật ký: CSDL không cho sửa, xóa
      await expect(db.query(`DELETE FROM document_file WHERE id = $1`, [fileId])).rejects.toThrow(/không được sửa hoặc xóa/);

      const actions = (await auditRows(`WHERE action LIKE 'document.%' AND (target_id = $1 OR target_id = $2 OR target_id = $3)`, [category.id, created.id, fileId])).map((r) => r.action);
      expect((await auditRows(`WHERE action = 'document.category.delete' AND target_id = $1`, [empty.id])).length).toBe(1);
      for (const expected of ['document.category.create', 'document.post.publish', 'document.file.download', 'document.post.update', 'document.post.withdraw']) {
        expect(actions).toContain(expected);
      }
    });
  });

  describe('báo cáo, xuất tệp và dự thảo', () => {
    // Dùng dữ liệu do bài "đánh giá theo kỳ" để lại: kỳ 2031-Q3 có hồ sơ của staff (đã phê duyệt, 89 điểm)
    // và của other (đã bị trả lại, đang thực hiện), cùng thuộc một đơn vị.
    let periodId: string;
    let vanPhong: { cookie: string };
    let boss: { cookie: string };
    let head: { cookie: string };
    let staff: { cookie: string };
    let sysAdmin: { cookie: string };
    let unlinked: { cookie: string };

    const binary = (cookie: string, url: string) =>
      http()
        .get(url)
        .set('Cookie', cookie)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

    beforeAll(async () => {
      vanPhong = await createUser('VAN_PHONG');
      sysAdmin = await createUser('QUAN_TRI_HE_THONG');
      unlinked = await createUser('CHUYEN_VIEN');
      // Tài khoản của người thuộc chuỗi quản lý được tạo ở bài trước: đăng nhập lại theo vai trò.
      const rows = await db.query(
        `SELECT a.username, r.role, p.full_name FROM account a
           JOIN account_role r ON r.account_id = a.id AND r.revoked_at IS NULL
           JOIN person p ON p.id = a.person_id
          WHERE p.full_name LIKE $1`,
        [`Cán bộ % ${prefix}`],
      );
      expect(rows).toHaveLength(5);
      const login = async (name: string) => {
        const row = rows.find((r: any) => r.full_name === `Cán bộ ${name} ${prefix}`);
        const res = await http().post('/api/auth/login').send({ username: row.username, password }).expect(200);
        return { cookie: cookieOf(res) };
      };
      boss = await login('boss');
      head = await login('head');
      staff = await login('staff');
      const period = (await http().get('/api/evaluation/periods').set('Cookie', vanPhong.cookie).expect(200)).body.find((p: any) => p.label === '2031-Q3');
      periodId = period.id;
    });

    const dashboard = (cookie: string) => http().get(`/api/reporting/periods/${periodId}/dashboard`).set('Cookie', cookie);
    const staffName = () => `Cán bộ staff ${prefix}`;
    const otherName = () => `Cán bộ other ${prefix}`;

    it('dashboard toàn Ban cho người có quyền xem tất cả: số liệu khớp với dữ liệu thật', async () => {
      const res = await dashboard(vanPhong.cookie).expect(200);
      expect(res.body.scope).toBe('ALL');
      expect(res.body.period).toMatchObject({ label: '2031-Q3', startDate: '2031-07-01', endDate: '2031-09-30' });

      const names = res.body.rows.map((r: any) => r.fullName);
      expect(names).toEqual(expect.arrayContaining([staffName(), otherName()]));
      const staffRow = res.body.rows.find((r: any) => r.fullName === staffName());
      expect(staffRow).toMatchObject({ status: 'APPROVED', generalScore: 25, resultScore: 70, totalScore: 95, rating: 'XUAT_SAC', unitName: 'Đơn vị thử đánh giá', positionTitle: 'Chuyên viên thử' });
      expect(res.body.rows.find((r: any) => r.fullName === otherName())).toMatchObject({ status: 'PLANNED', totalScore: null, rating: null });

      const unit = res.body.byUnit.find((u: any) => u.unitCode === `${prefix.toUpperCase()}EV`);
      expect(unit).toMatchObject({ evaluations: 2, approved: 1, inProgress: 1, averageTotal: 95, completionRate: 0.5 });
      expect(unit.ratings).toEqual({ XUAT_SAC: 1, HOAN_THANH_TOT: 0, HOAN_THANH: 0, KHONG_HOAN_THANH: 0 });
      expect(res.body.overall.approved).toBe(res.body.byUnit.reduce((n: number, u: any) => n + u.approved, 0));
      expect(res.body.notes.join('\n')).toMatch(/chính sách v3-nd335/);
    });

    it('dashboard bị giới hạn theo phạm vi: cấp trên thấy cấp dưới, cán bộ chỉ thấy mình', async () => {
      const asHead = await dashboard(head.cookie).expect(200);
      expect(asHead.body.scope).toBe('LIMITED');
      expect(asHead.body.rows.map((r: any) => r.fullName).sort()).toEqual([otherName(), staffName()].sort());
      expect(asHead.body.notes.join('\n')).toMatch(/phạm vi của bạn/);

      const asStaff = await dashboard(staff.cookie).expect(200);
      expect(asStaff.body.scope).toBe('LIMITED');
      expect(asStaff.body.rows.map((r: any) => r.fullName)).toEqual([staffName()]);
      expect(JSON.stringify(asStaff.body)).not.toContain(otherName());

      expect((await dashboard(unlinked.cookie).expect(200)).body.rows).toEqual([]);
      const asBoss = await dashboard(boss.cookie).expect(200);
      expect(asBoss.body.scope).toBe('ALL'); // Trưởng ban có quyền xem tất cả
    });

    it('xu hướng qua các kỳ: đúng phạm vi người xem, tham số sai bị từ chối, quản trị hệ thống không xem được', async () => {
      const trend = (cookie: string, q = 'type=QUARTER') => http().get(`/api/reporting/trend?${q}`).set('Cookie', cookie);
      const all = await trend(vanPhong.cookie).expect(200);
      expect(all.body.scope).toBe('ALL');
      const point = all.body.points.find((p: any) => p.period.label === '2031-Q3');
      expect(point).toMatchObject({ evaluations: 2, approved: 1, averageTotal: 95 });
      const dates = all.body.points.map((p: any) => p.period.startDate);
      expect(dates).toEqual([...dates].sort());
      expect(all.body.points.every((p: any) => p.period.type === 'QUARTER')).toBe(true);

      const asStaff = await trend(staff.cookie).expect(200);
      expect(asStaff.body.scope).toBe('LIMITED');
      expect(asStaff.body.points.find((p: any) => p.period.label === '2031-Q3')).toMatchObject({ evaluations: 1 });
      expect(JSON.stringify(asStaff.body)).not.toContain(otherName());

      await trend(vanPhong.cookie, 'type=WEEK').expect(400);
      await trend(vanPhong.cookie, 'type=QUARTER&limit=99').expect(400);
      await trend(sysAdmin.cookie).expect(403);
      await http().get('/api/reporting/trend?type=QUARTER').expect(401);
    });

    it('quản trị hệ thống và người chưa đăng nhập không xem được; kỳ không tồn tại thì 404', async () => {
      await dashboard(sysAdmin.cookie).expect(403);
      await http().get(`/api/reporting/periods/${periodId}/dashboard`).expect(401);
      await http().get('/api/reporting/periods/khong-phai-uuid/dashboard').set('Cookie', vanPhong.cookie).expect(400);
      await http().get('/api/reporting/periods/11111111-1111-4111-8111-111111111111/dashboard').set('Cookie', vanPhong.cookie).expect(404);
    });

    it('xuất Excel: tệp mở lại được, số dòng khớp phạm vi của người xuất; tên cán bộ đủ dấu', async () => {
      const res = await binary(vanPhong.cookie, `/api/reporting/periods/${periodId}/export?format=xlsx`).expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toBe('attachment; filename="bao-cao-danh-gia-2031-Q3.xlsx"');
      expect(res.headers['cache-control']).toBe('no-store');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Tổng hợp', 'Chi tiết']);
      const names: string[] = [];
      wb.getWorksheet('Chi tiết')!.eachRow((row, n) => n > 1 && names.push(String(row.getCell(2).value)));
      expect(names).toEqual(expect.arrayContaining([staffName(), otherName()]));

      // Người quản lý chỉ xuất được phần trong phạm vi của mình.
      const asHead = await binary(head.cookie, `/api/reporting/periods/${periodId}/export?format=xlsx`).expect(200);
      const wbHead = new ExcelJS.Workbook();
      await wbHead.xlsx.load(asHead.body as ArrayBuffer);
      expect(wbHead.getWorksheet('Chi tiết')!.rowCount).toBe(3); // tiêu đề + 2 hồ sơ
      const scope = wbHead.getWorksheet('Tổng hợp')!.getRow(4).getCell(2).value;
      expect(String(scope)).toMatch(/phạm vi/);
    });

    it('xuất PDF: tệp hợp lệ', async () => {
      const res = await binary(head.cookie, `/api/reporting/periods/${periodId}/export?format=pdf`).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe('attachment; filename="bao-cao-danh-gia-2031-Q3.pdf"');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect((res.body as Buffer).length).toBeGreaterThan(5_000);
    });

    it('chỉ người có quyền xuất mới xuất được; định dạng sai bị từ chối', async () => {
      await http().get(`/api/reporting/periods/${periodId}/export?format=xlsx`).set('Cookie', staff.cookie).expect(403);
      await http().get(`/api/reporting/periods/${periodId}/export?format=xlsx`).set('Cookie', sysAdmin.cookie).expect(403);
      await http().get(`/api/reporting/periods/${periodId}/export?format=docx`).set('Cookie', vanPhong.cookie).expect(400);
      await http().get(`/api/reporting/periods/${periodId}/export`).set('Cookie', vanPhong.cookie).expect(400);
    });

    it('dự thảo báo cáo và quyết định: điền mẫu từ dữ liệu thật, chỉ gồm hồ sơ đã phê duyệt', async () => {
      const report = await http().get(`/api/reporting/periods/${periodId}/draft?kind=report`).set('Cookie', vanPhong.cookie).expect(200);
      expect(report.body.title).toMatch(/^Dự thảo báo cáo/);
      expect(report.body.body).toContain('kỳ 2031-Q3 (từ 2031-07-01 đến 2031-09-30)');
      expect(report.body.body).toContain('Quy định số 39-QĐ/TU');
      expect(report.body.disclaimer).toMatch(/DỰ THẢO, chỉ để tham khảo/);

      const decision = await http().get(`/api/reporting/periods/${periodId}/draft?kind=decision`).set('Cookie', boss.cookie).expect(200);
      expect(decision.body.body).toContain(`${staffName()} – Chuyên viên thử (Đơn vị thử đánh giá): 95,00 điểm, Hoàn thành xuất sắc nhiệm vụ.`);
      expect(decision.body.body).not.toContain(otherName()); // chưa phê duyệt
      expect(decision.body.approvedCount).toBeGreaterThanOrEqual(1);
    });

    it('tải dự thảo thành tệp Word: mở lại được, có tên cán bộ đã phê duyệt; người không đủ quyền bị từ chối', async () => {
      const res = await binary(vanPhong.cookie, `/api/reporting/periods/${periodId}/draft/file?kind=decision`).expect(200);
      expect(res.headers['content-type']).toMatch(/wordprocessingml/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="du-thao-quyet-dinh-2031-Q3\.docx"$/);
      const xml = await (await JSZip.loadAsync(res.body as Buffer)).file('word/document.xml')!.async('string');
      expect(xml).toContain(staffName());
      expect(xml).not.toContain(otherName()); // hồ sơ chưa phê duyệt không lên văn bản
      for (const { cookie } of [head, staff, sysAdmin, unlinked]) {
        await binary(cookie, `/api/reporting/periods/${periodId}/draft/file?kind=report`).expect(403);
      }
      await binary(vanPhong.cookie, `/api/reporting/periods/${periodId}/draft/file?kind=khac`).expect(400);
    });

    it('dự thảo cần quyền riêng: người quản lý thường, cán bộ, quản trị đều bị từ chối', async () => {
      for (const { cookie } of [head, staff, sysAdmin, unlinked]) {
        await http().get(`/api/reporting/periods/${periodId}/draft?kind=report`).set('Cookie', cookie).expect(403);
      }
      await http().get(`/api/reporting/periods/${periodId}/draft?kind=quyet-dinh`).set('Cookie', vanPhong.cookie).expect(400);
    });

    it('nhật ký ghi việc xem, xuất, lập dự thảo kèm người thực hiện, không ghi tên cán bộ', async () => {
      const rows = await auditRows(`WHERE action LIKE 'report.%' ORDER BY id`);
      const actions = new Set(rows.map((r) => r.action));
      expect(actions).toEqual(new Set(['report.view', 'report.trend', 'report.export', 'report.draft', 'report.draft.export']));
      const exports = rows.filter((r) => r.action === 'report.export');
      expect(exports.some((r) => r.details.format === 'xlsx' && r.details.scope === 'ALL')).toBe(true);
      expect(exports.some((r) => r.details.format === 'pdf' && r.details.scope === 'LIMITED')).toBe(true);
      expect(rows.every((r) => r.actor_account_id)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(staffName());
    });
  });

  describe('nhật ký bất biến', () => {
    it('đăng nhập thành công và thất bại đều được ghi, thất bại không ghi mật khẩu', async () => {
      const { account, username } = await createUser();
      await http().post('/api/auth/login').send({ username, password: 'mat-khau-sai-bi-mat' }).expect(401);

      const ok = await auditRows(`WHERE action = 'auth.login.success' AND actor_account_id = $1`, [account.id]);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      const bad = await auditRows(`WHERE action = 'auth.login.failure' AND target_id = $1`, [account.id]);
      expect(bad).toHaveLength(1);
      expect(bad[0].details).toMatchObject({ reason: 'bad-password', attemptedUsername: username });

      const secrets = await auditRows(`WHERE details::text LIKE '%mat-khau-sai-bi-mat%' OR details::text LIKE '%${password}%'`);
      expect(secrets).toHaveLength(0);
    });

    it('thao tác thay đổi dữ liệu ghi người thực hiện, đối tượng và mã yêu cầu khớp header phản hồi', async () => {
      const { account: admin, cookie } = await createUser('QUAN_TRI_HE_THONG');
      const { account: target } = await createUser();

      const res = await http().post(`/api/accounts/${target.id}/roles`).set('Cookie', cookie).send({ role: 'CHUYEN_VIEN' }).expect(201);
      const requestId = res.headers['x-request-id'];
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

      const rows = await auditRows(`WHERE action = 'role.grant' AND request_id = $1`, [requestId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_account_id: admin.id,
        target_id: target.id,
        outcome: 'SUCCESS',
      });
      expect(rows[0].details).toMatchObject({ role: 'CHUYEN_VIEN', bootstrap: false });
    });

    it('truy cập bị từ chối được ghi cùng người thực hiện và quyền còn thiếu', async () => {
      const { account, cookie } = await createUser('CHUYEN_VIEN');
      await http().get('/api/accounts').set('Cookie', cookie).expect(403);

      const rows = await auditRows(`WHERE action = 'access.denied' AND actor_account_id = $1`, [account.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'DENIED' });
      expect(rows[0].details).toMatchObject({ method: 'GET', path: '/api/accounts', missing: ['account:read'] });
    });

    it('xem danh sách tài khoản (dữ liệu nhạy cảm) cũng được ghi', async () => {
      const { account, cookie } = await createUser('QUAN_TRI_HE_THONG');
      await http().get('/api/accounts').set('Cookie', cookie).expect(200);
      expect(await auditRows(`WHERE action = 'account.list' AND actor_account_id = $1`, [account.id])).toHaveLength(1);
    });

    it('chỉ quản trị dữ liệu đọc được nhật ký; việc đọc cũng được ghi', async () => {
      const dataAdmin = await createUser('QUAN_TRI_DU_LIEU');
      const sysAdmin = await createUser('QUAN_TRI_HE_THONG');
      const viewer = await createUser('CHUYEN_VIEN');

      await http().get('/api/audit-logs').set('Cookie', sysAdmin.cookie).expect(403);
      await http().get('/api/audit-logs').set('Cookie', viewer.cookie).expect(403);
      await http().get('/api/audit-logs/verify').set('Cookie', sysAdmin.cookie).expect(403);

      const res = await http().get('/api/audit-logs?limit=5').set('Cookie', dataAdmin.cookie).expect(200);
      expect(res.body.length).toBeLessThanOrEqual(5);
      expect(res.body[0].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await auditRows(`WHERE action = 'audit.read' AND actor_account_id = $1`, [dataAdmin.account.id])).toHaveLength(1);
    });

    it('lọc theo hành động, phân trang lùi, từ chối tham số sai', async () => {
      const { cookie } = await createUser('QUAN_TRI_DU_LIEU');
      const logins = await http().get('/api/audit-logs?action=auth.login.success&limit=3').set('Cookie', cookie).expect(200);
      expect(logins.body.length).toBeGreaterThan(0);
      expect(logins.body.every((r: any) => r.action === 'auth.login.success')).toBe(true);

      const lastId = logins.body[logins.body.length - 1].id;
      const older = await http().get(`/api/audit-logs?action=auth.login.success&beforeId=${lastId}`).set('Cookie', cookie).expect(200);
      expect(older.body.every((r: any) => Number(r.id) < Number(lastId))).toBe(true);

      await http().get('/api/audit-logs?limit=0').set('Cookie', cookie).expect(400);
      await http().get('/api/audit-logs?limit=9999').set('Cookie', cookie).expect(400);
      await http().get('/api/audit-logs?actorId=khong-phai-uuid').set('Cookie', cookie).expect(400);
      await http().get('/api/audit-logs?beforeId=1;DROP').set('Cookie', cookie).expect(400);
    });

    it('CSDL từ chối UPDATE, DELETE, TRUNCATE trên bảng nhật ký', async () => {
      await expect(db.query(`UPDATE audit_log SET action = 'gia-mao'`)).rejects.toThrow(/chỉ được ghi thêm/);
      await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/chỉ được ghi thêm/);
      await expect(db.query(`TRUNCATE audit_log`)).rejects.toThrow(/chỉ được ghi thêm/);
    });

    it('nhiều thao tác đồng thời vẫn giữ chuỗi băm nguyên vẹn (không đứt, không trùng)', async () => {
      const { username } = await createUser();
      const before = Number((await db.query(`SELECT count(*)::int AS n FROM audit_log`))[0].n);

      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          http()
            .post('/api/auth/login')
            .send({ username, password: i % 2 === 0 ? password : 'sai' })
            .then((r) => expect([200, 401]).toContain(r.status)),
        ),
      );
      const after = Number((await db.query(`SELECT count(*)::int AS n FROM audit_log`))[0].n);
      expect(after - before).toBeGreaterThanOrEqual(20);

      const { cookie } = await createUser('QUAN_TRI_DU_LIEU');
      const verify = await http().get('/api/audit-logs/verify').set('Cookie', cookie).expect(200);
      expect(verify.body).toMatchObject({ valid: true });
      expect(verify.body.checked).toBeGreaterThan(before);
    }, 30_000);

    // Để cuối: làm hỏng chuỗi có chủ đích (CSDL e2e được tạo lại ở lần chạy sau).
    it('phát hiện bản ghi bị sửa kể cả khi kẻ tấn công tắt được trigger', async () => {
      const { cookie } = await createUser('QUAN_TRI_DU_LIEU');
      await http().get('/api/audit-logs/verify').set('Cookie', cookie).expect(200).expect((r) => expect(r.body.valid).toBe(true));

      const victim = (await auditRows(`WHERE action = 'auth.login.success' ORDER BY id LIMIT 1`))[0];
      await db.query(`ALTER TABLE audit_log DISABLE TRIGGER USER`);
      try {
        await db.query(`UPDATE audit_log SET actor_username = 'nguoi-khac' WHERE id = $1`, [victim.id]);
      } finally {
        await db.query(`ALTER TABLE audit_log ENABLE TRIGGER USER`);
      }

      const res = await http().get('/api/audit-logs/verify').set('Cookie', cookie).expect(200);
      expect(res.body).toMatchObject({ valid: false, firstInvalidId: String(victim.id) });
    });
  });
});
