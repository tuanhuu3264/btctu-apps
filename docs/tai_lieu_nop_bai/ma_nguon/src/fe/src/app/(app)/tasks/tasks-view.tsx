'use client';

import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Space, Tabs } from 'antd';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PickerGroup, PickerItem, PickerTask } from '@/components/catalog-item-picker';
import type { AssignmentView, OrgUnit, SearchScope, WorkTask } from '@/lib/api';
import { holdersOf, uniqueByPerson } from '@/lib/org';
import { AdHocAssignModal, ProposeModal } from './ad-hoc-modals';
import AssignModal from './assign-modal';
import type { Assignee } from './assign-modal';
import TaskBoard from './task-board';
import TaskDetail from './task-detail';

interface Props {
  myPersonId: string | null;
  names: Record<string, string>;
  tree: OrgUnit[];
  /** Các phạm vi theo dõi mà người dùng có quyền, theo thứ tự hiện tab. */
  scopes: { key: SearchScope; label: string }[];
  /** Đổi mỗi lần máy chủ dựng lại trang, để các danh sách tải lại sau thao tác. */
  stamp: number;
  /** Việc mở sẵn khi vào trang (từ liên kết ở "Quản lý tài liệu"). */
  initialOpen: AssignmentView | null;
  teamTasks: WorkTask[];
  assignees: Assignee[];
  /** Các vị trí người đăng nhập đang giữ (nhiều hơn một khi kiêm nhiệm), để đề xuất việc đột xuất cho đúng vị trí. */
  myPositions: { positionId: string; label: string }[];
  catalogItems: PickerItem[];
  catalogGroups: PickerGroup[];
  catalogTasks: PickerTask[];
  canAssign: boolean;
  canConfirm: boolean;
  canReport: boolean;
}

/** Màn theo dõi việc (ADR-024): mỗi tab là một phạm vi, danh sách có lọc và phân trang; mở từng việc để trao đổi, đính kèm tệp. */
export default function TasksView({ myPersonId, names, tree, scopes, stamp, initialOpen, teamTasks, assignees, myPositions, catalogItems, catalogGroups, catalogTasks, canAssign, canConfirm, canReport }: Props) {
  const [assigning, setAssigning] = useState(false);
  const [assigningAdHoc, setAssigningAdHoc] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [opened, setOpened] = useState<AssignmentView | null>(initialOpen);
  const [reloadKey, setReloadKey] = useState(0);
  const directReportIds = useMemo(() => new Set(assignees.map((a) => a.personId)), [assignees]);
  const assigneeOptions = useMemo(() => uniqueByPerson(holdersOf(tree)).map((h) => ({ value: h.personId, label: `${h.fullName} – ${h.title}` })), [tree]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Space wrap>
          {canAssign && (
            <>
              <Link href="/tasks/recurring">
                <Button>Việc lặp định kỳ</Button>
              </Link>
              <Button icon={<ThunderboltOutlined />} onClick={() => setAssigningAdHoc(true)}>
                Giao việc đột xuất
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAssigning(true)}>
                Giao việc
              </Button>
            </>
          )}
          {canReport && (
            <Button icon={<ThunderboltOutlined />} onClick={() => setProposing(true)}>
              Đề xuất việc đột xuất
            </Button>
          )}
        </Space>
      </div>
      <Tabs
        items={scopes.map((s) => ({
          key: s.key,
          label: s.label,
          children: (
            <TaskBoard
              scope={s.key}
              stamp={stamp + reloadKey}
              myPersonId={myPersonId}
              names={names}
              assigneeOptions={assigneeOptions}
              canReport={canReport}
              canConfirm={canConfirm}
              canAssign={canAssign}
              directReportIds={directReportIds}
              onOpen={setOpened}
            />
          ),
        }))}
      />
      {assigning && (
        <AssignModal
          assignees={assignees}
          tasks={teamTasks}
          catalogItems={catalogItems}
          catalogGroups={catalogGroups}
          catalogTasks={catalogTasks}
          tree={tree}
          preset={null}
          onClose={() => setAssigning(false)}
        />
      )}
      {assigningAdHoc && <AdHocAssignModal assignees={assignees} tasks={teamTasks} onClose={() => setAssigningAdHoc(false)} />}
      {proposing && <ProposeModal myPositions={myPositions} onClose={() => setProposing(false)} />}
      {opened && (
        <TaskDetail
          key={opened.assignment.id}
          view={opened}
          tree={tree}
          names={names}
          myPersonId={myPersonId}
          canEdit={canAssign && directReportIds.has(opened.assignment.assigneePersonId)}
          onClose={() => setOpened(null)}
          onChanged={() => setReloadKey((n) => n + 1)}
        />
      )}
    </>
  );
}
