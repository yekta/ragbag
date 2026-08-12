// Coarse-pointer detection, sampled once: hover affordances don't exist on
// touch, and autofocusing an input pops the on-screen keyboard.
export const isTouch =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
