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

  constructor(config: ConfigService) {
    super();
    this.bucket = config.get<string>('S3_BUCKET', 'kpi-files');
    this.client = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT', 'http://localhost:9100'),
      region: config.get<string>('S3_REGION', 'us-east-1'),
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
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
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.log.log(`Đã tạo bucket ${this.bucket}`);
      } catch (e) {
        this.log.warn(`Chưa kết nối được kho tệp (${(e as Error).message}); tệp đính kèm sẽ chưa dùng được`);
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
