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
        autoLoadEntities: true,
        synchronize: false,
        migrations,
        migrationsRun: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
