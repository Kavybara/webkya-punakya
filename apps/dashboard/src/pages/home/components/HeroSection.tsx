import { Link } from "react-router-dom";

/**
 * The first screen, and the last.
 *
 * A word, a sentence, and a way in. There is no scroll cue because there is
 * nothing to scroll to -- the price list is one click away, and a cue pointing
 * at a page footer is a cue pointing at nothing.
 *
 * `100svh` rather than `100vh`: on a phone the browser's own chrome takes the
 * bottom of the viewport, and `vh` is measured with it hidden, so the wordmark
 * ends up underneath the URL bar.
 */
export function HeroSection() {
  return (
    <section className="home-hero">
      <div className="home-hero-centre">
        <h1 className="home-hero-title">KAVYA</h1>
        <p className="home-hero-lede">Supplying all premium apps you need.</p>
        <Link to="/register" className="home-hero-cta">
          Daftar Reseller
        </Link>
      </div>
    </section>
  );
}
