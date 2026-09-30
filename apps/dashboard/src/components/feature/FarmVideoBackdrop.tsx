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
 * `preload="none"` because the poster is what the visitor sees first. A
 * `preload="auto"` here spends 3.7MB of someone's mobile data before they have
 * read a single word, on the assumption that the video is above the fold on
 * every route -- and on `/harga` it is, but a visitor who never scrolls past
 * the price table should not have paid for it. The video loads when it is told
 * to, below.
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
  const [canPlay, setCanPlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    const video = videoRef.current;
    if (!video) return;

    // The poster is what renders if this never fires, so a failure is a still
    // farm rather than a broken hero -- nothing to report and nothing to retry.
    video.play().then(
      () => setIsPlaying(true),
      () => setCanPlay(false),
    );
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
        onCanPlay={() => setCanPlay(true)}
        data-playing={isPlaying}
      />
      {/* Two scrims, not one. The upper one is weighted for the navbar, where
          dark ink needs a pale backing to stay legible over the sky. */}
      <div className="farm-backdrop-scrim" />
    </div>
  );
}
