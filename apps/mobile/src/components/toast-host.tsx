import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { dismissToast, useToasts, type TToastTone } from "@/lib/toast";

// Where a transient message lands.
//
// Top, not bottom: the bottom of every screen in this app is the composer, and
// a message that covers the send button is a message that stops you doing the
// thing you opened the app for.
//
// Neutral surfaces, not coloured ones: the card and the border are the same
// tokens as every other panel, and only the icon carries the tone. A red slab
// across the top of a chat reads as the app being broken rather than as one
// upload having failed.

const TONE: Record<TToastTone, { icon: "alert" | "check" | "sparkles"; color: string }> = {
  error: { icon: "alert", color: "text-destructive" },
  warning: { icon: "alert", color: "text-warning-foreground" },
  info: { icon: "sparkles", color: "text-muted-foreground" },
};

export function ToastHost() {
  const toasts = useToasts();
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 top-0 z-50 gap-2 px-3"
      style={{ paddingTop: insets.top + 8 }}
    >
      {toasts.map((item) => {
        const tone = TONE[item.tone];
        return (
          <Pressable
            key={item.id}
            accessibilityRole="alert"
            onPress={() => dismissToast(item.id)}
            className="flex-row items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-lg active:bg-background-hover"
          >
            <View className="pt-0.5">
              <Icon name={tone.icon} size={16} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className={`text-sm font-semibold ${tone.color}`}>{item.title}</Text>
              {item.description ? (
                <Text className="text-sm text-muted-foreground">{item.description}</Text>
              ) : null}
            </View>
            {item.action ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  item.action?.onPress();
                  dismissToast(item.id);
                }}
                className="rounded-md px-2 py-1 active:bg-hover"
              >
                <Text className="text-sm font-semibold text-primary">{item.action.label}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
