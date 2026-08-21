import { ActivityIndicator, Pressable, type PressableProps } from "react-native";
import { Text } from "@/components/text";

// The pressable, with the app's press rule built in.
//
// Every clickable surface repeats its hover under :active on web; there is no
// hover on a phone, so the whole of that budget goes to the press, and it has
// to be there or a tap has no acknowledgement at all between the touch and
// whatever it causes. uniwind maps `active:` to the pressed state, so the rungs
// ported from index.css are what a press travels to here.
//
// Geometry never moves: the press changes the fill and nothing else, so a
// button cannot resize under a thumb that is already on it.

export type TButtonVariant = "primary" | "foreground" | "outline" | "ghost" | "destructive";
export type TButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<TButtonVariant, { box: string; label: string }> = {
  primary: { box: "bg-primary active:bg-primary-hover", label: "text-primary-foreground" },
  foreground: {
    box: "bg-foreground active:bg-foreground-hover",
    label: "text-background",
  },
  outline: {
    box: "border border-border bg-card active:bg-background-hover",
    label: "text-foreground",
  },
  ghost: { box: "active:bg-hover", label: "text-foreground" },
  destructive: {
    box: "bg-destructive active:bg-destructive-hover",
    label: "text-primary-foreground",
  },
};

// 44 points is the smallest target iOS has drawn a navigation-bar button at
// since iOS 7 and is Android's own minimum too, so `md` starts there rather
// than at the web's 36px mouse target.
const SIZE: Record<TButtonSize, { box: string; label: string }> = {
  sm: { box: "h-9 px-3 rounded-md", label: "text-sm" },
  md: { box: "h-11 px-4 rounded-lg", label: "text-base" },
  lg: { box: "h-13 px-5 rounded-lg", label: "text-base" },
};

export type TButtonProps = Omit<PressableProps, "children" | "style"> & {
  children: string;
  variant?: TButtonVariant;
  size?: TButtonSize;
  /** Busy: the label stays put and a spinner replaces it, so nothing resizes. */
  pending?: boolean;
  className?: string;
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  className,
  ...props
}: TButtonProps) {
  const tone = VARIANT[variant];
  const box = SIZE[size];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || pending, busy: pending }}
      disabled={disabled || pending}
      className={`flex-row items-center justify-center gap-2 ${box.box} ${tone.box} ${
        disabled ? "opacity-50" : ""
      } ${className ?? ""}`}
      {...props}
    >
      {pending ? (
        <ActivityIndicator size="small" />
      ) : (
        <Text className={`font-semibold ${box.label} ${tone.label}`}>{children}</Text>
      )}
    </Pressable>
  );
}
