import { useEffect, useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { SectionHead } from "../../components/SectionHead";
import { TransitFeedback } from "../../components/CandidateCard";
import { fieldLabel, formatPreferenceValue } from "../../labels";
import { useDebateStore } from "../../store/debate";
import type { FactPack } from "../../types";
import "./index.css";

const CONFETTI_COLORS = ["#ff6b35", "#ffc53d", "#ff5c9d", "#3b9eff", "#7c5cff", "#00b578"];

// 彩带纸屑：位置/节奏由序号推导，一次生成不再变化。
const CONFETTI = Array.from({ length: 16 }, (_, index) => ({
  left: `${6 + ((index * 61) % 88)}%`,
  delay: `${((index * 137) % 600) / 1000}s`,
  duration: `${2.2 + ((index * 29) % 12) / 10}s`,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
}));

function Confetti() {
  return <View className="confetti-layer">
    {CONFETTI.map((piece, index) => (
      <View
        key={index}
        className="confetti-piece"
        style={{ left: piece.left, background: piece.color, animationDelay: piece.delay, animationDuration: piece.duration }}
      />
    ))}
  </View>;
}

const httpsImageUrl = (url: string | undefined) => url?.replace(/^http:\/\//, "https://");

const formatDistance = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${meters} 米`);

function ProfileFacts({ winner }: { winner: FactPack }) {
  const transit = winner.route?.transit;
  const category = winner.category.split(";").pop() ?? winner.category;
  return <View>
    <View className="cand-top"><Text className="cand-name">{winner.name}</Text><Text className="cand-cat">{category}</Text></View>
    <Text className="cand-meta">
      距你 {formatDistance(winner.distanceMeters)}
      · 步行 {winner.route?.walking?.durationMinutes ?? "未知"} 分钟
      · 驾车 {winner.route?.driving?.durationMinutes ?? "未知"} 分钟
      {winner.rating === undefined ? "" : ` · 评分 ${winner.rating}`}
      {winner.averageCostYuan === undefined ? "" : ` · 人均约 ${winner.averageCostYuan} 元`}
    </Text>
    <TransitFeedback route={winner.route} delay={200} />
    {transit === undefined ? <Text className="cand-meta">地铁信息：暂无数据</Text> : null}
  </View>;
}

export default function Result() {
  const debate = useDebateStore((state) => state.debate);
  const reset = useDebateStore((state) => state.reset);
  const [celebrate, setCelebrate] = useState(false);

  // 没有结果数据时（如直接打开本页）回首页。
  useEffect(() => {
    if (!debate) Taro.reLaunch({ url: "/pages/home/index" });
  }, [debate]);

  useEffect(() => {
    setCelebrate(true);
  }, []);

  if (!debate) return null;
  const names = new Map(debate.factPacks.map((place) => [place.id, place.name]));
  const winner = debate.factPacks.find((place) => place.id === debate.selectedPoiId);
  const ranking = [...(debate.afterInterventionScores ?? [])].sort((left, right) => right.total - left.total);

  function restart() {
    reset();
    Taro.reLaunch({ url: "/pages/home/index" });
  }

  return <View className="page result-page">
    {celebrate && debate.selectedPoiId ? <Confetti /> : null}

    {debate.selectedPoiId ? <View className="panel winner winner-pop">
      <Text className="winner-label">🏆 最终推荐</Text>
      <Text className="winner-name">{names.get(debate.selectedPoiId) ?? debate.selectedPoiId}</Text>
      <Text className="winner-sub">三轮辩论后，它是最适合你的那一个。</Text>
    </View> : null}

    {debate.interventionText ? <View className="panel pop">
      <SectionHead title="听起来你的想法变了" />
      <Text className="clarify-q">你补充了：{debate.interventionText}</Text>
      {debate.preferenceDelta && debate.preferenceDelta.changedFields.length > 0 ? <View>
        <Text className="sub-lead">由此调整的偏好</Text>
        <View className="delta-list">
          {debate.preferenceDelta.changedFields.map((change) => (
            <Text className="li" key={change.field}>{fieldLabel(change.field)}：{formatPreferenceValue(change.field, change.before)} → {formatPreferenceValue(change.field, change.after)}</Text>
          ))}
        </View>
      </View> : null}
    </View> : null}

    {winner ? <View className="panel pop">
      <SectionHead badge="档" title="获胜地点档案" />
      <ProfileFacts winner={winner} />
      {ranking.length > 0 ? <View>
        <Text className="sub-lead">当前偏好下的匹配度（你的选择优先）</Text>
        <View className="rank-list">
          {ranking.map((item, index) => (
            <Text className="li" key={item.poiId}><Text className="li-strong">{index + 1}. {names.get(item.poiId) ?? item.poiId}</Text> — 综合 {Math.round(item.total * 100)} 分</Text>
          ))}
        </View>
      </View> : null}
    </View> : null}

    <View className="result-actions">
      <Button className="btn btn-full" hoverClass="btn-hover" onClick={restart}>再来一次</Button>
    </View>
  </View>;
}
