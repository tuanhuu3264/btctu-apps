import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccessReviewItemModel, AccessReviewModel, ItemDecisionPatch, NewAccessReview, NewAccessReviewItem } from '../application/access-review.model.js';
import { AccessReviewRepository } from '../application/access-review.ports.js';
import { AccessReviewEntity, AccessReviewItemEntity } from './access-review.entities.js';

@Injectable()
export class TypeOrmAccessReviewRepository extends AccessReviewRepository {
  constructor(
    @InjectRepository(AccessReviewEntity) private readonly reviews: Repository<AccessReviewEntity>,
    @InjectRepository(AccessReviewItemEntity) private readonly itemRepo: Repository<AccessReviewItemEntity>,
  ) {
    super();
  }

  async create(review: NewAccessReview, items: readonly NewAccessReviewItem[]): Promise<AccessReviewModel> {
    return this.reviews.manager.transaction(async (m) => {
      const saved = await m.getRepository(AccessReviewEntity).save(m.getRepository(AccessReviewEntity).create({ ...review, status: 'OPEN', closedBy: null, closedAt: null }));
      const itemRepo = m.getRepository(AccessReviewItemEntity);
      await itemRepo.insert(
        items.map((i) => itemRepo.create({ ...i, reviewId: saved.id, decision: null, decidedBy: null, decidedAt: null, note: null, revokeApplied: false })),
      );
      return toReview(saved);
    });
  }

  async findById(id: string): Promise<AccessReviewModel | null> {
    const row = await this.reviews.findOneBy({ id });
    return row ? toReview(row) : null;
  }

  async findByQuarter(year: number, quarter: number): Promise<AccessReviewModel | null> {
    const row = await this.reviews.findOneBy({ year, quarter });
    return row ? toReview(row) : null;
  }

  async findAll(): Promise<AccessReviewModel[]> {
    return (await this.reviews.find({ order: { year: 'DESC', quarter: 'DESC' } })).map(toReview);
  }

  async items(reviewId: string): Promise<AccessReviewItemModel[]> {
    return (await this.itemRepo.find({ where: { reviewId }, order: { username: 'ASC', role: 'ASC' } })).map(toItem);
  }

  async findItem(itemId: string): Promise<AccessReviewItemModel | null> {
    const row = await this.itemRepo.findOneBy({ id: itemId });
    return row ? toItem(row) : null;
  }

  async decideItem(itemId: string, patch: ItemDecisionPatch): Promise<AccessReviewItemModel> {
    await this.itemRepo.update({ id: itemId }, patch);
    return toItem(await this.itemRepo.findOneByOrFail({ id: itemId }));
  }

  async close(id: string, closedBy: string, at: Date): Promise<AccessReviewModel> {
    await this.reviews.update({ id }, { status: 'CLOSED', closedBy, closedAt: at });
    return toReview(await this.reviews.findOneByOrFail({ id }));
  }
}

const toReview = (e: AccessReviewEntity): AccessReviewModel => ({
  id: e.id,
  year: e.year,
  quarter: e.quarter,
  label: e.label,
  status: e.status,
  dueDate: e.dueDate,
  note: e.note,
  createdBy: e.createdBy,
  createdAt: e.createdAt,
  closedBy: e.closedBy,
  closedAt: e.closedAt,
});

const toItem = (e: AccessReviewItemEntity): AccessReviewItemModel => ({
  id: e.id,
  reviewId: e.reviewId,
  accountId: e.accountId,
  username: e.username,
  personId: e.personId,
  personName: e.personName,
  unitName: e.unitName,
  positionTitle: e.positionTitle,
  role: e.role,
  roleAssignmentId: e.roleAssignmentId,
  roleValidFrom: e.roleValidFrom,
  roleValidTo: e.roleValidTo,
  reviewerKind: e.reviewerKind,
  reviewerPersonId: e.reviewerPersonId,
  reviewerName: e.reviewerName,
  decision: e.decision,
  decidedBy: e.decidedBy,
  decidedAt: e.decidedAt,
  note: e.note,
  revokeApplied: e.revokeApplied,
});
