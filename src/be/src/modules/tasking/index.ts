/** Giao diện công khai của mô-đun tasking: các mô-đun khác chỉ import từ đây. */
export { TaskingModule } from './tasking.module.js';
export { TaskingService } from './application/tasking.service.js';
export type { AssignedWork, PeriodRange, ReportKind } from './application/tasking.model.js';
export { FileStorage } from './application/tasking.ports.js';
export { S3FileStorage } from './data-access/s3-file-storage.js';
export { fileResponseHeaders, isViewable, validateUpload } from './application/file-rules.js';
export type { UploadedFile } from './application/file-rules.js';
export { MAX_FILE_BYTES } from './application/tasking.model.js';
