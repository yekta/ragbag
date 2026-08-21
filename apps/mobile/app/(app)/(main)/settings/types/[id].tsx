import { useLocalSearchParams } from "expo-router";
import { TypeEditor } from "@/features/settings/type-editor";

// `/settings/types/<id>` edits one, `/settings/types/new` adds one. Same form
// either way, which is what the null means: the editor has no second layout
// for a type that does not exist yet.
export default function TypeEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TypeEditor typeId={id === "new" ? null : id} />;
}
