import { useId } from "react";

/*
 * The liquid blob.
 *
 * The hero used to be a two-column grid: a column of words on the left, a
 * bordered catalogue box on the right. That layout says "here are two columns"
 * before it has said anything about the product, and it is the layout every
 * SaaS landing page ships with. This is a single centred composition with a
 * mass of moving liquid behind it, so the page opens on a shape rather than on
 * a grid.
 *
 * How the liquid works, because the obvious approach is the wrong one:
 *
 * Four overlapping circles are drawn inside one group, and the group is passed
 * through a `feGaussianBlur` and then an `feColorMatrix` that crushes alpha
 * hard -- `26 * a - 12` turns anything fainter than ~0.46 transparent and
 * anything denser opaque. That is the "goo" trick: the blur rounds the union
 * of the circles into one soft silhouette, and the threshold collapses the
 * faint haze between them so the result reads as a single body of liquid
 * rather than as four circles behind frosted glass.
 *
 * The version that shows up in most tutorials reaches for `feTurbulence` plus
 * `feDisplacementMap` because it produces a wobbling edge that looks alive.
 * It is not worth it here: turbulence is a per-pixel noise field, so it has to
 * be re-evaluated for every frame of every animation on a full-bleed element,
 * and it costs more than the rest of the hero put together. Blur plus a colour
 * matrix is two cheap passes, and the motion comes from the circles moving
 * rather than from the filter being expensive.
 *
 * The circles are animated by CSS keyframes rather than by framer-motion. The
 * motion is a closed loop that never needs to know when it starts, it runs for
 * the whole time the tab is open, and it has to stop dead under
 * `prefers-reduced-motion` -- all three of which are things a stylesheet does
 * for free and a JS animation loop has to be told about twice.
 */
export default function LiquidBlob({ className = "" }: { className?: string }) {
  // Every filter and gradient needs an id, and the page is rendered more than
  // once across a session (route changes remount it), so a hard-coded id would
  // eventually point at the previous instance's gradient.
  const raw = useId();
  const uid = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  const goo = `goo-${uid}`;

  return (
    <div className={`liquid-blob ${className}`} aria-hidden="true">
      <svg viewBox="0 0 400 400" role="presentation" focusable="false">
        <defs>
          {/* The goo pass. The region is widened well past the default
              -10%/+120% because the blur spreads the silhouette outward and the
              default region crops exactly the part of the edge that makes it
              look liquid. */}
          <filter id={goo} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="20" result="soft" />
            <feColorMatrix
              in="soft"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 26 -11"
              result="goo"
            />
            {/* `in`, not `atop`: the silhouette comes from the thresholded
                blur, the colour comes from the gradients, and this is the
                operator that keeps one without letting the other overwrite
                it. */}
            <feComposite in="SourceGraphic" in2="goo" operator="in" />
          </filter>

          {/* One gradient per body rather than a flat fill: a flat fill makes
              the blob read as a sticker, and the highlight is what makes it
              read as a wet surface. */}
          <radialGradient id={`core-${uid}`} cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.95" />
            <stop offset="52%" stopColor="var(--accent-violet)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity="0.35" />
          </radialGradient>
          <radialGradient id={`edge-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-magenta)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--accent-magenta)" stopOpacity="0.2" />
          </radialGradient>
          <radialGradient id={`under-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-violet)" stopOpacity="0.75" />
            <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity="0.15" />
          </radialGradient>
        </defs>

        <g filter={`url(#${goo})`}>
          <circle className="liquid-blob-body liquid-blob-body--a" cx="200" cy="196" r="92" fill={`url(#core-${uid})`} />
          <circle className="liquid-blob-body liquid-blob-body--b" cx="126" cy="150" r="64" fill={`url(#edge-${uid})`} />
          <circle className="liquid-blob-body liquid-blob-body--c" cx="278" cy="164" r="58" fill={`url(#under-${uid})`} />
          <circle className="liquid-blob-body liquid-blob-body--d" cx="212" cy="288" r="70" fill={`url(#under-${uid})`} />
        </g>
      </svg>
    </div>
  );
}
