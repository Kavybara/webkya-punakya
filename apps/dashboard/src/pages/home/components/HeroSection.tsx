import { motion, useReducedMotion } from "framer-motion";

/**
 * The first screen. All of it.
 *
 * It used to be a chip, a headline, a paragraph, two buttons, three assurance
 * pills, a strip of category links and three fanned product cards -- and then
 * the catalogue. All of that sat above the fold, so the first thing a visitor
 * saw was the site trying to prove it was a shop.
 *
 * What is left is what the brand actually is: the word, one sentence about
 * what it does, a way in through the navbar, and a background worth looking
 * at. The grid is one scroll away, which is where a grid belongs -- it is
 * evidence, and evidence is an argument made after the opening line rather
 * than instead of it.
 *
 * There is deliberately no scroll cue, no eyebrow and no second line. Each of
 * them was tried here and each cost the composition more than it gave: a cue
 * is a promise the first screen has no room to keep, and an eyebrow is a
 * second thing to read before the one that matters.
 *
 * The aurora is not in this file. It is the page root's `::before` and
 * `::after` (see index.css), so it runs the full height of the document
 * rather than being a prop sitting behind one section.
 */

const enter = {
  hidden: { opacity: 0, y: 26 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const } },
};

export function HeroSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section
      id="beranda"
      // `100svh` rather than `100vh`: on a phone the browser's own chrome
      // takes the bottom of the viewport, and `vh` is measured with it hidden,
      // so the wordmark ends up underneath the URL bar.
      className="home-hero"
    >
      <motion.div
        initial={reduceMotion ? false : "hidden"}
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.14, delayChildren: 0.1 } } }}
        className="home-hero-centre"
      >
        <motion.h1 variants={enter} className="home-hero-title">
          KAVYA
        </motion.h1>

        <motion.p variants={enter} className="home-hero-lede">
          Supplying all premium apps you need.
        </motion.p>
      </motion.div>
    </section>
  );
}
