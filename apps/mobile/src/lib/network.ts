import * as Network from "expo-network";
import { useSyncExternalStore } from "react";

// "Is there a connection?", once, for everything that needs it.
//
// The web app asks `navigator.onLine` and listens for the `online` event in
// four places (the meta fetch, the session recovery, the blob queue, the sync
// banner). None of that exists here, and the equivalent is not a property but
// a native subscription, so it is worth having exactly one of.
//
// `isInternetReachable` is deliberately preferred over `isConnected` when the
// platform offers it: a phone attached to a captive-portal wifi is connected
// and cannot reach anything, which is precisely the state this app is asked
// to ride out. `undefined` means the platform has not decided yet, and the
// optimistic reading is the right one: treating "unknown" as offline would
// park the upload queue and paint the offline banner on every cold start.

let online = true;
const listeners = new Set<() => void>();

function publish(state: Network.NetworkState) {
  const next = state.isInternetReachable ?? state.isConnected ?? true;
  if (next === online) return;
  online = next;
  for (const listener of listeners) listener();
}

Network.getNetworkStateAsync()
  .then(publish)
  .catch(() => {
    // Never resolved a state: stay optimistic, as above.
  });
Network.addNetworkStateListener(publish);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isOnline(): boolean {
  return online;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}

/**
 * Run `callback` whenever the connection comes back.
 *
 * Reconnecting is a far better signal than any timer, and it is what lets a
 * backoff that was earned during a real outage be abandoned the moment the
 * outage ends.
 */
export function onReconnect(callback: () => void): () => void {
  let previous = online;
  return subscribe(() => {
    if (online && !previous) callback();
    previous = online;
  });
}
