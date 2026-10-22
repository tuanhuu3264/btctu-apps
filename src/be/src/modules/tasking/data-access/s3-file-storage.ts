import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStorage } from '../application/tasking.ports.js';

/**
 * Kho tệp qua giao thức S3 (ADR-024): MinIO khi phát triển, Cloudflare R2 về sau chỉ cần đổi biến môi trường
 * (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY; R2 dùng S3_REGION=auto).
 */
@Injectable()
export class S3FileStorage extends FileStorage implements OnModuleInit {
  private readonly log = new Logger(S3FileStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  /** Mô tả cấu hình không chứa khóa (địa chỉ máy chủ, vùng, kiểu đường dẫn), dùng khi ghi nhật ký chẩn đoán. */
  private readonly describe: string;

  constructor(config: ConfigService) {
    super();
    this.bucket = config.get<string>('S3_BUCKET', 'kpi-files');
    const endpoint = config.get<string>('S3_ENDPOINT', 'http://localhost:9100');
    const region = config.get<string>('S3_REGION', 'us-east-1');
    const forcePathStyle = config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true';
    let where = endpoint;
    try {
      const u = new URL(endpoint);
      where = `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      where = `(không phải địa chỉ hợp lệ, dài ${endpoint.length} ký tự)`;
    }
    this.describe = `máy chủ ${where}, vùng "${region}", kiểu đường dẫn ${forcePathStyle ? 'path' : 'virtual-host'}`;
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY', 'kpiminio'),
        secretAccessKey: config.get<string>('S3_SECRET_KEY', 'kpiminio-dev-only'),
      },
    });
  }

  /** Tạo bucket nếu chưa có. Không có kho tệp thì chỉ cảnh báo: phần tệp đính kèm báo lỗi, phần còn lại vẫn chạy. */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (head) {
      // Ghi rõ mã lỗi của bước kiểm tra để phân biệt sai khóa (403), sai tên bucket hoặc sai địa chỉ (404), không kết nối được.
      const info = head as { name?: string; $metadata?: { httpStatusCode?: number } };
      const detail = `${info.name ?? 'Lỗi'} (HTTP ${info.$metadata?.httpStatusCode ?? 'không có'}), bucket "${this.bucket}"`;
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.log.log(`Đã tạo bucket ${this.bucket}`);
      } catch (e) {
        this.log.warn(`Chưa kết nối được kho tệp: cấu hình ${this.describe}; kiểm tra bucket lỗi ${detail}; tạo bucket lỗi: ${(e as Error).message}. Tệp đính kèm sẽ chưa dùng được`);
      }
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
    } catch (e) {
      this.log.error(`Ghi tệp thất bại: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Kho tệp tạm thời không dùng được, hãy thử lại sau');
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (e) {
      this.log.error(`Đọc tệp thất bại: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Kho tệp tạm thời không dùng được, hãy thử lại sau');
    }
  }
}
