import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ROLES } from '../application/authorization.model.js';
import type { Role } from '../application/authorization.model.js';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}

export class GrantRoleDto {
  @IsIn(ROLES)
  role: Role;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
