import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DurationMode, DurationUnit, VersionStatus } from '../application/catalog.model.js';

/** PostgreSQL trả numeric dạng chuỗi; chuyển về số (hoặc null) khi đọc. */
const numeric = {
  to: (v: number | null | undefined) => v ?? null,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('catalog_group')
export class CatalogGroupEntity {
  @PrimaryColumn({ type: 'char', length: 1 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}

@Entity('catalog_version')
export class CatalogVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  label: string;

  @Column({ type: 'varchar', length: 10, default: 'DRAFT' })
  status: VersionStatus;

  @Column({ name: 'baseline_item_code', type: 'varchar', length: 10, nullable: true })
  baselineItemCode: string | null;

  @Column({ name: 'effective_from', type: 'timestamptz', nullable: true })
  effectiveFrom: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'source_note', type: 'text', nullable: true })
  sourceNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('catalog_task')
export class CatalogTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'version_id', type: 'uuid' })
  versionId: string;

  @Column({ name: 'group_code', type: 'char', length: 1 })
  groupCode: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('catalog_item_scope')
export class CatalogItemScopeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  @Column({ name: 'position_id', type: 'uuid', nullable: true })
  positionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('catalog_item')
export class CatalogItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'version_id', type: 'uuid' })
  versionId: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ type: 'varchar', length: 10 })
  code: string;

  @Column({ name: 'group_code', type: 'char', length: 1 })
  groupCode: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'product_units', type: 'text', nullable: true })
  productUnits: string | null;

  @Column({ type: 'smallint' })
  complexity: number;

  @Column({ name: 'duration_mode', type: 'varchar', length: 12 })
  durationMode: DurationMode;

  @Column({ name: 'duration_value', type: 'numeric', precision: 10, scale: 3, nullable: true, transformer: numeric })
  durationValue: number | null;

  @Column({ name: 'duration_unit', type: 'varchar', length: 4, nullable: true })
  durationUnit: DurationUnit | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numeric })
  points: number | null;

  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
