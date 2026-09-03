import { useEffect, useRef, useState } from "react";
import { Button, Image, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import BottomSheet from "../../components/BottomSheet";
import LoadingStage from "../../components/LoadingStage";
import MessageList, { type StatusItem } from "../../components/MessageList";
import { SectionHead } from "../../components/SectionHead";
import { useDebateStore } from "../../store/debate";
import type { DebateResult } from "../../types";
import "./index.css";

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

const httpsImageUrl = (url: string | undefined) => url?.replace(/^http:\/\//, "https://");

const formatDistance = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${meters} 米`);

export default function Debate() {
  const debate = useDebateStore((state) => state.debate);
  const awaiting = useDebateStore((state) => state.awaiting);
  const loading = useDebateStore((state) => state.loading);
  const error = useDebateStore((state) => state.error);
  const start = useDebateStore((state) => state.start);
  const resume = useDebateStore((state) => state.resume);

  const [intervention, setIntervention] = useState("");
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  /** 已解锁的轮次：1=只看开场，2=质疑已解锁，3=回应已解锁。每一步由用户交互推进。 */
  const [revealedRounds, setRevealedRounds] = useState(1);
  const [duelRevealed, setDuelRevealed] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const scrollingRef = useRef(0);

  // 直接打开本页（如从输入页跳转）时发起辩论；返回后再进入不会重复请求。
  useEffect(() => {
    if (!debate && !awaiting && !loading) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setLoadingPhase((phase) => phase + 1), 2600);
    return () => clearInterval(timer);
  }, [loading]);

  // 澄清问题到达时自动弹出底部面板。
  useEffect(() => {
    if (awaiting?.status === "awaiting_clarification") setClarifyOpen(true);
  }, [awaiting?.status]);

  // 终局产生后进入结果页（redirectTo，让返回键回到首页）。
  useEffect(() => {
    if (debate?.selectedPoiId) Taro.redirectTo({ url: "/pages/result/index" });
  }, [debate?.selectedPoiId]);

  const loadingText = LOADING_PHRASES[loadingPhase % LOADING_PHRASES.length](phaseCount(loadingPhase));

  const interruptedDebate = awaiting?.debate as unknown as DebateResult | undefined;
  const activeDebate = debate ?? (interruptedDebate?.factPacks?.length ? interruptedDebate : null);
  const names = new Map(activeDebate?.factPacks.map((place) => [place.id, place.name]) ?? []);
  const speakerClass = new Map(activeDebate?.factPacks.map((place, index) => [place.id, `sp${index % 3}`]) ?? []);
  const clarificationValue = awaiting?.interrupt?.[0]?.value;
  const awaitingDebate = awaiting?.debate as unknown as DebateResult | undefined;
  const candidateKey = activeDebate ? activeDebate.factPacks.map((place) => place.id).join("|") : "";

  // 换了一批地点（或新辩论）后，重新从第 1 轮循序渐进。
  useEffect(() => {
    setRevealedRounds(1);
    setDuelRevealed(false);
  }, [candidateKey]);

  const scrollTo = (selector: string, offset = 76) => {
    if (Date.now() < scrollingRef.current) return;
    scrollingRef.current = Date.now() + 600;
    setTimeout(() => {
      const pageQuery = Taro.createSelectorQuery();
      pageQuery.select(selector).boundingClientRect();
      pageQuery.selectViewport().scrollOffset();
      pageQuery.exec((results) => {
        const rect = (results?.[0] ?? null) as { top: number } | null;
        const scroll = (results?.[1] ?? { scrollTop: 0 }) as { scrollTop: number };
        if (!rect) return;
        Taro.pageScrollTo({ scrollTop: Math.max(rect.top + scroll.scrollTop - offset, 0), duration: 400 }).catch(() => {});
      });
    }, 80);
  };

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

  // 轮次进度：1 开场 → 2 质疑 →（等你淘汰）→ 3 回应 → 4 最终对决。
  const progress = awaiting?.status === "awaiting_final_selection"
    ? 4
    : (activeDebate?.rebuttalMessages.length ?? 0) > 0
      ? 3
      : awaiting?.status === "awaiting_candidate_decision"
        ? 2.5
        : (activeDebate?.attackMessages.length ?? 0) > 0 ? 2 : 1;
  const progressText = awaiting?.status === "awaiting_final_selection"
    ? duelRevealed ? "把票投给你认可的那个" : "最终对决即将开场"
    : awaiting?.status === "awaiting_candidate_decision"
      ? revealedRounds >= 2 ? "等你淘汰一个，后两位继续辩" : "看完质疑，再来裁决"
      : `第 ${Math.min(Math.ceil(progress), 3)} 轮 · ${["开场", "质疑", "回应"][Math.min(Math.ceil(progress), 3) - 1]}进行中`;

  const revealNext = () => {
    const next = Math.min(revealedRounds + 1, 3);
    setRevealedRounds(next);
    scrollTo(`.round-anchor-${next}`);
  };

  const eliminate = async (poiId: string) => {
    if (loading) return;
    await resume({ actionType: "eliminate_candidate", eliminatedPoiId: poiId });
    setRevealedRounds(3);
    scrollTo(".round-anchor-3");
  };

  const firstRun = !activeDebate;
  const deciding = awaiting?.status === "awaiting_candidate_decision";
  const voting = awaiting?.status === "awaiting_final_selection";

  return <View className="page debate-page">
    {error ? <Text className="error-box">{error}</Text> : null}

    {firstRun && loading ? <View className="panel loading-panel">
      <LoadingStage phrase={loadingText} phase={loadingPhase} />
      <Button className="btn btn-ghost btn-sm" hoverClass="btn-hover" onClick={() => Taro.navigateBack().catch(() => {})}>返回修改需求</Button>
    </View> : null}

    {firstRun && !loading && !awaiting ? <View className="panel">
      <SectionHead badge="！" title="还没开始" />
      <Text className="clarify-q">回到首页说出你的想法，辩论马上开始。</Text>
      <Button className="btn btn-full" hoverClass="btn-hover" onClick={() => Taro.navigateBack().catch(() => {})}>回首页</Button>
    </View> : null}

    {activeDebate ? <View className="results">
      <View className="topbar">
        <View className="live-badge"><View className="live-dot" /><Text className="live-text">现场直播</Text></View>
      </View>

      <View className="panel meta-strip pop">
        <Text className="meta-line">📍 <Text className="meta-strong">{activeDebate.location.formattedAddress}</Text></Text>
        <Text className="meta-line">天气：{activeDebate.weather.available ? `${activeDebate.weather.temperatureC ?? ""}°C · ${activeDebate.weather.weather ?? ""}` : "暂无天气数据"}</Text>
      </View>

      {activeDebate.intentProfile?.goal || activeDebate.experienceProfile ? <View className="panel">
        <View className="pop" style={{ animationDelay: "160ms" }}>
          <SectionHead title="这样理解你的需求" />
          {activeDebate.intentProfile?.goal ? <Text className="goal-line">{activeDebate.intentProfile.goal}</Text> : null}
          <UnderstandingChips debate={activeDebate} />
        </View>
      </View> : null}

      <View className="round-group">
        <SectionHead title="出场地点" delay={320} />
        <View className="cand-list">{activeDebate.factPacks.map((place, index) => <View className="cand pop" key={place.id} style={{ animationDelay: `${480 + index * 160}ms` }}>
          <View className="cand-img-wrap">
            {httpsImageUrl(place.imageUrl)
              ? <Image className="cand-img" src={httpsImageUrl(place.imageUrl) as string} mode="aspectFill" lazyLoad />
              : <View className="cand-img cand-img-fallback"><Text className="cand-img-fallback-char">{place.name.slice(0, 1)}</Text></View>}
            <View className={`cand-rank r${index + 1}`}><Text>{index + 1}</Text></View>
          </View>
          <View className="cand-body">
            <View className="cand-top"><Text className="cand-name">{place.name}</Text><Text className="cand-cat">{place.category}</Text></View>
            <Text className="cand-meta">距你 {formatDistance(place.distanceMeters)} · 步行 {place.route?.walking?.durationMinutes ?? "未知"} 分钟 · 评分{place.rating === undefined ? "未知" : ` ${place.rating}`}</Text>
          </View>
        </View>)}</View>
      </View>

      {revealedRounds >= 1 ? <View className="round-group round-anchor-1">
        <SectionHead badge="1" title="第 1 轮 · 开场陈述" delay={60} />
        <MessageList messages={activeDebate.openingMessages} names={names} speakerClass={speakerClass} baseDelay={140} stepDelay={300} />
        {revealedRounds === 1 ? <Button className="btn btn-full gate-btn" hoverClass="btn-hover" onClick={revealNext}>看第 2 轮 · 互相质疑 ↓</Button> : null}
      </View> : null}

      {revealedRounds >= 2 ? <View className="round-group round-anchor-2">
        <SectionHead badge="2" title="第 2 轮 · 互相质疑" delay={60} />
        <MessageList messages={activeDebate.attackMessages} names={names} speakerClass={speakerClass} baseDelay={140} stepDelay={300} statuses={round2Statuses} />
      </View> : null}

      {revealedRounds >= 2 && deciding ? <View className="decide-panel pop">
        <SectionHead badge="✂" title="听完了？该你决定了" />
        <Text className="clarify-q">点一张卡片，淘汰它，后两位进入最终对决。</Text>
        <View className="mini-cand-list">{activeDebate.factPacks.map((place) => <View
          key={place.id} className="mini-cand" hoverClass="mini-cand-press"
          onClick={() => void eliminate(place.id)}
        >
          {httpsImageUrl(place.imageUrl)
            ? <Image className="mini-cand-img" src={httpsImageUrl(place.imageUrl) as string} mode="aspectFill" lazyLoad />
            : <View className="mini-cand-img mini-cand-img-fb"><Text>{place.name.slice(0, 1)}</Text></View>}
          <View className="mini-cand-body">
            <Text className="mini-cand-name">{place.name}</Text>
            <Text className="mini-cand-meta">距你 {formatDistance(place.distanceMeters)} · 步行 {place.route?.walking?.durationMinutes ?? "未知"} 分钟</Text>
          </View>
          <View className="mini-cand-x"><Text>✕</Text></View>
        </View>)}</View>
        <Button className="btn btn-ghost btn-sm btn-full" hoverClass="btn-hover" disabled={loading} onClick={() => setRefreshOpen(true)}>这三个都不太行？换一批</Button>
      </View> : null}

      {revealedRounds >= 3 ? <View className="round-group round-anchor-3">
        <SectionHead badge="3" title="第 3 轮 · 正面回应" delay={60} />
        <MessageList messages={activeDebate.rebuttalMessages} names={names} speakerClass={speakerClass} baseDelay={140} stepDelay={300} statuses={round3Statuses} />
      </View> : null}

      {revealedRounds >= 3 && voting && !duelRevealed ? <Button className="btn btn-full gate-btn" hoverClass="btn-hover" onClick={() => { setDuelRevealed(true); scrollTo(".duel-anchor"); }}>进入最终对决 🏆</Button> : null}

      {revealedRounds >= 3 && voting && duelRevealed ? <View className="round-group duel-anchor">
        <SectionHead title="最终对决" delay={60} />
        <MessageList messages={awaitingDebate?.finalDuelMessages ?? []} names={names} speakerClass={speakerClass} baseDelay={140} stepDelay={300} statuses={duelStatuses} />
        <View className="vote-row">{(awaitingDebate?.survivingCandidateIds ?? []).map((id) => <Button className="btn btn-full" hoverClass="btn-hover" key={id} disabled={loading} onClick={() => void resume(id)}>把票投给 {names.get(id) ?? id}</Button>)}</View>
      </View> : null}
    </View> : null}

    {loading && activeDebate ? <View className="loading-pill-wrap">
      <View className="loading-pill pop" key={loadingPhase}>
        <View className="pill-dot" />
        <Text className="loading-pill-text">{loadingText}</Text>
      </View>
    </View> : null}

    {activeDebate ? <View className="sticky-bar">
      <View className="bar-progress">
        {["开场", "质疑", "回应"].map((label, index) => {
          const round = index + 1;
          const state = progress >= round + 1 ? "done" : progress > round ? "active" : "pending";
          return <View className={`progress-pill ${state}`} key={label}>
            <View className="progress-num"><Text>{round}</Text></View>
            <Text className="progress-label">{label}</Text>
          </View>;
        })}
        <Text className="bar-progress-text">{progressText}</Text>
      </View>
      <View className="bar-actions">
        {awaiting?.status === "awaiting_clarification" ? (
          <Button className="btn btn-full bar-btn" hoverClass="btn-hover" disabled={loading} onClick={() => setClarifyOpen(true)}>回答主持人的问题</Button>
        ) : null}
      </View>
    </View> : null}

    <BottomSheet visible={clarifyOpen} title="还差一点信息" onClose={() => setClarifyOpen(false)}>
      <Text className="clarify-q">{clarificationValue?.question ?? "请补充你的需求。"}</Text>
      <View className="clarify-options">
        {clarificationValue?.options?.map((option) => (
          <Button className="btn btn-ghost choice-btn" hoverClass="btn-hover" key={option} disabled={loading}
            onClick={() => { setClarifyOpen(false); void resume({ answer: option }); }}>{option}</Button>
        ))}
      </View>
    </BottomSheet>

    <BottomSheet visible={refreshOpen} title="这三个都不太行？换一批" onClose={() => setRefreshOpen(false)}>
      <Text className="clarify-q">说说哪里不对，按新要求重新找。</Text>
      <Textarea className="field-area field-area-sm" value={intervention} maxlength={-1} placeholder="哪里不太对？" onInput={(event) => setIntervention(event.detail.value)} />
      <Button className="btn btn-full" hoverClass="btn-hover" disabled={loading}
        onClick={() => { setRefreshOpen(false); void resume({ actionType: "refresh_candidates", feedbackText: intervention, selectedReasons: [] }); }}>按这些要求重新找</Button>
    </BottomSheet>
  </View>;
}

function UnderstandingChips({ debate }: { debate: DebateResult }) {
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

  const chips: { text: string; className: string }[] = [];
  const push = (text: string, className = "chip chip-accent") => chips.push({ text, className });
  const intensity = INTENSITY_LABELS[debate.intentProfile?.activityIntensity ?? ""];
  if (intensity) push(intensity, "chip chip-sky");
  const engagement = ENGAGEMENT_LABELS[debate.experienceProfile?.engagementType ?? ""];
  if (engagement) push(engagement, "chip chip-mint");
  const social = SOCIAL_LABELS[debate.experienceProfile?.socialFit ?? ""];
  if (social) push(social, "chip chip-accent");
  const spatial = SPATIAL_LABELS[debate.experienceProfile?.spatial ?? ""];
  if (spatial) push(spatial, "chip chip-sky");
  const cost = COST_LABELS[debate.experienceProfile?.costTier ?? ""];
  if (cost) push(cost, "chip chip-mint");
  for (const constraint of debate.intentProfile?.constraints ?? []) if (containsChinese(constraint)) push(constraint);
  for (const avoid of debate.intentProfile?.avoid ?? []) if (containsChinese(avoid)) push(`避开：${avoid}`, "chip chip-avoid");
  if (chips.length === 0) return null;
  return <View className="chips">{chips.map((chip, index) => <Text className={chip.className} key={`${chip.text}-${index}`}>{chip.text}</Text>)}</View>;
}
