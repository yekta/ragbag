import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components/text";

// The parts a detail sheet is built from.
//
// Section to section is 32pt, which is the rhythm the settings screen uses
// rather than a third value invented here. At 20 the summary, the things found
// and the attachments run together into one column of text and the headings
// have to carry the whole job of saying where one ends: a sheet is read by its
// gaps before it is read by its type.

export function SectionHeading({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <Text className={`mb-2 text-xs font-semibold ${tone ?? "text-muted-foreground"}`}>
      {children}
    </Text>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View className="mb-8">
      {title ? <SectionHeading>{title}</SectionHeading> : null}
      {children}
    </View>
  );
}

/**
 * The seam. Everything below it is *about* the thing rather than part of it,
 * which is the job the tear line does on a message card. Dashed for the same
 * reason it is perforated there.
 */
export function Seam() {
  return <View className="mb-8 border-t border-dashed border-border" />;
}
