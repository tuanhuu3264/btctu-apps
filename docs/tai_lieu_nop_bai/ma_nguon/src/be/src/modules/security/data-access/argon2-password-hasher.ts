import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { PasswordHasher } from '../application/ports.js';

/** argon2id với tham số mặc định của thư viện (ADR-011 mục 2). */
@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
