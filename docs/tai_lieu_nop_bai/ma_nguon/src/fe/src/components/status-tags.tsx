import { Tag } from 'antd';
import type { EvaluationStatus, RatingCode } from '@/lib/api';
import { RATING_LABELS, STATUS_LABELS } from '@/lib/labels';

const STATUS_COLORS: Record<EvaluationStatus, string> = {
  PLANNED: 'default',
  SELF_SUBMITTED: 'processing',
  REVIEWED: 'warning',
  APPROVED: 'success',
};

const RATING_COLORS: Record<RatingCode, string> = {
  XUAT_SAC: 'purple',
  HOAN_THANH_TOT: 'green',
  HOAN_THANH: 'blue',
  KHONG_HOAN_THANH: 'red',
};

export const StatusTag = ({ status }: { status: EvaluationStatus }) => <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>;

export const RatingTag = ({ rating }: { rating: RatingCode | null }) =>
  rating ? <Tag color={RATING_COLORS[rating]}>{RATING_LABELS[rating]}</Tag> : <span>–</span>;
