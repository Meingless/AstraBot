import { useEffect, useState } from "react";

let uiAudioContext: AudioContext | null = null;
function playUiTone(frequency: number, duration: number, volume: number) {
  uiAudioContext ||= new AudioContext();
  if (uiAudioContext.state === "suspended") void uiAudioContext.resume();
  const oscillator = uiAudioContext.createOscillator();
  const gain = uiAudioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, uiAudioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    frequency * 1.18,
    uiAudioContext.currentTime + duration,
  );
  gain.gain.setValueAtTime(0.0001, uiAudioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    volume,
    uiAudioContext.currentTime + 0.012,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    uiAudioContext.currentTime + duration,
  );
  oscillator.connect(gain).connect(uiAudioContext.destination);
  oscillator.start();
  oscillator.stop(uiAudioContext.currentTime + duration);
}

export function SoundEffects() {
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("astra-sound") === "on",
  );
  useEffect(() => {
    localStorage.setItem("astra-sound", enabled ? "on" : "off");
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("button, a, select, input")) return;
      playUiTone(
        target.closest(".toggle-row") ? 520 : 360,
        target.closest(".button.primary, .save, .module-button") ? 0.11 : 0.06,
        0.025,
      );
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [enabled]);
  const toggle = () =>
    setEnabled((value) => {
      const next = !value;
      if (next) playUiTone(620, 0.12, 0.03);
      return next;
    });
  return (
    <button
      className={`sound-toggle ${enabled ? "active" : ""}`}
      onClick={toggle}
      aria-pressed={enabled}
      title={enabled ? "Turn sound effects off" : "Turn sound effects on"}
    >
      {enabled ? "Sound on" : "Sound off"}
    </button>
  );
}

export function MotionLayer() {
  useEffect(() => {
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      matchMedia("(pointer: coarse)").matches
    )
      return;
    const root = document.documentElement;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--cursor-x", `${event.clientX}px`);
        root.style.setProperty("--cursor-y", `${event.clientY}px`);
        root.style.setProperty(
          "--parallax-x",
          `${(event.clientX / innerWidth - 0.5) * 18}px`,
        );
        root.style.setProperty(
          "--parallax-y",
          `${(event.clientY / innerHeight - 0.5) * 18}px`,
        );
        frame = 0;
      });
    };
    const onPointer = (event: PointerEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "button, .button",
      );
      if (!button) return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--ripple-x", `${event.clientX - rect.left}px`);
      button.style.setProperty("--ripple-y", `${event.clientY - rect.top}px`);
      button.classList.remove("ripple");
      void button.offsetWidth;
      button.classList.add("ripple");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onPointer);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);
  return (
    <div className="motion-layer" aria-hidden>
      {Array.from({ length: 14 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}


