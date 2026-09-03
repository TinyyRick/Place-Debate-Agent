import { Image, Text, View } from "@tarojs/components";
import type { FactPack } from "../types";

const httpsImageUrl = (url: string | undefined) => url?.replace(/^http:\/\//, "https://");

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${meters} 米`;
}

export function TransitFeedback({ route, delay }: { route: FactPack["route"]; delay: number }) {
  const transit = route?.transit;
  if (!transit) return null;
  if (transit.status === "unavailable") return <Text className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>地铁路线：暂时无法确认</Text>;
  if (transit.status === "no_route") return <Text className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>地铁路线：未查到可用方案</Text>;
  if (!transit.usesMetro) return <Text className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>公交 {transit.durationMinutes ?? "未知"} 分钟 · 不含地铁</Text>;
  return <Text className="cand-meta pop" style={{ animationDelay: `${delay}ms` }}>{transit.directMetro ? "地铁零换乘直达" : `地铁需换乘 ${transit.transferCount ?? "未知"} 次`} · 全程 {transit.durationMinutes ?? "未知"} 分钟 · 接驳步行 {transit.walkingDistanceMeters ?? "未知"} 米{transit.lineNames.length ? ` · ${transit.lineNames.join(" → ")}` : ""}</Text>;
}

function CandidateCard({ place, rank, delay, eliminate = false, onEliminate }: {
  place: FactPack;
  rank: number;
  delay: number;
  eliminate?: boolean;
  onEliminate?: () => void;
}) {
  return <View
    className={`cand pop${eliminate ? " cand-eliminate" : ""}`}
    style={{ animationDelay: `${delay}ms` }}
    hoverClass={eliminate ? "cand-press" : ""}
    onClick={eliminate ? onEliminate : undefined}
  >
    <View className="cand-img-wrap">
      {httpsImageUrl(place.imageUrl)
        ? <Image className="cand-img" src={httpsImageUrl(place.imageUrl) as string} mode="aspectFill" lazyLoad />
        : <View className="cand-img cand-img-fallback"><Text className="cand-img-fallback-char">{place.name.slice(0, 1)}</Text></View>}
      <View className={`cand-rank r${rank}`}><Text>{rank}</Text></View>
      {eliminate ? <View className="cand-eliminate-tag"><Text>✕ 点它淘汰</Text></View> : null}
    </View>
    <View className="cand-body">
      <View className="cand-top"><Text className="cand-name">{place.name}</Text><Text className="cand-cat">{place.category.split(";").pop() ?? place.category}</Text></View>
      <Text className="cand-meta">距你 {formatDistance(place.distanceMeters)} · 步行 {place.route?.walking?.durationMinutes ?? "未知"} 分钟 · 驾车 {place.route?.driving?.durationMinutes ?? "未知"} 分钟{place.rating === undefined ? "" : ` · 评分 ${place.rating}`}</Text>
      <TransitFeedback route={place.route} delay={delay + 120} />
    </View>
  </View>;
}

export default CandidateCard;
