import { queries } from "@ragbag/contracts";
import { useQuery } from "@rocicorp/zero/react";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StatusBar, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// A gesture callback is a worklet, running on the UI thread: it cannot call
// back into JS without being handed across explicitly.
import { scheduleOnRN } from "react-native-worklets";
import { Icon } from "@/components/icon";
import { mediaSource } from "@/lib/media";

// One picture, full screen.
//
// The original bytes rather than the 1600px display copy, because a picture
// opened full screen is the one place in the app where a downscale is not the
// picture (plan §2.2). The exception is a format the platform cannot decode,
// which on a phone is nothing: iOS reads HEIC natively and Android reads
// everything expo-image ships a decoder for, so unlike the web there is no
// transcode to fall back to.
//
// Pinch, pan and swipe-to-dismiss are gesture-handler and Reanimated, which
// means every one of them runs on the UI thread and tracks the finger rather
// than following it a frame later. A JS-driven pinch on a 12MP photo is the
// single most obvious place a React Native app feels like a web page.

/** How far a downward drag has to travel before letting go dismisses. */
const DISMISS_PX = 120;

const MIN_SCALE = 1;
const MAX_SCALE = 6;

export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [attachment] = useQuery(queries.attachment({ id }));
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const backdrop = useSharedValue(1);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_SCALE) {
        // Snapping home rather than leaving a photo a few percent off: a
        // picture that rests at 1.02 is a picture that can be panned by a
        // pixel, which reads as the view being loose.
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Zoomed in: the drag moves the picture.
        translateX.value = savedX.value + e.translationX;
        translateY.value = savedY.value + e.translationY;
        return;
      }
      // At rest: a downward drag is a dismissal, and the backdrop thins as it
      // goes so the gesture reports its own progress.
      translateY.value = Math.max(0, e.translationY);
      backdrop.value = 1 - Math.min(1, translateY.value / (DISMISS_PX * 3));
    })
    .onEnd(() => {
      if (scale.value > 1) {
        savedX.value = translateX.value;
        savedY.value = translateY.value;
        return;
      }
      if (translateY.value > DISMISS_PX) {
        // The screen is closed from JS, so the gesture hands back here.
        scheduleOnRN(router.back);
        return;
      }
      translateY.value = withTiming(0);
      backdrop.value = withTiming(1);
    });

  // A double tap is the shortcut for the pinch nobody wants to do one-handed.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = scale.value > 1;
      scale.value = withTiming(zoomed ? 1 : 2.5);
      savedScale.value = zoomed ? 1 : 2.5;
      if (zoomed) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <View className="flex-1">
      {/* Black, always, in both themes: a photo is the content and everything
          around it is out of the way. */}
      <Animated.View
        style={[{ position: "absolute", inset: 0, backgroundColor: "#000" }, backdropStyle]}
      />
      <StatusBar barStyle="light-content" />

      <GestureDetector gesture={gesture}>
        <Animated.View className="flex-1 items-center justify-center" style={imageStyle}>
          {attachment ? (
            <Image
              source={mediaSource(attachment.blobId, "original")}
              placeholder={
                attachment.placeholder ? { thumbhash: attachment.placeholder } : undefined
              }
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={150}
              accessibilityLabel={attachment.generatedTitle ?? attachment.filename}
              style={{ width, height }}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={12}
        onPress={() => router.back()}
        className="absolute left-4 size-11 items-center justify-center rounded-full bg-black/50"
        style={{ top: insets.top + 8 }}
      >
        <Icon name="x" size={20} color="#ffffff" />
      </Pressable>
    </View>
  );
}
