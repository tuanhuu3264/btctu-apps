import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Gender, PoliticalTheory } from '../application/org.model.js';

@Entity('person')
export class PersonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'employee_code', type: 'varchar', length: 32, nullable: true })
  employeeCode: string | null;

  @Column({ name: 'gender', type: 'varchar', length: 8, nullable: true })
  gender: Gender | null;

  @Column({ name: 'ethnicity', type: 'varchar', length: 60, nullable: true })
  ethnicity: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ name: 'national_id', type: 'varchar', length: 12, nullable: true })
  nationalId: string | null;

  @Column({ name: 'email', type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ name: 'phone', type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'rank', type: 'varchar', length: 160, nullable: true })
  rank: string | null;

  @Column({ name: 'salary_grade', type: 'varchar', length: 40, nullable: true })
  salaryGrade: string | null;

  @Column({ name: 'joined_agency_on', type: 'date', nullable: true })
  joinedAgencyOn: string | null;

  @Column({ name: 'party_joined_on', type: 'date', nullable: true })
  partyJoinedOn: string | null;

  @Column({ name: 'education', type: 'varchar', length: 160, nullable: true })
  education: string | null;

  @Column({ name: 'major', type: 'varchar', length: 160, nullable: true })
  major: string | null;

  @Column({ name: 'political_theory', type: 'varchar', length: 16, nullable: true })
  politicalTheory: PoliticalTheory | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('job_position')
export class JobPositionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  code: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'smallint' })
  level: number;

  @Column({ name: 'is_leader', type: 'boolean', default: false })
  isLeader: boolean;

  @Column({ name: 'reports_to_position_id', type: 'uuid', nullable: true })
  reportsToPositionId: string | null;

  @Column({ type: 'text', nullable: true })
  duties: string | null;

  @Column({ name: 'reference_okr', type: 'text', nullable: true })
  referenceOkr: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('assignment')
export class AssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Column({ name: 'position_id', type: 'uuid' })
  positionId: string;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom: Date;

  @Column({ name: 'valid_to', type: 'timestamptz', nullable: true })
  validTo: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
