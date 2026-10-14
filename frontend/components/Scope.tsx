"use client";

import { useEffect, useRef } from "react";

const LOCK_TARGETS = "a, button, [role='button'], [role='option'], select, input, label, summary";

/**
 * Mira no lugar do cursor, como no tomoyo.systems: o retículo segue o ponteiro, a moldura
 * trava sobre alvos clicáveis e o cruzamento dá um coice ao disparar. Só com mouse de verdade.
 */
export function Scope() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = ref.current;
    if (!scope || !matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }
    const root = document.documentElement;
    const ring = scope.querySelector<SVGElement>(".scope__ring");
    const cross = scope.querySelector<SVGElement>(".scope__cross");
    if (!ring || !cross) {
      return;
    }
    root.classList.add("has-scope");

    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let locked: Element | null = null;
    let animating = false;

    function settle() {
      let targetX = x;
      let targetY = y;
      if (locked) {
        const box = locked.getBoundingClientRect();
        targetX = x + (box.left + box.width / 2 - x) * 0.35;
        targetY = y + (box.top + box.height / 2 - y) * 0.35;
      }
      ringX += (targetX - ringX) * 0.2;
      ringY += (targetY - ringY) * 0.2;
      ring!.style.transform = `translate(${ringX}px, ${ringY}px)`;
      if (Math.abs(targetX - ringX) + Math.abs(targetY - ringY) > 0.3) {
        requestAnimationFrame(settle);
      } else {
        animating = false;
      }
    }
    function nudge() {
      if (!animating) {
        animating = true;
        requestAnimationFrame(settle);
      }
    }
    // Arrastáveis: sliders e a região da barra de rolagem de um painel. Sobre eles a mira some e
    // entra a mão aberta; ao segurar, a mão fechada (os mesmos cursores do tomoyo.systems).
    function grabbable(event: PointerEvent): boolean {
      const element = event.target as Element | null;
      if (!element) {
        return false;
      }
      if (element.closest("input[type='range'], .grabbable")) {
        return true;
      }
      const box = element.getBoundingClientRect();
      const insideScrollbar =
        (element.scrollHeight > element.clientHeight && event.clientX - box.left > element.clientWidth) ||
        (element.scrollWidth > element.clientWidth && event.clientY - box.top > element.clientHeight);
      return Boolean(element.clientWidth) && insideScrollbar;
    }
    let grabbing = false;
    function onMove(event: PointerEvent) {
      x = event.clientX;
      y = event.clientY;
      scope!.classList.add("is-live");
      cross!.style.transform = `translate(${x}px, ${y}px)`;
      const target = (event.target as Element | null)?.closest?.(LOCK_TARGETS) ?? null;
      if (target !== locked) {
        locked = target;
        scope!.classList.toggle("is-lock", Boolean(target));
      }
      if (!grabbing) {
        root.classList.toggle("is-grab", grabbable(event));
      }
      nudge();
    }
    function onGrabStart(event: PointerEvent) {
      if (event.button === 0 && grabbable(event)) {
        grabbing = true;
        root.classList.remove("is-grab");
        root.classList.add("is-grabbing");
      }
    }
    function onGrabEnd() {
      if (grabbing) {
        grabbing = false;
        root.classList.remove("is-grabbing");
      }
    }
    function onLeave() {
      scope!.classList.remove("is-live");
    }
    function onDown() {
      scope!.classList.remove("is-fire");
      void scope!.offsetWidth;
      scope!.classList.add("is-fire");
    }
    // Menus nativos de <select> não desenham por cima da mira: devolve o cursor enquanto abertos.
    function onFocusIn(event: FocusEvent) {
      if ((event.target as Element | null)?.tagName === "SELECT") {
        root.classList.add("scope-off");
      }
    }
    function onFocusOut(event: FocusEvent) {
      if ((event.target as Element | null)?.tagName === "SELECT") {
        root.classList.remove("scope-off");
      }
    }

    addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    addEventListener("pointerdown", onDown);
    addEventListener("pointerdown", onGrabStart, true);
    addEventListener("pointerup", onGrabEnd, true);
    addEventListener("pointercancel", onGrabEnd, true);
    addEventListener("scroll", nudge, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      root.classList.remove("has-scope", "scope-off", "is-grab", "is-grabbing");
      removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerdown", onGrabStart, true);
      removeEventListener("pointerup", onGrabEnd, true);
      removeEventListener("pointercancel", onGrabEnd, true);
      removeEventListener("scroll", nudge);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div ref={ref} className="scope" aria-hidden="true">
      <svg className="scope__ring" viewBox="-60 -60 120 120">
        <circle r="34" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <g className="scope__ticks" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="-44" x2="0" y2="-38" />
          <line x1="0" y1="38" x2="0" y2="44" />
          <line x1="-44" y1="0" x2="-38" y2="0" />
          <line x1="38" y1="0" x2="44" y2="0" />
          <circle r="44" fill="none" strokeWidth=".8" strokeDasharray="2 6" />
        </g>
        <g className="scope__lock" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M-30 -18V-30H-18" />
          <path d="M18 -30H30V-18" />
          <path d="M30 18V30H18" />
          <path d="M-18 30H-30V18" />
        </g>
      </svg>
      <svg className="scope__cross" viewBox="-60 -60 120 120">
        <g className="scope__fire">
          <g stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="-22" x2="0" y2="-7" />
            <line x1="0" y1="7" x2="0" y2="22" />
            <line x1="-22" y1="0" x2="-7" y2="0" />
            <line x1="7" y1="0" x2="22" y2="0" />
          </g>
          <circle r="1.8" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}
