export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 2000;
export const MAX_CATEGORY_NAME_LENGTH = 120;
export const MAX_CATEGORY_DESCRIPTION_LENGTH = 500;
export const MAX_FILES_PER_POST = 10;

export type PostStatus = 'PUBLISHED' | 'WITHDRAWN';

export interface CategoryModel {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface PostModel {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
  status: PostStatus;
  publishedByAccountId: string;
  publishedAt: Date;
  updatedAt: Date;
}

export interface PostFileModel {
  id: string;
  postId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: Date;
}

export type NewCategory = Pick<CategoryModel, 'name' | 'description'>;
export type NewPost = Pick<PostModel, 'categoryId' | 'title' | 'summary' | 'publishedByAccountId'>;
export type NewPostFile = Pick<PostFileModel, 'postId' | 'fileName' | 'contentType' | 'sizeBytes' | 'storageKey'>;
export type PostPatch = Partial<Pick<PostModel, 'categoryId' | 'title' | 'summary' | 'status'>>;
