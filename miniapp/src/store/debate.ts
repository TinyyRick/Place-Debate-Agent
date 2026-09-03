import { create } from "zustand";
import Taro from "@tarojs/taro";
import type { AwaitingIntervention, DebateResult } from "../types";

// 开发阶段：微信开发者工具需勾选「不校验合法域名」后才能访问本机服务。
// 真机预览：把 127.0.0.1 换成电脑的局域网 IP（手机与电脑同一 Wi-Fi）。
// 正式发布：换成备案过的 HTTPS 域名，并在小程序后台配置 request 合法域名。
// H5 预览走同源 + devServer 代理（见 config/index.ts），避免 CORS。
const API_BASE = process.env.TARO_ENV === "h5" ? "" : "http://127.0.0.1:3100";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const response = await Taro.request<T>({
    url: `${API_BASE}${path}`,
    method: "POST",
    data: body,
    header: { "content-type": "application/json" },
    timeout: 120000,
  });
  if (response.statusCode >= 400) {
    const payload = (typeof response.data === "object" && response.data !== null ? response.data : {}) as { error?: string };
    throw new Error(payload.error ?? "请求失败，请稍后重试。");
  }
  return response.data;
}

type DebateBody = { status: string; debate?: DebateResult; __interrupt__?: unknown };

type GpsCoordinates = { longitude: number; latitude: number };

type DebateState = {
  query: string;
  gpsCoordinates: GpsCoordinates | null;
  locationStatus: string;
  /** 是否已发起 start（防止从辩论页返回后重复请求） */
  started: boolean;
  loading: boolean;
  error: string;
  /** full：首轮慢速级联；quick：resume 后快速刷新 */
  revealMode: "full" | "quick";
  debate: DebateResult | null;
  awaiting: AwaitingIntervention | null;
  setQuery: (query: string) => void;
  useMyLocation: () => void;
  start: () => Promise<void>;
  resume: (action: unknown) => Promise<void>;
  reset: () => void;
};

function mergeAwaiting(previous: AwaitingIntervention, body: DebateBody): AwaitingIntervention {
  const interrupted = body.debate as { __interrupt__?: unknown } | undefined;
  return {
    ...previous,
    status: body.status as AwaitingIntervention["status"],
    debate: body.debate as DebateResult,
    interrupt: (interrupted?.__interrupt__ as AwaitingIntervention["interrupt"]) ?? previous.interrupt,
  };
}

export const useDebateStore = create<DebateState>((set, get) => ({
  query: "想出去走走，但是不要太累，一个人，最好有点意思。",
  gpsCoordinates: null,
  locationStatus: "使用南京测试坐标",
  started: false,
  loading: false,
  error: "",
  revealMode: "quick",
  debate: null,
  awaiting: null,

  setQuery: (query) => set({ query }),

  useMyLocation: () => {
    set({ locationStatus: "正在获取位置…" });
    Taro.getLocation({
      type: "gcj02",
      success: (res) => {
        set({ gpsCoordinates: { longitude: res.longitude, latitude: res.latitude }, locationStatus: "已使用你的当前位置", error: "" });
      },
      fail: () => {
        set({ gpsCoordinates: null, locationStatus: "使用南京测试坐标", error: "定位失败或未授权，可继续使用默认位置。" });
      },
    });
  },

  start: async () => {
    const { query, gpsCoordinates, started, loading } = get();
    if (started || loading) return;
    set({ started: true, loading: true, error: "", debate: null, awaiting: null });
    try {
      const body = await postJSON<DebateBody>("/api/debate/start", { query, ...(gpsCoordinates ? { gpsCoordinates } : {}) });
      if (body.status === "candidates_ready") {
        set({ debate: body.debate ?? null, revealMode: "full", loading: false });
      } else {
        // 打断响应本身就是 AwaitingIntervention（带 threadId / debate / interrupt）。
        set({ awaiting: body as unknown as AwaitingIntervention, revealMode: "full", loading: false });
      }
    } catch (caught) {
      set({ error: caught instanceof Error ? caught.message : "请求失败，请稍后重试。", loading: false, started: false });
    }
  },

  resume: async (action) => {
    const { awaiting, loading, debate } = get();
    if (!awaiting || loading) return;
    set({ loading: true, error: "" });
    try {
      const body = await postJSON<DebateBody>("/api/debate/resume", { threadId: awaiting.threadId, action });
      const currentIds = debate?.factPacks.map((place) => place.id).join("|") ?? "";
      const nextDebate = body.debate;
      const nextIds = nextDebate?.factPacks.map((place) => place.id).join("|") ?? "";
      if (body.status === "candidates_ready") {
        set({ debate: nextDebate ?? null, awaiting: null, revealMode: currentIds !== nextIds ? "full" : "quick", loading: false });
      } else {
        set({ awaiting: mergeAwaiting(awaiting, body), revealMode: currentIds !== nextIds ? "full" : "quick", loading: false });
      }
    } catch (caught) {
      set({ error: caught instanceof Error ? caught.message : "请求失败，请稍后重试。", loading: false });
    }
  },

  reset: () => set({ started: false, loading: false, error: "", debate: null, awaiting: null, revealMode: "quick" }),
}));
