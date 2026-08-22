"use client";

import { useState } from "react";
import type { DebateMessage, DebateResult } from "@/lib/schemas/debate";

const DEFAULT_QUERY = "想出去走走，但是不要太累，一个人，最好有点意思。";

function MessageList({ messages, names }: { messages: DebateMessage[]; names: Map<string, string> }) {
  if (messages.length === 0) return <p className="muted">本轮没有需要展示的回应。</p>;
  return (
    <div className="message-list">
      {messages.map((message, index) => (
        <article className="message" key={`${message.type}-${message.speakerPoiId}-${index}`}>
          <strong>{names.get(message.speakerPoiId) ?? message.speakerPoiId}</strong>
          {message.targetPoiId ? <span> → {names.get(message.targetPoiId) ?? message.targetPoiId}</span> : null}
          <p>{message.claim}</p>
          <small>Evidence: {message.evidenceIds.join(", ")}</small>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<DebateResult | null>(null);
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
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, ...(gpsCoordinates ? { gpsCoordinates } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Debate failed.");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Debate failed.");
    } finally {
      setLoading(false);
    }
  }

  const names = new Map(result?.factPacks.map((place) => [place.id, place.name]) ?? []);

  return (
    <main>
      <header>
        <p className="eyebrow">Live POI workflow · LangGraph</p>
        <h1>Place Debate Agent</h1>
        <p className="intro">输入你的偏好，让附近真实候选地点基于证据进行三轮辩论。</p>
      </header>

      <section>
        <label htmlFor="query">你今天想做什么？</label>
        <textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} rows={5} />
        <button disabled={loading || !query.trim()} onClick={runDebate} type="button">
          {loading ? "Running Debate…" : "Run Debate"}
        </button>
        <button disabled={loading} onClick={useMyLocation} type="button">使用我的位置</button>
        <p className="muted">📍 {locationStatus}</p>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {result ? (
        <div className="results">
          <section>
            <h2>Parsed Preference</h2>
            <pre>{JSON.stringify(result.userPreference, null, 2)}</pre>
          </section>
          <section><p>📍 {result.location.formattedAddress}</p><p>天气：{result.weather.available ? `${result.weather.temperatureC ?? ""}°C · ${result.weather.weather}` : "暂无天气数据"}</p></section>
          <section>
            <h2>Candidates</h2>
            <div className="candidate-grid">
              {result.factPacks.map((place) => (
                <article className="candidate" key={place.id}>
                  <h3>{place.name}</h3>
                  <p>{place.category} · {place.distanceMeters} m</p>
                  <p>步行 {place.route?.walking.durationMinutes ?? "未知"} min · 驾车 {place.route?.driving.durationMinutes ?? "未知"} min · {place.rating === undefined ? "评分未知" : `⭐ ${place.rating}`}</p>
                </article>
              ))}
            </div>
          </section>
          <section><h2>Round 1 · Opening</h2><MessageList messages={result.openingMessages} names={names} /></section>
          <section><h2>Round 2 · Attack</h2><MessageList messages={result.attackMessages} names={names} /></section>
          <section><h2>Round 3 · Rebuttal</h2><MessageList messages={result.rebuttalMessages} names={names} /></section>
          <section>
            <h2>Moderator Summary</h2>
            <p>{result.moderatorResult.recommendationSummary}</p>
            <h3>当前匹配度</h3>
            <ol>{result.moderatorResult.rankingByCurrentFit.map((item) => <li key={item.poiId}><strong>{names.get(item.poiId)}</strong> — {item.reason}</li>)}</ol>
            <h3>冲突轴</h3>
            <ul>{result.moderatorResult.conflictAxes.map((axis) => <li key={axis}>{axis}</li>)}</ul>
          </section>
        </div>
      ) : null}
    </main>
  );
}
