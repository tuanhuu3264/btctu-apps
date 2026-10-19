import type { CategoryModel, NewCategory, NewPost, NewPostFile, PostFileModel, PostModel, PostPatch } from './document.model.js';

/** Các cổng của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class CategoryRepository {
  abstract findAll(): Promise<CategoryModel[]>;
  abstract findById(id: string): Promise<CategoryModel | null>;
  abstract findByName(name: string): Promise<CategoryModel | null>;
  abstract create(data: NewCategory): Promise<CategoryModel>;
  abstract update(id: string, data: NewCategory): Promise<CategoryModel>;
  abstract delete(id: string): Promise<void>;
}

export abstract class PostRepository {
  abstract findById(id: string): Promise<PostModel | null>;
  /** Bài đang đăng, mới nhất trước. */
  abstract findPublished(): Promise<PostModel[]>;
  /** Số bài đang đăng theo danh mục. */
  abstract countByCategory(): Promise<Map<string, number>>;
  /** Danh mục còn bài nào không, kể cả bài đã gỡ (bài gỡ vẫn được lưu nên vẫn tham chiếu danh mục). */
  abstract existsInCategory(categoryId: string): Promise<boolean>;
  abstract create(data: NewPost): Promise<PostModel>;
  abstract update(id: string, patch: PostPatch): Promise<PostModel>;
}

export abstract class PostFileRepository {
  abstract findByPosts(postIds: readonly string[]): Promise<PostFileModel[]>;
  abstract findById(id: string): Promise<PostFileModel | null>;
  abstract create(data: NewPostFile): Promise<PostFileModel>;
}
