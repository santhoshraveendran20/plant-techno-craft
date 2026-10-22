import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";

/** GET a URL and keep {data, loading, error}; `reload()` refetches. Pass url=null to skip. */
export function useFetch(url, params) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState(null);
  const key = url ? `${url}?${JSON.stringify(params || {})}` : null;
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const res = await api.get(url, { params });
      if (id === latest.current) {
        setData(res.data);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(errorMessage(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, loading, error, reload: load };
}
