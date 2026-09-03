import { Text, View } from "@tarojs/components";
import type { DebateMessage } from "../types";

export type StatusItem = { placeId: string; text: string };

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
    return <Text className="msg-muted pop" style={{ animationDelay: `${baseDelay}ms` }}>这一轮没有产生有意义的交锋，不强行制造对抗。</Text>;
  }
  return <View className="msg-list">{items.map((item, index) => {
    const delay = baseDelay + index * stepDelay;
    if (item.kind === "status") {
      const cls = speakerClass.get(item.status.placeId) ?? "sp0";
      const name = names.get(item.status.placeId) ?? item.status.placeId;
      return <View className={`msg-row status pop ${cls}`} key={`status-${item.status.placeId}`} style={{ animationDelay: `${delay}ms` }}>
        <View className={`msg-avatar ${cls}`}><Text>{name.slice(0, 1)}</Text></View>
        <View className="msg-content">
          <View className="msg-head"><Text className={`msg-speaker ${cls}`}>{name}</Text></View>
          <View className="msg-bubble bubble-status"><Text className="msg-claim status-line">{item.status.text}</Text></View>
        </View>
      </View>;
    }
    const message = item.message;
    const speaker = speakerClass.get(message.speakerPoiId) ?? "sp0";
    const speakerName = names.get(message.speakerPoiId) ?? message.speakerPoiId;
    const otherId = message.targetPoiId ?? message.attackerPoiId;
    const otherCls = otherId ? speakerClass.get(otherId) ?? "sp0" : "";
    const otherName = otherId ? names.get(otherId) ?? otherId : "";
    return <View className={`msg-row pop ${speaker} ${message.type}`} key={`${message.type}-${message.speakerPoiId}-${otherId ?? "x"}-${index}`} style={{ animationDelay: `${delay}ms` }}>
      <View className={`msg-avatar duel-left ${speaker}`}><Text>{speakerName.slice(0, 1)}</Text></View>
      <View className="msg-content">
        <View className="msg-head">
          <Text className={`msg-speaker ${speaker}`}>{speakerName}</Text>
          {otherId ? [
            <Text key="badge" className={`clash-badge ${message.type === "attack" ? "" : "reply"}`}>{message.type === "attack" ? "VS" : "回应"}</Text>,
            <View key="other-avatar" className={`msg-avatar msg-avatar-mini duel-right ${otherCls}`}><Text>{otherName.slice(0, 1)}</Text></View>,
            <Text key="other-name" className={`msg-other ${otherCls}`}>{otherName}</Text>,
          ] : null}
        </View>
        <View className="msg-bubble"><Text className="msg-claim">{message.claim}</Text></View>
      </View>
    </View>;
  })}</View>;
}

export default MessageList;
