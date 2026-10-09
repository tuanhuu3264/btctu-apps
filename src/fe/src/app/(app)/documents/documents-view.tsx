'use client';

import { Tabs } from 'antd';
import type { ReactNode } from 'react';
import type { DocCategory } from '@/lib/api';
import BulletinTab from './bulletin-tab';
import CategoriesTab from './categories-tab';
import TaskFilesTab from './task-files-tab';

interface Props {
  names: Record<string, string>;
  categories: DocCategory[];
  canReadTasks: boolean;
  canRead: boolean;
  canManage: boolean;
}

/** Quản lý tài liệu (ADR-025): tệp trong công việc, bản tin tài liệu, danh mục tài liệu. */
export default function DocumentsView({ names, categories, canReadTasks, canRead, canManage }: Props) {
  const items: { key: string; label: string; children: ReactNode }[] = [];
  if (canRead) items.push({ key: 'bulletin', label: 'Bản tin tài liệu', children: <BulletinTab names={names} categories={categories} canManage={canManage} /> });
  if (canReadTasks) items.push({ key: 'tasks', label: 'Tài liệu trong công việc', children: <TaskFilesTab names={names} /> });
  if (canManage) items.push({ key: 'categories', label: 'Danh mục tài liệu', children: <CategoriesTab categories={categories} /> });

  return <Tabs items={items} />;
}
