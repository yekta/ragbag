import Svg, { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { useResolvedTheme } from "@/lib/theme";

/** Solid on light, where a filled mark reads as one confident shape. */
const SOLID =
  "M22 18C22 20.2091 20.2091 22 18 22H17V17H22V18ZM22 14H14V22H10V10H22V14ZM14.3428 0C15.4036 0 16.4217 0.42173 17.1719 1.17188L20.8281 4.82812C21.4216 5.42157 21.8083 6.18282 21.9443 7H7V21.9443C6.18282 21.8083 5.42157 21.4216 4.82812 20.8281L1.17188 17.1719C0.42173 16.4217 0 15.4036 0 14.3428V4C0 1.79086 1.79086 0 4 0H14.3428Z";

/** Outlined on dark, where the same fill would bloom into a bright blob. */
const OUTLINE =
  "M15.3428 0C16.6689 0 17.9412 0.527173 18.8789 1.46484L22.5352 5.12109C23.4728 6.05878 24 7.33114 24 8.65723V19C24 21.7614 21.7614 24 19 24H8.65723C7.33114 24 6.05878 23.4728 5.12109 22.5352L1.46484 18.8789C0.527173 17.9412 0 16.6689 0 15.3428V5C0 2.23858 2.23858 0 5 0H15.3428ZM11 11V23H15V15H23V11H11ZM18 18V23H19C21.2091 23 23 21.2091 23 19V18H18ZM5 1C2.79086 1 1 2.79086 1 5V15.3428C1 16.4036 1.42173 17.4217 2.17188 18.1719L5.82812 21.8281C6.42157 22.4216 7.18282 22.8083 8 22.9443V8H22.9443C22.8083 7.18282 22.4216 6.42157 21.8281 5.82812L18.1719 2.17188C17.4217 1.42173 16.4036 1 15.3428 1H5Z";

/** Each cut fills its own grid, so the solid one is scaled onto the other's. */
const SOLID_TO_OUTLINE_GRID = 24 / 22;

/**
 * The Ragbag mark: the same two paths the web app draws, and the same reason
 * for there being two. A filled mark reads as one confident shape on light and
 * blooms into a bright blob on dark, so dark gets the outlined cut.
 *
 * The web keeps both in the tree and fades one up in CSS, so the right mark is
 * painted before any theme state is read. There is no equivalent here (uniwind
 * resolves classNames in JS either way), so the theme is asked outright and one
 * path is drawn. Nothing is lost: the theme is applied before the first render.
 */
export function Logo({ size = 16, color }: { size?: number; color?: string }) {
  const foreground = useCSSVariable("--color-foreground") as string;
  const ink = color ?? foreground;
  const dark = useResolvedTheme() === "dark";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {dark ? (
        <Path d={OUTLINE} fill={ink} />
      ) : (
        <Path d={SOLID} fill={ink} transform={`scale(${SOLID_TO_OUTLINE_GRID})`} />
      )}
    </Svg>
  );
}
