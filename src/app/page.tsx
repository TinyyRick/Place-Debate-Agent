"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { AwaitingIntervention } from "@/lib/graph/debate-graph";
import type { DebateMessage, DebateResult } from "@/lib/schemas/debate";
import { fieldLabel, formatPreferenceValue } from "@/lib/preference-labels";

const DEFAULT_QUERY = "想出去走走，但是不要太累，一个人，最好有点意思。";

const SPEAKER_CLASSES = ["sp0", "sp1", "sp2"] as const;

const INTENSITY_LABELS: Record<string, string> = { low: "轻量活动", medium: "强度适中", high: "高强度" };
const ENGAGEMENT_LABELS: Record<string, string> = {
  exploration: "探索新地方",
  consumption: "吃喝逛买",
  functional: "办事或锻炼",
  social: "社交聚会",
  rest: "安静休息",
};
const SOCIAL_LABELS: Record<string, string> = { solo: "一个人", group: "和朋友一起", either: "一个人或结伴" };
const SPATIAL_LABELS: Record<string, string> = { indoor: "偏室内", outdoor: "偏室外", mixed: "室内外都可以" };
const COST_LABELS: Record<string, string> = { free: "不花钱", low: "花费少", medium: "花费适中", high: "舍得花" };

const containsChinese = (text: string) => /[\u4e00-\u9fff]/.test(text);

// 等待期间的安抚话术：固定顺序轮播，数字为伪随机（不对应真实进度）。
const LOADING_PHRASES: Array<(count: number) => string> = [
  () => "正在理解你的需求…",
  () => "正在检索附近的目的地…",
  (count) => `已发现 ${count} 个附近地点`,
  (count) => `正在核对 ${count} 个地点的步行与驾车路线…`,
  (count) => `正在整理 ${count} 个地点的评分与人均消费…`,
  (count) => `正在把 ${count} 个目的地按你的偏好排序…`,
  () => "三个地点正在准备上场辩论…",
];

const phaseCount = (phase: number) => 23 + ((phase * 17) % 46);

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${meters} 米`;
}

function SectionHead({ badge, title, delay = 0 }: { badge?: string; title: string; delay?: number }) {
  return (
    <div className="sec-head pop" style={{ animationDelay: `${delay}ms` }}>
      {badge ? <span className="sec-badge">{badge}</span> : null}
      <h2>{title}</h2>
      <span className="sec-tail" />
    </div>
  );
}

type StatusItem = { placeId: string; text: string };

function MessageList({ messages, names, speakerClass, baseDelay, stepDelay, statuses = [] }: {
  messages: DebateMessage[];
  names: Map<string, string>;
  speakerClass: Map<string, string>;
  baseDelay: number;
  stepDelay: number;
  statuses?: StatusItem[];
}) {
  const items: Array<{ kind: "message"; message: DebateMessage } | { kind: "status"; status: StatusItem }> = [
    ...messages.map((message) => ({ kind: "message" as const, message })),
    ...statuses.map((status) => ({ kind: "status" as const, status })),
  ];
  if (items.length === 0) {
    return <p className="msg-muted pop" style={{ animationDelay: `${baseDelay}ms` }}>这一轮没有产生有意义的交锋，不强行制造对抗。</p>;
  }
  return <div className="msg-list">{items.map((item, index) => {
    const delay = baseDelay + index * stepDelay;
    if (item.kind === "status") {
      const cls = speakerClass.get(item.status.placeId) ?? "sp0";
      const name = names.get(item.status.placeId) ?? item.status.placeId;
      return <article className={`msg-row status pop ${cls}`} key={`status-${item.status.placeId}`} style={{ animationDelay: `${delay}ms` }}>
        <div className="msg-head">
          <span className={`msg-avatar ${cls}`} aria-hidden="true">{name.slice(0, 1)}</span>
          <span className={`msg-speaker ${cls}`}>{name}</span>
        </div>
        <p className="msg-claim status-line">{item.status.text}</p>
      </article>;
    }
    const message = item.message;
    const speaker = speakerClass.get(message.speakerPoiId) ?? "sp0";
    const speakerName = names.get(message.speakerPoiId) ?? message.speakerPoiId;
    const otherId = message.targetPoiId ?? message.attackerPoiId;
    const otherCls = otherId ? speakerClass.get(otherId) ?? "sp0" : "";
    const otherName = otherId ? names.get(otherId) ?? otherId : "";
    return <article className={`msg-row pop ${speaker} ${message.type}`} key={`${message.type}-${message.speakerPoiId}-${otherId ?? "x"}-${index}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="msg-head">
        <span className={`msg-avatar ${otherId ? "duel-left " : ""}${speaker}`} aria-hidden="true">{speakerName.slice(0, 1)}</span>
        <span className={`msg-speaker ${speaker}`}>{speakerName}</span>
        {otherId ? <>
          <span className={`clash-badge ${message.type === "attack" ? "" : "reply"}`}>{message.type === "attack" ? "VS" : "回应"}</span>
          <span className={`msg-avatar duel-right ${otherCls}`} aria-hidden="true">{otherName.slice(0, 1)}</span>
          <span className={`msg-speaker ${otherCls}`}>{otherName}</span>
        </> : null}
      </div>
      <p className="msg-claim">{message.claim}</p>
    </article>;
  })}</div>;
}

function TransitFeedback({ route, delay }: { route: DebateResult["factPacks"][number]["route"]; delay: number }) {
  const transit = route?.transit;
  if (!transit) return null;
  if (transit.status === "unavailable") return <p className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>地铁路线：暂时无法确认</p>;
  if (transit.status === "no_route") return <p className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>地铁路线：未查到可用方案</p>;
  if (!transit.usesMetro) return <p className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>公交 {transit.durationMinutes ?? "未知"} 分钟 · 不含地铁</p>;
  return <p className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>{transit.directMetro ? "地铁零换乘直达" : `地铁需换乘 ${transit.transferCount ?? "未知"} 次`} · 全程 {transit.durationMinutes ?? "未知"} 分钟 · 接驳步行 {transit.walkingDistanceMeters ?? "未知"} 米{transit.lineNames.length ? ` · ${transit.lineNames.join(" → ")}` : ""}</p>;
}

function UnderstandingPanel({ debate, delay }: { debate: DebateResult; delay: number }) {
  const { intentProfile, experienceProfile } = debate;
  const chips: { text: string; className: string }[] = [];
  const push = (text: string, className = "chip chip-accent") => chips.push({ text, className });
  const intensity = INTENSITY_LABELS[intentProfile.activityIntensity];
  if (intensity) push(intensity);
  const engagement = ENGAGEMENT_LABELS[experienceProfile.engagementType];
  if (engagement) push(engagement);
  const social = SOCIAL_LABELS[experienceProfile.socialFit];
  if (social) push(social);
  const spatial = SPATIAL_LABELS[experienceProfile.spatial];
  if (spatial) push(spatial);
  const cost = COST_LABELS[experienceProfile.costTier];
  if (cost) push(cost);
  for (const constraint of intentProfile.constraints) if (containsChinese(constraint)) push(constraint, "chip");
  for (const avoid of intentProfile.avoid) if (containsChinese(avoid)) push(`避开：${avoid}`, "chip chip-avoid");
  return <section className="panel" data-stage={delay}>
    <div className="pop" style={{ animationDelay: `${delay}ms` }}>
      <SectionHead title="这样理解你的需求" />
      <p className="goal-line">{intentProfile.goal}</p>
      {chips.length > 0 ? <div className="chips">{chips.map((chip, index) => <span className={chip.className} key={`${chip.text}-${index}`}>{chip.text}</span>)}</div> : null}
    </div>
  </section>;
}

export default function Home() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<DebateResult | null>(null);
  const [awaiting, setAwaiting] = useState<AwaitingIntervention | null>(null);
  const [intervention, setIntervention] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gpsCoordinates, setGpsCoordinates] = useState<{ longitude: number; latitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState("使用南京测试坐标");
  const [revealMode, setRevealMode] = useState<"full" | "quick">("quick");
  const [loadingPhase, setLoadingPhase] = useState(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setLoadingPhase((phase) => phase + 1), 2600);
    return () => window.clearInterval(timer);
  }, [loading]);

  const loadingText = LOADING_PHRASES[loadingPhase % LOADING_PHRASES.length](phaseCount(loadingPhase));

  function useMyLocation() {
    if (!navigator.geolocation) { setError("当前浏览器不支持定位。"); return; }
    setError(""); setLocationStatus("正在获取位置…");
    navigator.geolocation.getCurrentPosition(
      (position) => { setGpsCoordinates({ longitude: position.coords.longitude, latitude: position.coords.latitude }); setLocationStatus("已使用你的当前位置"); },
      (position) => { const messages: Record<number, string> = { 1: "你拒绝了定位权限。", 2: "无法获取当前位置。", 3: "定位超时，请重试。" }; setGpsCoordinates(null); setLocationStatus("使用南京测试坐标"); setError(messages[position.code] ?? "定位失败，请重试。"); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function runDebate() {
    setLoadingPhase(0); setLoading(true); setError(""); setResult(null); setAwaiting(null); setIntervention("");
    try {
      const response = await fetch("/api/debate/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, ...(gpsCoordinates ? { gpsCoordinates } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Debate failed.");
      setRevealMode("full");
      if (body.status === "candidates_ready") setResult(body.debate as DebateResult);
      else setAwaiting(body as AwaitingIntervention);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Debate failed."); }
    finally { setLoading(false); }
  }

  async function resumeDebate(action: unknown) {
    if (!awaiting) return;
    setLoadingPhase(0); setLoading(true); setError("");
    try {
      const response = await fetch("/api/debate/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: awaiting.threadId, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Debate failed to resume.");
      const nextDebate = body.debate as DebateResult | undefined;
      const currentIds = activeDebate?.factPacks.map((place) => place.id).join("|") ?? "";
      const nextIds = nextDebate?.factPacks.map((place) => place.id).join("|") ?? "";
      setRevealMode(currentIds !== nextIds ? "full" : "quick");
      if (body.status !== "candidates_ready") {
        const interrupted = body.debate as { __interrupt__?: unknown };
        setAwaiting({ ...(awaiting as AwaitingIntervention), status: body.status, debate: body.debate, interrupt: interrupted.__interrupt__ ?? awaiting.interrupt } as AwaitingIntervention);
      }
      else { setResult(body.debate as DebateResult); setAwaiting(null); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Debate failed to resume."); }
    finally { setLoading(false); }
  }

  const interruptedDebate = awaiting?.debate as unknown as DebateResult | undefined;
  const activeDebate = result ?? (interruptedDebate?.factPacks?.length ? interruptedDebate : null);
  const names = new Map(activeDebate?.factPacks.map((place) => [place.id, place.name]) ?? []);
  const speakerClass = new Map(activeDebate?.factPacks.map((place, index) => [place.id, SPEAKER_CLASSES[index % SPEAKER_CLASSES.length]]) ?? []);
  const clarification = awaiting?.interrupt as { value?: { question?: string; options?: string[] } }[] | undefined;
  const clarificationValue = clarification?.[0]?.value;
  const awaitingDebate = awaiting?.debate as unknown as DebateResult | undefined;
  const debateKey = activeDebate ? `${activeDebate.factPacks.map((place) => place.id).join("|")}#${activeDebate.openingMessages.length}-${activeDebate.attackMessages.length}-${activeDebate.rebuttalMessages.length}` : "";

  // 缺席说明：某轮没有出场的地点也要交代原因，用户才不会奇怪「怎么少了一家」。
  const round2Speakers = new Set((activeDebate?.attackMessages ?? []).map((message) => message.speakerPoiId));
  const round3Speakers = new Set((activeDebate?.rebuttalMessages ?? []).map((message) => message.speakerPoiId));
  const round2Statuses: StatusItem[] = (activeDebate?.factPacks ?? [])
    .filter((place) => !round2Speakers.has(place.id))
    .map((place) => ({ placeId: place.id, text: "这一轮没有我的对局——手头证据还撑不起有把握的质疑，先看他俩过招。" }));
  const round3Statuses: StatusItem[] = (activeDebate?.factPacks ?? [])
    .filter((place) => !round3Speakers.has(place.id))
    .map((place) => ({ placeId: place.id, text: "没有质疑点名到我，这一轮我先听大家说。" }));
  const duelStatuses: StatusItem[] = awaiting?.status === "awaiting_final_selection"
    ? (awaitingDebate?.factPacks ?? [])
      .filter((place) => !(awaitingDebate?.survivingCandidateIds ?? []).includes(place.id))
      .map((place) => ({ placeId: place.id, text: "刚才被你淘汰了，我在场边看它俩决赛。" }))
    : [];

  // 舞台时间轴：首轮展示按顺序逐个弹出（节奏放慢，让用户看清过程），后续更新快速级联。
  const full = revealMode === "full";
  const msgStep = full ? 950 : 240;
  const blockGap = full ? 560 : 140;
  const metaDelay = 0;
  const understandDelay = full ? 480 : 90;
  const candHeadDelay = understandDelay + (full ? 420 : 120);
  const candDelays = (activeDebate?.factPacks ?? []).map((_, index) => candHeadDelay + (full ? 300 : 90) + index * (full ? 320 : 120));
  let cursor = (candDelays[candDelays.length - 1] ?? candHeadDelay) + blockGap;
  const roundInputs = [
    { messages: activeDebate?.openingMessages ?? [], statuses: [] as StatusItem[] },
    { messages: activeDebate?.attackMessages ?? [], statuses: round2Statuses },
    { messages: activeDebate?.rebuttalMessages ?? [], statuses: round3Statuses },
  ];
  const roundDelays = roundInputs.map(({ messages, statuses }) => {
    const head = cursor;
    const first = head + (full ? 420 : 100);
    const total = messages.length + statuses.length;
    cursor = first + Math.max(total - 1, 0) * msgStep + blockGap;
    return { head, msgs: first };
  });
  const [round1, round2, round3] = roundDelays;
  const decisionDelay = cursor + (full ? 200 : 0);
  const winnerDelay = 160;
  const summaryDelay = winnerDelay + 420;

  useEffect(() => {
    if (!full || !activeDebate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const container = resultsRef.current;
    if (!container) return;
    const stages = Array.from(container.querySelectorAll<HTMLElement>("[data-stage]"));
    const timers = stages.map((el) => window.setTimeout(() => { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, Number(el.dataset.stage || 0)));
    const cancelAll = () => { for (const timer of timers) window.clearTimeout(timer); };
    window.addEventListener("wheel", cancelAll, { once: true, passive: true });
    window.addEventListener("touchstart", cancelAll, { once: true, passive: true });
    return () => { cancelAll(); window.removeEventListener("wheel", cancelAll); window.removeEventListener("touchstart", cancelAll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debateKey, revealMode]);

  return <main>
    <header className="topbar">
      <p className="eyebrow">AI 现场辩论</p>
      <h1>地点辩论会</h1>
      <p className="intro">说出你的想法，附近三个真实地点会为「谁最适合你」当场辩论。</p>
    </header>

    <section className="panel">
      <label className="field-label" htmlFor="query">你今天想做什么？</label>
      <textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} rows={4} />
      <button className="btn btn-full" disabled={loading || !query.trim()} onClick={runDebate} type="button">{loading ? "辩论进行中…" : "开始辩论"}</button>
      <div className="loc-row">
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={useMyLocation} type="button">📍 使用我的位置</button>
        <span className="loc-status">{locationStatus}</span>
      </div>
      {error ? <p className="error-box">{error}</p> : null}
    </section>

    {loading && !activeDebate ? <section className="panel loading">
      <span className="progress" aria-hidden="true"><i /></span>
      <span className="loading-phrase pop" key={loadingPhase}>{loadingText}</span>
    </section> : null}

    {loading && activeDebate ? <div className="loading-pill-wrap" aria-live="polite">
      <span className="loading-pill pop" key={loadingPhase}><i className="pill-dot" aria-hidden="true" />{loadingText}</span>
    </div> : null}

    {awaiting?.status === "awaiting_clarification" ? <section className="panel pop">
      <SectionHead badge="?" title="还差一点信息" />
      <p className="clarify-q">{clarificationValue?.question ?? "请补充你的需求。"}</p>
      <div className="clarify-options">{clarificationValue?.options?.map((option) => <button className="btn btn-ghost choice-btn" key={option} disabled={loading} onClick={() => void resumeDebate({ answer: option })} type="button">{option}</button>)}</div>
    </section> : null}

    {activeDebate ? <div className="results" key={debateKey} ref={resultsRef}>
      <section className="panel meta-strip pop" data-stage={metaDelay} style={{ animationDelay: `${metaDelay}ms` }}>
        <span>📍 <strong>{activeDebate.location.formattedAddress}</strong></span>
        <span>天气：{activeDebate.weather.available ? `${activeDebate.weather.temperatureC ?? ""}°C · ${activeDebate.weather.weather}` : "暂无天气数据"}</span>
      </section>

      <UnderstandingPanel debate={activeDebate} delay={understandDelay} />

      <section className="round-group" data-stage={candHeadDelay}>
        <SectionHead title="出场地点" delay={candHeadDelay} />
        <div className="cand-list">{activeDebate.factPacks.map((place, index) => <article className="cand pop" key={place.id} style={{ animationDelay: `${candDelays[index]}ms` }}>
          <div className="cand-img-wrap">
            {place.imageUrl
              ? <Image className="cand-img" src={place.imageUrl} alt={place.name} loading="lazy" width={860} height={272} unoptimized />
              : <div className="cand-img cand-img-fallback" aria-hidden="true"><span>{place.name.slice(0, 1)}</span></div>}
            <span className={`cand-rank r${index + 1}`}>{index + 1}</span>
          </div>
          <div className="cand-body">
            <div className="cand-top"><h3 className="cand-name">{place.name}</h3><span className="cand-cat">{place.category}</span></div>
            <p className="cand-meta">距你 {formatDistance(place.distanceMeters)} · 步行 {place.route?.walking.durationMinutes ?? "未知"} 分钟 · 驾车 {place.route?.driving.durationMinutes ?? "未知"} 分钟{place.rating === undefined ? "" : ` · 评分 ${place.rating}`}</p>
            <TransitFeedback route={place.route} delay={candDelays[index] + 120} />
          </div>
        </article>)}</div>
      </section>

      <section className="round-group" data-stage={round1.head}>
        <SectionHead badge="1" title="第 1 轮 · 开场陈述" delay={round1.head} />
        <MessageList messages={activeDebate.openingMessages} names={names} speakerClass={speakerClass} baseDelay={round1.msgs} stepDelay={msgStep} />
      </section>

      <section className="round-group" data-stage={round2.head}>
        <SectionHead badge="2" title="第 2 轮 · 互相质疑" delay={round2.head} />
        <MessageList messages={activeDebate.attackMessages} names={names} speakerClass={speakerClass} baseDelay={round2.msgs} stepDelay={msgStep} statuses={round2Statuses} />
      </section>

      <section className="round-group" data-stage={round3.head}>
        <SectionHead badge="3" title="第 3 轮 · 正面回应" delay={round3.head} />
        <MessageList messages={activeDebate.rebuttalMessages} names={names} speakerClass={speakerClass} baseDelay={round3.msgs} stepDelay={msgStep} statuses={round3Statuses} />
      </section>

      {awaiting?.status === "awaiting_final_selection" ? <section className="round-group">
        <SectionHead title="最终对决" delay={60} />
        <MessageList messages={awaitingDebate?.finalDuelMessages ?? []} names={names} speakerClass={speakerClass} baseDelay={140} stepDelay={msgStep} statuses={duelStatuses} />
        {awaitingDebate?.survivingCandidateIds.map((id) => <button className="btn choice-btn pop" key={id} style={{ animationDelay: `${140 + (awaitingDebate?.finalDuelMessages.length ?? 0) * msgStep}ms` }} disabled={loading} onClick={() => void resumeDebate(id)} type="button">把票投给 {names.get(id) ?? id}</button>)}
      </section> : null}

      {awaiting?.status === "awaiting_candidate_decision" ? <section className="panel pop" data-stage={decisionDelay} style={{ animationDelay: `${decisionDelay}ms` }}>
        <SectionHead title="听完了，该你决定了" />
        <p className="clarify-q">淘汰一个，让另外两个继续辩。</p>
        {activeDebate.factPacks.map((place) => <button className="btn btn-danger choice-btn" key={place.id} disabled={loading} onClick={() => void resumeDebate({ actionType: "eliminate_candidate", eliminatedPoiId: place.id })} type="button">淘汰 {place.name}</button>)}
        <div className="divider">
          <p className="clarify-q">这三个都不太行？换一批。</p>
          <textarea aria-label="补充你的要求" value={intervention} onChange={(event) => setIntervention(event.target.value)} rows={3} placeholder="哪里不太对？" />
          <button className="btn btn-ghost btn-full" disabled={loading} onClick={() => void resumeDebate({ actionType: "refresh_candidates", feedbackText: intervention, selectedReasons: [] })} type="button">按这些要求重新找</button>
        </div>
      </section> : null}

      {result ? <>{result.selectedPoiId ? <section className="panel winner winner-pop" style={{ animationDelay: `${winnerDelay}ms` }}>
        <p className="winner-label">🏆 最终推荐</p>
        <p className="winner-name">{names.get(result.selectedPoiId) ?? result.selectedPoiId}</p>
      </section> : null}
      {result.interventionText ? <section className="panel pop" style={{ animationDelay: `${winnerDelay + 220}ms` }}>
        <SectionHead title="听起来你的想法变了" />
        <p className="clarify-q">你补充了：{result.interventionText}</p>
        {result.preferenceDelta && result.preferenceDelta.changedFields.length > 0 ? <><p className="sub-lead">由此调整的偏好</p><ul className="delta-list">{result.preferenceDelta.changedFields.map((change) => <li key={change.field}>{fieldLabel(change.field)}：{formatPreferenceValue(change.field, change.before)} → {formatPreferenceValue(change.field, change.after)}</li>)}</ul></> : null}
      </section> : null}
      {result.moderatorResult ? <section className="panel pop" style={{ animationDelay: `${summaryDelay}ms` }}>
        <SectionHead title="中立点评" />
        <p className="msg-claim">{result.moderatorResult.recommendationSummary}</p>
        <p className="hint">{result.moderatorResult.preferenceImpact}</p>
        <p className="sub-lead">当前匹配度排名</p>
        <ol className="rank-list">{result.moderatorResult.rankingByCurrentFit.map((item) => <li key={item.poiId}><strong>{names.get(item.poiId)}</strong> — {item.reason}</li>)}</ol>
        {result.moderatorResult.conflictAxes.length > 0 ? <><p className="sub-lead">几个地点之间最大的分歧</p><div className="chips">{result.moderatorResult.conflictAxes.map((axis) => <span className="chip" key={axis}>{axis}</span>)}</div></> : null}
      </section> : null}</> : null}
    </div> : null}
  </main>;
}
