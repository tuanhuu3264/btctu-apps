'use client';

import { Modal, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall, apiGet } from '@/lib/client';

/** Trạng thái phiên do máy chủ trả (ADR-057). */
interface SessionStatus {
  idleSecondsLeft: number;
  absoluteSecondsLeft: number;
  idleMinutes: number;
}

/** Cảnh báo khi còn chừng này giây là phiên đóng. */
const WARN_SECONDS = 120;
/** Báo máy chủ "đang thao tác" nhiều nhất mỗi chừng này mili giây. */
const KEEPALIVE_EVERY_MS = 60_000;
/** Thời hạn đóng phiên (mili giây từ epoch), dùng chung giữa các tab cùng trình duyệt. */
const DEADLINE_KEY = 'kpi:idle-deadline';
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'scroll', 'mousemove'] as const;

const readShared = (): number => {
  try {
    return Number(localStorage.getItem(DEADLINE_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeShared = (deadline: number) => {
  try {
    localStorage.setItem(DEADLINE_KEY, String(deadline));
  } catch {
    // trình duyệt chặn lưu trữ: mỗi tab tự theo dõi
  }
};
const clearShared = () => {
  try {
    localStorage.removeItem(DEADLINE_KEY);
  } catch {
    // bỏ qua
  }
};

/**
 * Tự đóng phiên khi không thao tác (ADR-057, Sổ tay Bộ Nội vụ 2026 Chương VIII). Thao tác thật của người dùng (chuột, bàn phím,
 * chạm, cuộn) được báo cho máy chủ tối đa mỗi phút; làm mới tự động của trang (chuông thông báo, tổng quan) không tính. Còn 2 phút
 * thì hiện hộp thoại để chọn tiếp tục hay đăng xuất; hết hạn thì về trang đăng nhập kèm lý do. Nhiều tab dùng chung một mốc.
 */
export default function IdleGuard() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastKeepalive = useRef(0);
  const deadlineRef = useRef<number | null>(null);
  const expiring = useRef(false);

  const apply = useCallback((status: SessionStatus) => {
    // Hạn mới chỉ được kéo dài, không rút ngắn so với mốc dùng chung của tab khác (tab kia có thể vừa giữ phiên).
    const next = Math.max(Date.now() + status.idleSecondsLeft * 1000, readShared());
    deadlineRef.current = next;
    writeShared(next);
    setDeadline(next);
  }, []);

  /** Đóng phiên và về trang đăng nhập; `idle` thì kèm lý do không thao tác. */
  const expire = useCallback(async (idle: boolean) => {
    if (expiring.current) return;
    expiring.current = true;
    clearShared();
    await apiCall('POST', '/auth/logout').catch(() => null);
    window.location.assign(idle ? '/login?reason=idle' : '/login');
  }, []);

  const keepAlive = useCallback(async () => {
    lastKeepalive.current = Date.now();
    try {
      const status = await apiCall<SessionStatus>('POST', '/auth/session/keepalive');
      if (status) apply(status);
    } catch (e) {
      // Lỗi mạng (TypeError) thì để lần sau thử lại; lỗi khác là máy chủ đã đóng phiên.
      if (!(e instanceof TypeError)) void expire(true);
    }
  }, [apply, expire]);

  // Lấy mốc ban đầu từ máy chủ.
  useEffect(() => {
    let cancelled = false;
    apiGet<SessionStatus>('/auth/session')
      .then((status) => {
        if (!cancelled) apply(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Thao tác của người dùng: báo máy chủ, nhưng không khi hộp cảnh báo đang mở (khi đó phải bấm nút).
  useEffect(() => {
    const onActivity = () => {
      const current = deadlineRef.current;
      if (current === null || Date.now() < lastKeepalive.current + KEEPALIVE_EVERY_MS) return;
      if (current - Date.now() <= WARN_SECONDS * 1000) return;
      void keepAlive();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
    };
  }, [keepAlive]);

  // Tab khác giữ phiên thì theo mốc mới.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DEADLINE_KEY || !e.newValue) return;
      const shared = Number(e.newValue);
      if (shared > (deadlineRef.current ?? 0)) {
        deadlineRef.current = shared;
        setDeadline(shared);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Đồng hồ: mỗi giây; đến hạn thì hỏi lại máy chủ trước khi đóng (máy ngủ đông, tab bị làm chậm).
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const current = deadlineRef.current;
      if (current === null || t < current || expiring.current) return;
      void apiGet<SessionStatus>('/auth/session')
        .then((status) => {
          if (status.idleSecondsLeft > 0) apply(status);
          else void expire(true);
        })
        .catch((e: unknown) => {
          if (!(e instanceof TypeError)) void expire(true);
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [apply, expire]);

  const left = deadline === null ? Infinity : Math.max(Math.ceil((deadline - now) / 1000), 0);
  const warning = left <= WARN_SECONDS && left > 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Modal
      open={warning}
      title="Phiên làm việc sắp đóng"
      closable={false}
      maskClosable={false}
      keyboard={false}
      okText="Tiếp tục làm việc"
      cancelText="Đăng xuất"
      onOk={() => void keepAlive()}
      onCancel={() => void expire(false)}
    >
      <Typography.Paragraph>
        Bạn không thao tác trong một thời gian. Để bảo vệ dữ liệu, phiên sẽ tự đóng sau <strong>{mmss}</strong> và bạn cần đăng nhập lại. Nội dung đang soạn chưa gửi sẽ không được lưu.
      </Typography.Paragraph>
    </Modal>
  );
}
