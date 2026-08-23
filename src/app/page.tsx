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
      if (body.status === "candidates_ready") setResult(body.debate as DebateResult);
      else setAwaiting(body as AwaitingIntervention);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Debate failed."); }
    finally { setLoading(false); }
  }

  async function resumeDebate(action: unknown) {
    if (!awaiting) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/debate/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: awaiting.threadId, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Debate failed to resume.");
      if (body.status === "awaiting_clarification") {
        const interrupted = body.debate as { __interrupt__?: unknown };
        setAwaiting({ ...(awaiting as AwaitingIntervention), debate: body.debate, interrupt: interrupted.__interrupt__ ?? awaiting.interrupt } as AwaitingIntervention);
      }
      else { setResult(body.debate as DebateResult); setAwaiting(null); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Debate failed to resume."); }
    finally { setLoading(false); }
  }

  const activeDebate = result;
  const names = new Map(activeDebate?.factPacks.map((place) => [place.id, place.name]) ?? []);
  const clarification = awaiting?.interrupt as { value?: { question?: string; options?: string[] } }[] | undefined;

  return <main>
    <header><p className="eyebrow">Live POI workflow · LangGraph</p><h1>Place Debate Agent</h1><p className="intro">输入你的偏好，让附近真实候选地点基于证据进行三轮辩论。</p></header>
    <section>
      <label htmlFor="query">你今天想做什么？</label><textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} rows={5} />
      <button disabled={loading || !query.trim()} onClick={runDebate} type="button">{loading ? "Running Debate…" : "Run Debate"}</button>
      <button disabled={loading} onClick={useMyLocation} type="button">使用我的位置</button><p className="muted">📍 {locationStatus}</p>{error ? <p className="error">{error}</p> : null}
    </section>
    {awaiting ? <section><h2>还差一点信息</h2><p>{clarification?.[0]?.value?.question ?? "请补充你的需求。"}</p>{clarification?.[0]?.value?.options?.map((option) => <button key={option} disabled={loading} onClick={() => void resumeDebate({ answer: option })} type="button">{option}</button>)}</section> : null}
    {activeDebate ? <div className="results">
      <section><h2>Parsed Preference</h2><pre>{JSON.stringify(activeDebate.originalPreference, null, 2)}</pre></section>
      <section><p>📍 {activeDebate.location.formattedAddress}</p><p>天气：{activeDebate.weather.available ? `${activeDebate.weather.temperatureC ?? ""}°C · ${activeDebate.weather.weather}` : "暂无天气数据"}</p></section>
      <section><h2>Candidates</h2><div className="candidate-grid">{activeDebate.factPacks.map((place) => <article className="candidate" key={place.id}><h3>{place.name}</h3><p>{place.category} · {place.distanceMeters} m</p><p>步行 {place.route?.walking.durationMinutes ?? "未知"} min · 驾车 {place.route?.driving.durationMinutes ?? "未知"} min · {place.rating === undefined ? "评分未知" : `⭐ ${place.rating}`}</p></article>)}</div></section>
      {activeDebate.openingMessages.length > 0 ? <section><h2>Round 1 · Opening</h2><MessageList messages={activeDebate.openingMessages} names={names} /></section> : null}
      {activeDebate.attackMessages.length > 0 ? <section><h2>Round 2 · Attack</h2><MessageList messages={activeDebate.attackMessages} names={names} /></section> : null}
      {awaiting && (awaiting.debate as { survivingCandidateIds?: string[] }).survivingCandidateIds?.length === 2 ? <section><h2>Final Duel</h2><MessageList messages={(awaiting.debate as unknown as DebateResult).finalDuelMessages} names={names} />{(awaiting.debate as unknown as DebateResult).survivingCandidateIds.map((id) => <button key={id} disabled={loading} onClick={() => void resumeDebate(id)} type="button">选择 {names.get(id)}</button>)}</section> : awaiting ? <section><h2>听完第一轮，你现在可以：</h2><p>淘汰一个，让另外两个继续辩。</p>{activeDebate.factPacks.map((place) => <button key={place.id} disabled={loading} onClick={() => void resumeDebate({ actionType: "eliminate_candidate", eliminatedPoiId: place.id })} type="button">淘汰 {place.name}</button>)}<p>这三个都不太行，换一批。</p><textarea aria-label="补充你的要求" value={intervention} onChange={(event) => setIntervention(event.target.value)} rows={3} placeholder="哪里不太对？" /><button disabled={loading} onClick={() => void resumeDebate({ actionType: "refresh_candidates", feedbackText: intervention, selectedReasons: [] })} type="button">按这些要求重新找</button></section> : null}
      {result ? <><section><h2>Preference Update</h2><p>你补充了：{result.interventionText || "没有新增偏好"}</p><ul>{result.preferenceDelta?.changedFields.map((change) => <li key={change.field}>{change.field}: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</li>)}</ul><h3>Current Preference</h3><pre>{JSON.stringify(result.currentPreference, null, 2)}</pre></section>
      <section><h2>Round 3 · Rebuttal</h2><MessageList messages={result.rebuttalMessages} names={names} /></section>
      {result.moderatorResult ? <section><h2>Moderator Summary</h2><p>{result.moderatorResult.recommendationSummary}</p><p>{result.moderatorResult.preferenceImpact}</p><h3>当前匹配度</h3><ol>{result.moderatorResult.rankingByCurrentFit.map((item) => <li key={item.poiId}><strong>{names.get(item.poiId)}</strong> — {item.reason}</li>)}</ol><h3>冲突轴</h3><ul>{result.moderatorResult.conflictAxes.map((axis) => <li key={axis}>{axis}</li>)}</ul></section> : null}</> : null}
    </div> : null}
  </main>;
}
