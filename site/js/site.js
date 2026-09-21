/* LiwaMusic landing site: motion and interaction. Requires GSAP + ScrollTrigger loaded before this file. */

(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

  /* Navigation: denser glass once the page scrolls. */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 40);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Horizontal accordion: hover on pointer devices, tap on touch. */
  var accordion = document.getElementById("accordion");
  if (accordion) {
    var slices = Array.prototype.slice.call(accordion.querySelectorAll(".slice"));
    var hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    function open(target) {
      slices.forEach(function (s) { s.classList.toggle("is-open", s === target); });
    }
    slices.forEach(function (s) {
      if (hoverable) s.addEventListener("mouseenter", function () { open(s); });
      s.addEventListener("click", function () { open(s); });
    });
  }

  /* Split the manifesto into words for the scrubbed reveal. */
  var scrub = document.getElementById("scrub");
  var words = [];
  if (scrub) {
    var text = scrub.textContent.trim().split(/\s+/);
    scrub.textContent = "";
    text.forEach(function (w) {
      var span = document.createElement("span");
      span.className = "sw";
      span.textContent = w;
      scrub.appendChild(span);
      words.push(span);
    });
  }

  if (!hasGsap || reduce) {
    words.forEach(function (w) { w.style.opacity = 1; });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* Hero entrance: words rise in sequence, then the screenshots settle. */
  var heroWords = gsap.utils.toArray(".hero-title .w");
  gsap.set(heroWords, { y: 40, opacity: 0 });
  gsap.set([".hero-lede", ".hero-actions"], { y: 24, opacity: 0 });
  gsap.set(".hero-shot", { y: 60, opacity: 0 });

  gsap.timeline({ defaults: { ease: "power3.out" } })
    .to(heroWords, { y: 0, opacity: 1, duration: 1, stagger: 0.06 }, 0.1)
    .to(".hero-lede", { y: 0, opacity: 1, duration: 0.9 }, 0.55)
    .to(".hero-actions", { y: 0, opacity: 1, duration: 0.9 }, 0.7)
    .to(".hero-shot", { y: 0, opacity: 1, duration: 1.4, stagger: 0.15, ease: "power4.out" }, 0.5);

  /* Ambient orbs drift with the scroll position. */
  gsap.to(".orb-a", { yPercent: 30, ease: "none", scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1.2 } });
  gsap.to(".orb-b", { yPercent: -40, ease: "none", scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1.2 } });

  /* Section headings and bento cards reveal as they enter. */
  gsap.utils.toArray(".section-head").forEach(function (el) {
    gsap.from(el.children, {
      y: 36, opacity: 0, duration: 1, stagger: 0.12, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 80%" }
    });
  });

  var cards = gsap.utils.toArray(".bento .card");
  if (cards.length) {
    gsap.from(cards, {
      y: 60, opacity: 0, duration: 1.1, stagger: 0.12, ease: "power3.out",
      scrollTrigger: { trigger: ".bento", start: "top 78%" }
    });
  }

  /* Pinned split: the title column holds while the feature list scrolls past. */
  gsap.matchMedia().add("(min-width: 1024px)", function () {
    ScrollTrigger.create({
      trigger: ".split-grid",
      start: "top 110px",
      end: "bottom bottom",
      pin: "#splitPin",
      pinSpacing: false,
      invalidateOnRefresh: true
    });
  });

  gsap.utils.toArray(".split-item").forEach(function (item) {
    gsap.from(item, {
      x: 40, opacity: 0, duration: 1, ease: "power3.out",
      scrollTrigger: { trigger: item, start: "top 85%" }
    });
  });

  /* Accordion and CTA reveal. */
  gsap.from(".accordion", { y: 50, opacity: 0, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: ".accordion", start: "top 80%" } });
  gsap.from(".cta-inner > *", { y: 30, opacity: 0, duration: 1, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: ".cta", start: "top 70%" } });

  /* Scrubbed text reveal: words brighten one after another as the reader scrolls. */
  if (words.length) {
    gsap.to(words, {
      opacity: 1, ease: "none", stagger: 0.08,
      scrollTrigger: { trigger: "#scrub", start: "top 78%", end: "bottom 45%", scrub: true }
    });
  }

  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();
