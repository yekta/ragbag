import { Slot, usePathname } from "expo-router";
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { Platform, StyleSheet, useWindowDimensions } from "react-native";
import { Drawer, useDrawerProgress } from "react-native-drawer-layout";
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { Sidebar } from "@/features/sidebar/sidebar";
import { isArchivePath } from "@/lib/routes";

// The sidebar's container, and it is the same one on both platforms.
//
// The archive slides to the right and the sidebar is revealed behind it, which
// is the shape every chat app on a phone has converged on. That convergence is
// the argument: it is not a house style, it is what a one-handed thumb can
// reach on a screen that has no room for a permanent column.
//
// It replaces two files that each reached for a platform's own answer. iOS had
// `expo-router/unstable-split-view`, a real UISplitViewController: right on an
// iPad and close to nothing on an iPhone, where UIKit collapses a split view to
// its secondary column and the sidebar is reachable only through a display-mode
// button UIKit shows when it feels like it. Android had `expo-router/drawer`,
// which worked, but as a navigator: the sidebar became a route in a second
// navigator wrapped around the stack, to hold one screen. Two containers, two
// gestures, two sets of failure modes, for one interaction that should be the
// same in the hand on both.
//
// `react-native-drawer-layout` rather than a hand-rolled pan gesture: the
// gesture and the spring are Reanimated worklets on the UI thread either way,
// but the library already answers the parts that are easy to get wrong (the
// edge hit-slop, the drag that starts on the revealed screen, the
// accessibility elements hidden behind the open drawer, the keyboard dismissed
// on drag). What it does not have is the look, and that is `ArchiveCard` below.
//
// This is chrome, not a route. The drawer is not a navigator and the sidebar is
// not a screen: there is exactly one thing under it, the stack in (main), and
// making the sidebar a route would have put a second navigator between the root
// Slot and that stack for nothing.

const IS_IOS = Platform.OS === "ios";

/**
 * How wide the sidebar opens.
 *
 * A share of the screen, capped. The share is what makes it read as a phone
 * drawer: enough of the archive stays on screen at the right to say what you
 * are coming back to. The cap is for the iPad this app also runs on, where the
 * same fraction is a sidebar wide enough to lose a tag name in.
 */
const SIDEBAR_SHARE = 0.74;
const SIDEBAR_MAX = 360;

/** How far in from the left edge a swipe starts the reveal. */
const SWIPE_EDGE = 44;

/** The archive's corner radius once it has been pushed aside. */
const CARD_RADIUS = 28;

/**
 * How far the archive shrinks as it goes.
 *
 * Small, and anchored to its own left edge (`transformOrigin`), so the card
 * keeps the position the drawer's translation gives it and the shrink reads as
 * depth rather than as the screen sliding diagonally.
 */
const CARD_SCALE = 0.94;

type TSidebarValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Called by everything in the sidebar that navigates: pick a row, get out. */
  close: () => void;
};

const SidebarContext = createContext<TSidebarValue | null>(null);

/** The sidebar's own open state, for the header button and every row in it. */
export function useSidebar(): TSidebarValue {
  const value = use(SidebarContext);
  if (!value) throw new Error("useSidebar outside WorkspaceShell");
  return value;
}

export function WorkspaceShell() {
  const [open, setOpen] = useState(false);
  const surface = useCSSVariable("--color-sidebar") as string;
  const canvas = useCSSVariable("--color-background") as string;
  const scrim = useCSSVariable("--color-scrim") as string;
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  const close = useCallback(() => setOpen(false), []);
  const value = useMemo<TSidebarValue>(() => ({ open, setOpen, close }), [close, open]);

  // The sidebar belongs to the archive, so the reveal is only armed on a view
  // of it. On anything pushed over one, the left edge is the platform's own
  // back gesture and two gestures competing for the same 44 points is one of
  // them losing at random.
  const onArchive = isArchivePath(pathname);

  return (
    <SidebarContext value={value}>
      <Drawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={close}
        // The screen slides off and the sidebar is revealed underneath, rather
        // than the sidebar sliding over the screen.
        drawerType="back"
        swipeEnabled={onArchive}
        swipeEdgeWidth={SWIPE_EDGE}
        drawerStyle={{
          backgroundColor: surface,
          width: Math.min(width * SIDEBAR_SHARE, SIDEBAR_MAX),
        }}
        // The veil's own alpha is in the token; the drawer animates the layer's
        // opacity from it, so nothing here may set `opacity` as well.
        overlayStyle={{ backgroundColor: scrim }}
        renderDrawerContent={() => <Sidebar />}
        // Behind everything, for the frame in which the card is mid-flight and
        // neither edge of the screen belongs to anything yet.
        style={{ backgroundColor: surface }}
      >
        <ArchiveCard canvas={canvas}>
          <Slot />
        </ArchiveCard>
      </Drawer>
    </SidebarContext>
  );
}

/**
 * The archive, as a card.
 *
 * Square and full-bleed at rest, and it has to be: a corner radius on a screen
 * that fills the display is a rounded rectangle with the sidebar's colour
 * showing through four corners of the device. So the radius, the shadow's
 * depth and the shrink are all functions of how far the drawer has come, which
 * `useDrawerProgress` hands over as a shared value already on the UI thread.
 *
 * Two views rather than one, because the shadow and the clip cannot share a
 * box: `overflow: "hidden"` on iOS clips the layer, and the shadow is drawn
 * outside the layer's bounds.
 */
function ArchiveCard({ canvas, children }: { canvas: string; children: ReactNode }) {
  const progress = useDrawerProgress();

  const lift = useAnimatedStyle(() => {
    const shown = interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP);
    const shape = {
      borderRadius: shown * CARD_RADIUS,
      transform: [{ scale: interpolate(shown, [0, 1], [1, CARD_SCALE]) }],
    };
    // Branched on a captured boolean rather than `Platform.select`: this
    // function is a worklet running on the UI thread, and a call into a JS
    // module that was never workletized is a crash there, not a fallback.
    return IS_IOS
      ? { ...shape, shadowOpacity: shown * 0.4, shadowRadius: shown * 24 }
      : { ...shape, elevation: shown * 24 };
  });

  const clip = useAnimatedStyle(() => ({
    borderRadius: interpolate(progress.value, [0, 1], [0, CARD_RADIUS], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[styles.card, { backgroundColor: canvas }, lift]}>
      <Animated.View style={[styles.clip, clip]}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    transformOrigin: "left center",
    shadowColor: "#000000",
    shadowOffset: { width: -8, height: 0 },
  },
  clip: { flex: 1, overflow: "hidden" },
});
