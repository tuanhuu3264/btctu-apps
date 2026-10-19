import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Cho phép route truy cập không cần đăng nhập. Mặc định mọi route đều bị từ chối (ADR-011 mục 4). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
