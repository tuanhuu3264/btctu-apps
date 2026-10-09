'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet } from './client';

/**
 * Tải dữ liệu theo đường dẫn `url`; tải lại khi `url` hoặc `version` đổi. Kết quả của yêu cầu cũ bị bỏ nếu đã có yêu cầu mới hơn.
 * `loading` suy ra từ khóa của lần tải gần nhất đã xong nên không cần đặt state đồng bộ trong effect.
 */
export function useRemote<T>(url: string, version = 0) {
  const key = `${url}#${version}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null });
  const latest = useRef(0);

  useEffect(() => {
    const mine = ++latest.current;
    apiGet<T>(url)
      .then((data) => {
        if (mine === latest.current) setState({ key, data, error: null });
      })
      .catch((e: Error) => {
        if (mine === latest.current) setState({ key, data: null, error: e.message });
      });
  }, [key, url]);

  return { data: state.data, error: state.error, loading: state.key !== key };
}
