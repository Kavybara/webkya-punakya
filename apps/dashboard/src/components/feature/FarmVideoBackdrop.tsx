import { useEffect, useRef, useState } from "react";

import "./FarmVideoBackdrop.css";

/**
 * The farm, playing behind the public pages.
 *
 * A 12-second loop of a pixel-art capybara farm, sampled for the palette in
 * `styles/tokens.css` -- the buttons and the wordmark are the same daylight as
 * the background rather than a dark console laid over a bright field.
 *
 * Mounted by the public routes only. The owner console and the reseller panel
 * have no video: they are dense tables, and a moving background behind numbers
 * is both slower to read and slower to paint. They take the same sky from
 * `index.css` instead, so the daylight is continuous across the login.
 *
 * --- the rules this obeys, and why each one is here ---
 *
 * `muted` and `playsInline` are not optional polish. Without `muted` the
 * browser blocks autoplay outright and the page shows a black rectangle with a
 * play button in it, which on a landing page reads as a broken hero. Without
 * `playsInline` iOS Safari takes the video fullscreen, so the visitor loses the
 * navbar and the button on the very first tap.
 *
 * `preload="none"` because the poster is what the visitor sees first, and the
 * fetch is deferred to idle in the effect below so that the attribute has
 * something to do. On its own `preload` is not a download policy -- one
 * `play()` call on mount overrides it, which is what this component used to do
 * and why the first paint on `/harga` was competing with 3.8MB of video. The
 * attribute and the idle hand-off have to be there together.
 *
 * The scrim is not decoration. This footage is bright and busy: grass at
 * luminance 0.59, sky at 0.56, and a waterfall at the right edge that is nearly
 * white. Body text over any of those fails contrast outright. The gradient is
 * weighted to the top and the bottom -- where the navbar and the footer sit --
 * and thin in the middle, so the hero wordmark sits on the quietest part of
 * the frame and the video is still visible through it.
 *
 * `prefers-reduced-motion` stops the play and leaves the poster. WCAG 2.2.2
 * is about motion that starts on its own, which is exactly what an autoplaying
 * loop is; a still frame of the same scene is the same information with none of
 * it.
 */
export function FarmVideoBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let idleHandle = 0;
    let timeoutHandle = 0;

    const start = () => {
      if (cancelled) return;
      // The poster is what renders if this never fires, so a failure is a still
      // farm rather than a broken hero -- nothing to report and nothing to retry.
      // `isPlaying` stays false on rejection, which is the whole state the
      // stylesheet needs: there is no separate "can play" flag to fall out of
      // sync with it.
      video.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false),
      );
    };

    /*
     * Waiting for idle is the whole fix, and it is a real one.
     *
     * `preload="none"` below is real too, and until this call it was doing
     * nothing: `play()` on mount is an explicit request to start fetching, and
     * the browser honours it immediately. So every visitor paid 3.8MB -- and
     * the main thread paid to decode the first frames -- before the wordmark
     * had finished painting. `preload="none"` was documented here as the thing
     * that saved the visitor the download, and it never could.
     *
     * `requestIdleCallback` is the point at which the browser has nothing more
     * important to do, which on a page this light is after first paint. The
     * timeout is the fallback for Safari, which did not ship
     * `requestIdleCallback` until 18 and is worth a video that arrives late but
     * certainly rather than never.
     *
     * The poster covers the gap either way, so nothing is ever blank.
     */
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleWindow = window as IdleWindow;

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleHandle = idleWindow.requestIdleCallback(start, { timeout: 1200 });
    } else {
      timeoutHandle = window.setTimeout(start, 300);
    }

    return () => {
      cancelled = true;
      if (idleHandle && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
    };
  }, []);

  return (
    <div className="farm-backdrop" aria-hidden="true">
      <video
        ref={videoRef}
        className="farm-backdrop-video"
        src="/media/capybara-farm.mp4"
        poster="/media/capybara-farm-poster.jpg"
        muted
        loop
        playsInline
        preload="none"
        tabIndex={-1}
        data-playing={isPlaying}
      />
      {/* Two scrims, not one. The upper one is weighted for the navbar, where
          dark ink needs a pale backing to stay legible over the sky. */}
      <div className="farm-backdrop-scrim" />
    </div>
  );
}
