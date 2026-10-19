import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  challenge: string;
}

export class MfaCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}

export class MfaChallengeCodeDto extends MfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}

export class MfaDisableDto extends MfaCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}
