import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { migrations } from './migrations/index.js';

/**
 * Kết nối PostgreSQL (ADR-010 mục 10). Không bật synchronize: schema chỉ đổi qua migration.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get<string>('DB_PORT', '5432')),
        username: config.get<string>('DB_USER', 'kpi'),
        password: config.get<string>('DB_PASSWORD', 'kpi'),
        database: config.get<string>('DB_NAME', 'kpi'),
        // Dịch vụ PostgreSQL trên đám mây (ví dụ Supabase) bắt buộc kết nối SSL; DB_SSL_REJECT_UNAUTHORIZED=false khi chưa cài chứng chỉ gốc.
        ssl:
          config.get<string>('DB_SSL', 'false') === 'true'
            ? { rejectUnauthorized: config.get<string>('DB_SSL_REJECT_UNAUTHORIZED', 'true') !== 'false' }
            : false,
        autoLoadEntities: true,
        synchronize: false,
        migrations,
        migrationsRun: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
