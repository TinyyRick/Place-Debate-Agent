import { View } from "@tarojs/components";

/** 底部半屏面板：遮罩点击关闭，面板从底部弹起。 */
function BottomSheet({ visible, title, onClose, children }: {
  visible: boolean;
  title?: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return <View className="sheet-root" catchMove>
    <View className="sheet-mask" onClick={onClose} />
    <View className="sheet" onClick={(event) => event.stopPropagation()}>
      <View className="sheet-grip" />
      {title ? <View className="sheet-title">{title}</View> : null}
      <View className="sheet-body">{children}</View>
    </View>
  </View>;
}

export default BottomSheet;
