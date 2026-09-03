import { Button, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useDebateStore } from "../../store/debate";
import "./index.css";

// 快捷开场：点一下即填入示例需求，降低打字成本。
const EXAMPLES = [
  "☀️ 想出去走走，别太累",
  "🌧️ 下雨天也要有意思",
  "👥 和朋友聚一聚",
  "📚 安静地呆一下午",
];

export default function Home() {
  const query = useDebateStore((state) => state.query);
  const locationStatus = useDebateStore((state) => state.locationStatus);
  const error = useDebateStore((state) => state.error);
  const setQuery = useDebateStore((state) => state.setQuery);
  const useMyLocation = useDebateStore((state) => state.useMyLocation);
  const start = useDebateStore((state) => state.start);

  function beginDebate() {
    if (!query.trim()) return;
    void start();
    Taro.navigateTo({ url: "/pages/debate/index" });
  }

  return <View className="page home">
    <View className="topbar">
      <Text className="eyebrow">AI 现场辩论</Text>
      <View className="h1">地点辩论会</View>
      <Text className="intro">说出你的想法，附近三个真实地点会为「谁最适合你」当场辩论。</Text>
    </View>

    <View className="panel">
      <Text className="field-label">你今天想做什么？</Text>
      <Textarea className="field-area" value={query} maxlength={-1} onInput={(event) => setQuery(event.detail.value)} />
      <View className="example-chips">
        {EXAMPLES.map((example) => (
          <Text className="chip chip-example" key={example} onClick={() => setQuery(example.replace(/^\S+\s/, ""))}>{example}</Text>
        ))}
      </View>
      <Button className="btn btn-full" hoverClass="btn-hover" disabled={!query.trim()} onClick={beginDebate}>开始辩论</Button>
      <View className="loc-row">
        <Button className="btn btn-ghost btn-sm" hoverClass="btn-hover" onClick={useMyLocation}>📍 使用我的位置</Button>
        <Text className="loc-status">{locationStatus}</Text>
      </View>
      {error ? <Text className="error-box">{error}</Text> : null}
    </View>

    <View className="home-foot">
      <View className="foot-dot d-violet" />
      <View className="foot-dot d-sky" />
      <View className="foot-dot d-mint" />
      <Text className="foot-text">三个地点 · 三轮交锋 · 你来裁决</Text>
    </View>
  </View>;
}
