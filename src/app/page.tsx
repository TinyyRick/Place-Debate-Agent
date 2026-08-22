"use client";

import { useState } from "react";
import type { AwaitingIntervention } from "@/lib/graph/debate-graph";
import type { DebateMessage, DebateResult } from "@/lib/schemas/debate";

const DEFAULT_QUERY = "想出去走走，但是不要太累，一个人，最好有点意思。";

function MessageList({ messages, names }: { messages: DebateMessage[]; names: Map<string, string> }) {
  if (messages.length === 0) return <p className="muted">本轮没有需要展示的回应。</p>;
  return <div className="message-list">{messages.map((message, index) => <article className="message" key={`${message.type}-${message.speakerPoiId}-${index}`}>
    <strong>{names.get(message.speakerPoiId) ?? message.speakerPoiId}</strong>{message.targetPoiId ? <span> → {names.get(message.targetPoiId) ?? message.targetPoiId}</span> : null}
    <p>{message.claim}</p><small>Evidence: {message.evidenceIds.join(", ")}</small>
  </article>)}</div>;
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
    setLoading(true); setError(""); setResult(null); setAwaiting(null); setIntervention("");
    try {
      const response = await fetch("/api/debate/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, ...(gpsCoordinates ? { gpsCoordinates } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Debate failed.");
      setAwaiting(body as AwaitingIntervention);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Debate failed."); }
    finally { setLoading(false); }
  }

  async function resumeDebate(text = intervention) {
    if (!awaiting) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/debate/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: awaiting.threadId, intervention: text }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Debate failed to resume.");
      setResult(body.debate as DebateResult); setAwaiting(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Debate failed to resume."); }
    finally { setLoading(false); }
  }

  const activeDebate = result ?? awaiting?.debate ?? null;
  const names = new Map(activeDebate?.factPacks.map((place) => [place.id, place.name]) ?? []);

  return <main>
    <header><p className="eyebrow">Live POI workflow · LangGraph</p><h1>Place Debate Agent</h1><p className="intro">输入你的偏好，让附近真实候选地点基于证据进行三轮辩论。</p></header>
    <section>
      <label htmlFor="query">你今天想做什么？</label><textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} rows={5} />
      <button disabled={loading || !query.trim()} onClick={runDebate} type="button">{loading ? "Running Debate…" : "Run Debate"}</button>
      <button disabled={loading} onClick={useMyLocation} type="button">使用我的位置</button><p className="muted">📍 {locationStatus}</p>{error ? <p className="error">{error}</p> : null}
    </section>
    {activeDebate ? <div className="results">
      <section><h2>Parsed Preference</h2><pre>{JSON.stringify(activeDebate.originalPreference, null, 2)}</pre></section>
      <section><p>📍 {activeDebate.location.formattedAddress}</p><p>天气：{activeDebate.weather.available ? `${activeDebate.weather.temperatureC ?? ""}°C · ${activeDebate.weather.weather}` : "暂无天气数据"}</p></section>
      <section><h2>Candidates</h2><div className="candidate-grid">{activeDebate.factPacks.map((place) => <article className="candidate" key={place.id}><h3>{place.name}</h3><p>{place.category} · {place.distanceMeters} m</p><p>步行 {place.route?.walking.durationMinutes ?? "未知"} min · 驾车 {place.route?.driving.durationMinutes ?? "未知"} min · {place.rating === undefined ? "评分未知" : `⭐ ${place.rating}`}</p></article>)}</div></section>
      <section><h2>Round 1 · Opening</h2><MessageList messages={activeDebate.openingMessages} names={names} /></section>
      <section><h2>Round 2 · Attack</h2><MessageList messages={activeDebate.attackMessages} names={names} /></section>
      {awaiting ? <section><p>在他们继续之前，你有什么想补充的吗？</p><textarea aria-label="有什么想补充的吗？" value={intervention} onChange={(event) => setIntervention(event.target.value)} rows={3} placeholder="例如：其实我不怕热，我更想看历史建筑。" /><button disabled={loading} onClick={() => void resumeDebate()} type="button">加入我的想法</button><button disabled={loading} onClick={() => void resumeDebate("")} type="button">不补充，继续</button></section> : null}
      {result ? <><section><h2>Preference Update</h2><p>你补充了：{result.interventionText || "没有新增偏好"}</p><ul>{result.preferenceDelta.changedFields.map((change) => <li key={change.field}>{change.field}: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</li>)}</ul><h3>Current Preference</h3><pre>{JSON.stringify(result.currentPreference, null, 2)}</pre></section>
      <section><h2>Round 3 · Rebuttal</h2><MessageList messages={result.rebuttalMessages} names={names} /></section>
      <section><h2>Moderator Summary</h2><p>{result.moderatorResult.recommendationSummary}</p><p>{result.moderatorResult.preferenceImpact}</p><h3>当前匹配度</h3><ol>{result.moderatorResult.rankingByCurrentFit.map((item) => <li key={item.poiId}><strong>{names.get(item.poiId)}</strong> — {item.reason}</li>)}</ol><h3>冲突轴</h3><ul>{result.moderatorResult.conflictAxes.map((axis) => <li key={axis}>{axis}</li>)}</ul></section></> : null}
    </div> : null}
  </main>;
}
