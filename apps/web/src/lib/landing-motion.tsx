"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/** Scroll-triggered landing choreography — respects reduced motion. */
export function LandingMotion() {
  const enabled = useRef(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const ctx = gsap.context(() => {
      gsap.from(".hero-copy > *", {
        y: 28,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: "power3.out",
      });

      gsap.from(".hero-console-mock", {
        y: 40,
        opacity: 0,
        scale: 0.96,
        duration: 0.9,
        delay: 0.15,
        ease: "power3.out",
      });

      gsap.from(".chip-float", {
        y: 16,
        opacity: 0,
        duration: 0.55,
        stagger: 0.12,
        delay: 0.45,
        ease: "back.out(1.4)",
      });

      gsap.utils.toArray<HTMLElement>(".metric-card").forEach((el, i) => {
        gsap.from(el, {
          scrollTrigger: { trigger: el, start: "top 88%" },
          y: 24,
          opacity: 0,
          duration: 0.5,
          delay: i * 0.06,
          ease: "power2.out",
        });
      });

      gsap.utils.toArray<HTMLElement>(".pane-block").forEach((el, i) => {
        gsap.from(el.querySelectorAll(".pane-copy > *, .pane-visual"), {
          scrollTrigger: { trigger: el, start: "top 82%" },
          y: 28,
          opacity: 0,
          duration: 0.55,
          stagger: 0.06,
          delay: (i % 2) * 0.04,
          ease: "power2.out",
        });
      });

      gsap.utils.toArray<HTMLElement>(".product-frame").forEach((el, i) => {
        gsap.from(el, {
          scrollTrigger: { trigger: el, start: "top 85%" },
          y: 32,
          opacity: 0,
          duration: 0.6,
          delay: i * 0.1,
          ease: "power2.out",
        });
      });

      gsap.from(".cta-action-card", {
        scrollTrigger: { trigger: ".cta-band", start: "top 85%" },
        y: 20,
        opacity: 0,
        duration: 0.55,
        stagger: 0.08,
        ease: "power2.out",
      });

      gsap.from(".cta-lockup", {
        scrollTrigger: { trigger: ".cta-band", start: "top 85%" },
        y: 16,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out",
      });

      gsap.from(".home-interstitial-inner > *", {
        scrollTrigger: { trigger: ".home-interstitial", start: "top 82%" },
        y: 24,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out",
      });

      gsap.from(".home-float-token", {
        scrollTrigger: { trigger: ".metrics-band", start: "top 90%" },
        scale: 0.7,
        opacity: 0,
        duration: 0.7,
        ease: "back.out(1.5)",
      });

      gsap.utils.toArray<HTMLElement>(".hero-meta b").forEach((el) => {
        const target = el.textContent ?? "";
        const obj = { val: 0 };
        gsap.to(obj, {
          scrollTrigger: { trigger: el, start: "top 95%" },
          val: 1,
          duration: 0.01,
          onComplete: () => {
            el.textContent = target;
          },
        });
      });
    });

    return () => ctx.revert();
  }, []);

  return enabled.current ? null : null;
}
