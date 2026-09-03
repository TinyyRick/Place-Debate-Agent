import { Text, View } from "@tarojs/components";

/** 辩论准备中的加载舞台：三个弹跳圆点 + 轮换话术（key 变化时重新弹入）。 */
function LoadingStage({ phrase, phase }: { phrase: string; phase: number }) {
  return <View className="stage-loading pop">
    <View className="dots">
      <View className="dot d1" />
      <View className="dot d2" />
      <View className="dot d3" />
    </View>
    <Text className="loading-phrase" key={phase}>{phrase}</Text>
  </View>;
}

export default LoadingStage;
