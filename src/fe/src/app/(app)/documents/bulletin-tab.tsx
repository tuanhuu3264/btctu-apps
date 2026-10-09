'use client';

import { CalendarOutlined, PaperClipOutlined, PlusOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm, Select, Space, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import FileLink from '@/components/file-link';
import type { DocCategory, DocPost, DocPostPage } from '@/lib/api';
import { API_URL, apiCall, apiUploadMany } from '@/lib/client';
import { dateTimeText } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import { useRemote } from '@/lib/use-remote';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

interface Values {
  categoryId: string;
  title: string;
  summary?: string;
}

interface Props {
  names: Record<string, string>;
  categories: DocCategory[];
  canManage: boolean;
}

/** Hộp thoại đăng bài mới (kèm tệp) hoặc sửa bài (không đổi tệp). Chỉ được dựng khi đang mở. */
function PostModal({ post, categories, onClose, onDone }: { post: DocPost | null; categories: DocCategory[]; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<Values>();
  const [files, setFiles] = useState<UploadFile[]>([]);

  async function submit(v: Values) {
    const body = { categoryId: v.categoryId, title: v.title.trim(), summary: v.summary?.trim() ?? '' };
    const ok = await run(
      async () => {
        if (post) await apiCall('PATCH', `/documents/posts/${post.id}`, body);
        else await apiUploadMany('/documents/posts', files.map((f) => f as unknown as File), body);
      },
      { success: post ? 'Đã lưu bài đăng' : 'Đã đăng tài liệu' },
    );
    if (ok) {
      onDone();
      onClose();
    }
  }

  return (
    <Modal title={post ? 'Sửa bài đăng' : 'Đăng tài liệu'} open width={640} onCancel={onClose} onOk={() => form.submit()} okText={post ? 'Lưu' : 'Đăng'} cancelText="Hủy" confirmLoading={busy}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={post ? { categoryId: post.categoryId, title: post.title, summary: post.summary } : {}}>
        <Form.Item name="categoryId" label="Danh mục" rules={[{ required: true, message: 'Chọn danh mục' }]}>
          <Select placeholder="Chọn danh mục" options={categories.map((c) => ({ value: c.id, label: c.name }))} notFoundContent="Chưa có danh mục. Tạo ở tab Danh mục tài liệu." />
        </Form.Item>
        <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, whitespace: true, message: 'Nhập tiêu đề' }]}>
          <Input maxLength={200} showCount />
        </Form.Item>
        <Form.Item name="summary" label="Tóm tắt">
          <Input.TextArea rows={4} maxLength={2000} showCount />
        </Form.Item>
        {post ? (
          <Alert type="info" showIcon message="Tệp của bài không đổi được. Muốn thay tệp, hãy gỡ bài này và đăng bài mới." />
        ) : (
          <Form.Item label={`Tệp đính kèm (tối đa ${MAX_FILES} tệp, mỗi tệp 20 MB)`} extra="pdf, Word, Excel, PowerPoint, txt, csv, png, jpg">
            <Upload
              multiple
              accept={ACCEPT}
              fileList={files}
              beforeUpload={(file) => {
                if (file.size > MAX_FILE_BYTES) return Upload.LIST_IGNORE;
                setFiles((prev) => (prev.length >= MAX_FILES ? prev : [...prev, file]));
                return false;
              }}
              onRemove={(file) => setFiles((prev) => prev.filter((f) => f.uid !== file.uid))}
            >
              <Button icon={<PaperClipOutlined />}>Chọn tệp</Button>
            </Upload>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/** Bản tin tài liệu (ADR-025): tài liệu dùng chung của cơ quan, mới nhất trước, lọc theo danh mục và từ khóa. */
export default function BulletinTab({ names, categories, canManage }: Props) {
  const { run, busy } = useAction();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [version, setVersion] = useState(0);
  /** undefined: đóng; null: đăng mới; DocPost: sửa. */
  const [editing, setEditing] = useState<DocPost | null | undefined>(undefined);
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: `${c.name} (${c.postCount})` })), [categories]);

  // Gõ từ khóa xong 350 ms mới tìm, và về trang 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  const { data, error, loading } = useRemote<DocPostPage>(`/documents/posts?${params}`, version);
  const filtered = q !== '' || categoryId !== undefined;
  const reload = () => setVersion((n) => n + 1);

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Input.Search allowClear placeholder="Tìm theo tiêu đề, tóm tắt (không cần dấu)" style={{ width: 320 }} value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <Select
          allowClear
          placeholder="Tất cả danh mục"
          style={{ width: 240 }}
          value={categoryId}
          options={categoryOptions}
          onChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
          Tải lại
        </Button>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
            Đăng tài liệu
          </Button>
        )}
      </Space>

      {error && <Alert type="error" showIcon message={error} />}
      {!loading && data && data.items.length === 0 && (
        <Empty description={filtered ? 'Không có bài nào khớp bộ lọc.' : canManage ? 'Chưa có tài liệu nào. Hãy đăng tài liệu đầu tiên.' : 'Chưa có tài liệu nào được đăng.'} />
      )}
      <Space orientation="vertical" size="middle" style={{ width: '100%', opacity: loading ? 0.6 : 1 }}>
        {(data?.items ?? []).map((p) => (
          <Card
            key={p.id}
            size="small"
            title={
              <Space wrap>
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {p.title}
                </Typography.Text>
                <Tag color="red">{p.categoryName}</Tag>
              </Space>
            }
            extra={
              canManage && (
                <Space>
                  <Button size="small" onClick={() => setEditing(p)}>
                    Sửa
                  </Button>
                  <Popconfirm
                    title="Gỡ bài này khỏi bản tin?"
                    description="Bài được ẩn với mọi người, vẫn được lưu."
                    okText="Gỡ"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => run(() => apiCall('DELETE', `/documents/posts/${p.id}`).then(() => undefined), { success: 'Đã gỡ bài' }).then((ok) => ok && reload())}
                  >
                    <Button size="small" danger loading={busy}>
                      Gỡ
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          >
            <Space size="large" wrap style={{ color: '#888', fontSize: 13 }}>
              <span>
                <CalendarOutlined /> {dateTimeText(p.publishedAt)}
              </span>
              <span>
                <UserOutlined /> {p.publishedByPersonId ? (names[p.publishedByPersonId] ?? 'Không rõ') : 'Không rõ'}
              </span>
            </Space>
            {p.summary && (
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 8, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 3, expandable: 'collapsible' }}>
                {p.summary}
              </Typography.Paragraph>
            )}
            {p.files.length > 0 && (
              <Space orientation="vertical" size={2} style={{ marginTop: p.summary ? 0 : 8 }}>
                {p.files.map((f) => (
                  <FileLink key={f.id} url={`${API_URL}/documents/posts/${p.id}/files/${f.id}`} fileName={f.fileName} contentType={f.contentType} sizeBytes={f.sizeBytes} />
                ))}
              </Space>
            )}
          </Card>
        ))}
      </Space>

      {(data?.total ?? 0) > 0 && (
        <Pagination
          align="end"
          current={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          showSizeChanger
          pageSizeOptions={[10, 20, 50]}
          showTotal={(t) => `${t} bài`}
          onChange={(p, s) => {
            setPage(s !== pageSize ? 1 : p);
            setPageSize(s);
          }}
        />
      )}
      {editing !== undefined && <PostModal post={editing} categories={categories} onClose={() => setEditing(undefined)} onDone={reload} />}
    </Space>
  );
}
