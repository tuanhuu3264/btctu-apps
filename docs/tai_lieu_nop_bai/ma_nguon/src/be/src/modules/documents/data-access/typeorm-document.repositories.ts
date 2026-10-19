import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { CategoryModel, NewCategory, NewPost, NewPostFile, PostFileModel, PostModel, PostPatch } from '../application/document.model.js';
import { CategoryRepository, PostFileRepository, PostRepository } from '../application/document.ports.js';
import { DocumentCategoryEntity, DocumentFileEntity, DocumentPostEntity } from './document.entities.js';

@Injectable()
export class TypeOrmCategoryRepository extends CategoryRepository {
  constructor(@InjectRepository(DocumentCategoryEntity) private readonly repo: Repository<DocumentCategoryEntity>) {
    super();
  }

  async findAll(): Promise<CategoryModel[]> {
    return (await this.repo.find()).map(toCategory);
  }

  async findById(id: string): Promise<CategoryModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toCategory(row) : null;
  }

  /** So tên không phân biệt hoa thường, khớp chỉ mục duy nhất trên lower(name). */
  async findByName(name: string): Promise<CategoryModel | null> {
    const row = await this.repo.createQueryBuilder('c').where('lower(c.name) = lower(:name)', { name }).getOne();
    return row ? toCategory(row) : null;
  }

  async create(data: NewCategory): Promise<CategoryModel> {
    return toCategory(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, data: NewCategory): Promise<CategoryModel> {
    await this.repo.update({ id }, data);
    return toCategory(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

@Injectable()
export class TypeOrmPostRepository extends PostRepository {
  constructor(@InjectRepository(DocumentPostEntity) private readonly repo: Repository<DocumentPostEntity>) {
    super();
  }

  async findById(id: string): Promise<PostModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toPost(row) : null;
  }

  async findPublished(): Promise<PostModel[]> {
    return (await this.repo.find({ where: { status: 'PUBLISHED' }, order: { publishedAt: 'DESC' } })).map(toPost);
  }

  async countByCategory(): Promise<Map<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('p')
      .select('p.category_id', 'categoryId')
      .addSelect('count(*)', 'total')
      .where("p.status = 'PUBLISHED'")
      .groupBy('p.category_id')
      .getRawMany<{ categoryId: string; total: string }>();
    return new Map(rows.map((r) => [r.categoryId, Number(r.total)]));
  }

  async existsInCategory(categoryId: string): Promise<boolean> {
    return this.repo.existsBy({ categoryId });
  }

  async create(data: NewPost): Promise<PostModel> {
    return toPost(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: PostPatch): Promise<PostModel> {
    await this.repo.update({ id }, patch);
    return toPost(await this.repo.findOneByOrFail({ id }));
  }
}

@Injectable()
export class TypeOrmPostFileRepository extends PostFileRepository {
  constructor(@InjectRepository(DocumentFileEntity) private readonly repo: Repository<DocumentFileEntity>) {
    super();
  }

  async findByPosts(postIds: readonly string[]): Promise<PostFileModel[]> {
    if (postIds.length === 0) return [];
    return (await this.repo.find({ where: { postId: In([...postIds]) }, order: { uploadedAt: 'ASC' } })).map(toFile);
  }

  async findById(id: string): Promise<PostFileModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toFile(row) : null;
  }

  async create(data: NewPostFile): Promise<PostFileModel> {
    return toFile(await this.repo.save(this.repo.create(data)));
  }
}

const toCategory = (e: DocumentCategoryEntity): CategoryModel => ({ id: e.id, name: e.name, description: e.description, createdAt: e.createdAt });

const toPost = (e: DocumentPostEntity): PostModel => ({
  id: e.id,
  categoryId: e.categoryId,
  title: e.title,
  summary: e.summary,
  status: e.status,
  publishedByAccountId: e.publishedByAccountId,
  publishedAt: e.publishedAt,
  updatedAt: e.updatedAt,
});

const toFile = (e: DocumentFileEntity): PostFileModel => ({
  id: e.id,
  postId: e.postId,
  fileName: e.fileName,
  contentType: e.contentType,
  sizeBytes: e.sizeBytes,
  storageKey: e.storageKey,
  uploadedAt: e.uploadedAt,
});
