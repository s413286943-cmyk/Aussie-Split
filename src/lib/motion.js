import gsap from "gsap";

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function withMotion(scopeRef, setup) {
  if (!scopeRef.current || prefersReducedMotion()) return undefined;

  let setupCleanup;
  const context = gsap.context(() => {
    setupCleanup = setup(gsap);
  }, scopeRef);

  return () => {
    setupCleanup?.();
    context.revert();
  };
}

export function revealPage(scopeRef, groups) {
  return withMotion(scopeRef, (motion) => {
    const timeline = motion.timeline({ defaults: { duration: 0.52, ease: "power2.out" } });

    groups.forEach((group, index) => {
      const targets = scopeRef.current.querySelectorAll(group.selector);
      if (!targets.length) return;

      timeline.from(
        targets,
        {
          autoAlpha: 0,
          y: group.y ?? 18,
          scale: group.scale ?? 1,
          stagger: group.stagger ?? 0.06,
          clearProps: "opacity,visibility,transform",
        },
        index === 0 ? 0 : "<0.12",
      );
    });
  });
}

export function revealOnScroll(scopeRef, selector) {
  return withMotion(scopeRef, (motion) => {
    const items = Array.from(scopeRef.current.querySelectorAll(selector));
    const tweens = [];
    const observers = items.map((item) => {
      motion.set(item, { autoAlpha: 0, y: 18 });
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          tweens.push(
            motion.to(item, {
              autoAlpha: 1,
              y: 0,
              duration: 0.5,
              ease: "power2.out",
              clearProps: "opacity,visibility,transform",
            }),
          );
          observer.disconnect();
        },
        { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
      );
      observer.observe(item);
      return observer;
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
      tweens.forEach((tween) => tween.kill());
    };
  });
}

export function pulseElement(element) {
  if (!element || prefersReducedMotion()) return;

  return gsap.fromTo(
    element,
    { boxShadow: "0 0 0 0 rgba(20, 125, 114, 0.28)" },
    { boxShadow: "0 0 0 10px rgba(20, 125, 114, 0)", duration: 0.72, ease: "power2.out", clearProps: "boxShadow" },
  );
}