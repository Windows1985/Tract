// Motion grammar for the whole app — fades only.
// Outgoing fades 150ms; incoming fades 200ms ease-out with a 4px upward
// drift; reveal 180ms; MCQ options stagger 40ms. prefers-reduced-motion is
// respected globally via MotionConfig reducedMotion="user" in main.tsx,
// which collapses these to instant.

export const fade = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const reveal = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
};

export const staggerOption = (i: number) => ({
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut", delay: i * 0.04 } },
});

export const crossfade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};
