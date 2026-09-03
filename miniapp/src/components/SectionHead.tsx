import { Text, View } from "@tarojs/components";

export function SectionHead({ badge, title, delay = 0 }: { badge?: string; title: string; delay?: number }) {
  return (
    <View className="sec-head pop" style={{ animationDelay: `${delay}ms` }}>
      {badge ? <View className="sec-badge"><Text>{badge}</Text></View> : null}
      <Text className="h2">{title}</Text>
      <View className="sec-tail" />
    </View>
  );
}
