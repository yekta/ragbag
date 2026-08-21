import { Text as RNText, type TextProps } from "react-native";

// Every string in the app goes through here, for one reason: React Native's
// <Text> has no inherited font and no inherited colour. A bare <Text> is the
// system face at the system size in the system colour, so an app that uses
// <Text> directly anywhere ends up with two typefaces and two inks and no
// obvious moment where it happened.
//
// The classes are the web app's defaults, spelled once: the sans face, the
// 16px body size that every input in this app is also held to, and the
// foreground token. Anything a caller passes wins, because uniwind resolves
// later classes over earlier ones.

export function Text({ className, ...props }: TextProps) {
  return <RNText {...props} className={`font-sans text-base text-foreground ${className ?? ""}`} />;
}

/** A heading outranks its content by size, never by weight alone. */
export function Title({ className, ...props }: TextProps) {
  return <Text {...props} className={`text-2xl font-bold ${className ?? ""}`} />;
}

export function Heading({ className, ...props }: TextProps) {
  return <Text {...props} className={`text-lg font-semibold ${className ?? ""}`} />;
}

/** Secondary copy: captions, counts, the line under a title. */
export function Muted({ className, ...props }: TextProps) {
  return <Text {...props} className={`text-sm text-muted-foreground ${className ?? ""}`} />;
}
