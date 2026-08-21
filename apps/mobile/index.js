// `uuid`'s v7 (packages/shared/src/ids.ts, which mints every id in the app,
// offline included) calls crypto.getRandomValues, and neither Hermes nor
// Expo's winter runtime provides one. This polyfill has to land before any
// module that might mint an id is evaluated, which is why it is here rather
// than in a layout: expo-router/entry registers the root component as a side
// effect of being imported.
import "react-native-get-random-values";
import "expo-router/entry";
