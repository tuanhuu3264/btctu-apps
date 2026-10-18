import { loadBackupConfig, loadRemote } from './config.js';

const app = { endpoint: 'http://localhost:9100', region: 'us-east-1', bucket: 'kpi-files', accessKeyId: 'a', secretAccessKey: 'b', forcePathStyle: true };

describe('sao lưu: cấu hình MinIO đích', () => {
  it('không đặt bucket thì không đẩy lên MinIO', () => {
    expect(loadRemote({}, app)).toBeNull();
    expect(loadBackupConfig({}).remote).toBeNull();
  });

  it('dùng máy chủ của ứng dụng nếu không nêu riêng, chỉ khác bucket', () => {
    const remote = loadRemote({ BACKUP_S3_BUCKET: 'kpi-backup', BACKUP_S3_ACCESS_KEY: 'x', BACKUP_S3_SECRET_KEY: 'y' }, app);
    expect(remote).toMatchObject({ endpoint: app.endpoint, bucket: 'kpi-backup', accessKeyId: 'x', secretAccessKey: 'y', forcePathStyle: true });
  });

  it('dùng máy chủ khác khi nêu BACKUP_S3_ENDPOINT', () => {
    const remote = loadRemote({ BACKUP_S3_BUCKET: 'kpi-backup', BACKUP_S3_ENDPOINT: 'http://10.0.0.5:9000', BACKUP_S3_ACCESS_KEY: 'x', BACKUP_S3_SECRET_KEY: 'y' }, app);
    expect(remote?.endpoint).toBe('http://10.0.0.5:9000');
  });

  it('thiếu khóa truy cập thì báo lỗi, không dùng ngầm khóa của ứng dụng', () => {
    expect(() => loadRemote({ BACKUP_S3_BUCKET: 'kpi-backup' }, app)).toThrow('BACKUP_S3_ACCESS_KEY');
  });

  it('từ chối trùng kho tệp đính kèm, vì dọn bản cũ sẽ xóa nhầm tệp đính kèm', () => {
    const env = { BACKUP_S3_BUCKET: 'kpi-files', BACKUP_S3_ACCESS_KEY: 'x', BACKUP_S3_SECRET_KEY: 'y' };
    expect(() => loadRemote(env, app)).toThrow('trùng kho tệp đính kèm');
    expect(loadRemote({ ...env, BACKUP_S3_ENDPOINT: 'http://khac:9000' }, app)).not.toBeNull(); // khác máy chủ thì cùng tên bucket vẫn được
  });
});
