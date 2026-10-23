import axios from "axios";
import { t } from "@/i18n";

const TOKEN_KEY = "upi_tracker_token";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  timeout: 30000,
});

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable (private mode) - token lives only in memory */
    }
  },
};

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const url = error.config?.url || "";
    if (error.response?.status === 401 && !url.includes("/api/auth/login") && !url.includes("/api/public/")) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

export function errorMessage(error, fallback = t("Something went wrong")) {
  if (!error) return fallback;
  if (!error.response) {
    return error.code === "ECONNABORTED" ? t("The server took too long to respond") : t("Cannot reach the server. Check your connection.");
  }
  const detail = error.response.data?.detail;
  // fixed server messages have Tamil entries; ones with names or amounts in them stay as sent
  if (typeof detail === "string") return t(detail);
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
        return `${field ? `${field}: ` : ""}${(d.msg || "").replace(/^Value error, /, "")}`;
      })
      .join("; ");
  }
  return fallback;
}

/** Download a file from an authenticated endpoint. */
export async function downloadFile(url, params, filename) {
  const res = await api.get(url, { params, responseType: "blob" });
  const disposition = res.headers["content-disposition"] || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const name = filename || (match ? match[1] : "download");
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
