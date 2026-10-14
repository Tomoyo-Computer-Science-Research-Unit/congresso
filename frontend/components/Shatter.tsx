"use client";

import { useEffect } from "react";

/**
 * Tiros, como no tomoyo.systems: um clique deixa uma marca de bala onde acerta, um ponto
 * irregular furado no papel que some em alguns segundos, com um estampido abafado. A marca
 * (o mon e o wordmark) é blindada: o tiro ricocheteia com faíscas e um tinido metálico.
 * Só com mouse de verdade; campos de formulário ficam de fora.
 */

const SKIP = "input, textarea, select, iframe, [contenteditable], [download], .no-shatter, .scope";
const BRAND = "[data-brand]";
const HOLE_LIFE = 9000; // ms até a marca sumir
const MAX_HOLES = 48; // além disso, as mais antigas saem primeiro

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const holes: HTMLElement[] = [];
let audio: AudioContext | null = null;

function insideFixed(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") {
      return true;
    }
  }
  return false;
}

function layerFor(fixed: boolean): HTMLElement {
  const className = fixed ? "shatter-layer shatter-layer--fixed" : "shatter-layer";
  let layer = document.querySelector<HTMLElement>(`.${className.split(" ").join(".")}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = className;
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
}

function context(): AudioContext | null {
  try {
    audio ??= new AudioContext();
  } catch {
    return null;
  }
  if (audio.state === "suspended") {
    void audio.resume();
  }
  return audio;
}

/** Estampido abafado: um estalo de ruído que escurece ao decair, sobre um baque grave. */
function bang() {
  const ac = context();
  if (!ac) {
    return;
  }
  const t = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 0.09;
  out.connect(ac.destination);
  const length = Math.round(ac.sampleRate * 0.14);
  const noise = ac.createBuffer(1, length, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 3;
  }
  const crack = ac.createBufferSource();
  crack.buffer = noise;
  const lowpass = ac.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.value = 0.7;
  lowpass.frequency.setValueAtTime(rand(2600, 3600), t);
  lowpass.frequency.exponentialRampToValueAtTime(220, t + 0.14);
  crack.connect(lowpass).connect(out);
  crack.start(t);
  const thump = ac.createOscillator();
  const thumpGain = ac.createGain();
  thump.frequency.setValueAtTime(rand(130, 170), t);
  thump.frequency.exponentialRampToValueAtTime(45, t + 0.09);
  thumpGain.gain.setValueAtTime(0.7, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  thump.connect(thumpGain).connect(out);
  thump.start(t);
  thump.stop(t + 0.12);
}

/** Impacto: o estampido, um clarão curto e a marca, que some sozinha. */
function hole(target: Element, clientX: number, clientY: number) {
  bang();
  const fixed = insideFixed(target);
  const layer = layerFor(fixed);
  const x = clientX + (fixed ? 0 : scrollX);
  const y = clientY + (fixed ? 0 : scrollY);

  const flash = document.createElement("div");
  flash.className = "shatter-flash";
  Object.assign(flash.style, { left: `${x}px`, top: `${y}px` });
  layer.appendChild(flash);
  flash.animate(
    [
      { transform: "translate(-50%,-50%) scale(0)", opacity: 0.5 },
      { transform: "translate(-50%,-50%) scale(1)", opacity: 0 }
    ],
    { duration: 200, easing: "cubic-bezier(.2,.8,.3,1)" }
  ).onfinish = () => flash.remove();

  const mark = document.createElement("div");
  mark.className = "bullet-hole";
  const size = rand(6, 9);
  // Duas marcas nunca têm a mesma forma: raio torto e um giro ao acaso.
  const r = () => `${rand(42, 58).toFixed(0)}%`;
  Object.assign(mark.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${size.toFixed(1)}px`,
    height: `${(size * rand(0.85, 1.15)).toFixed(1)}px`,
    borderRadius: `${r()} ${r()} ${r()} ${r()} / ${r()} ${r()} ${r()} ${r()}`,
    rotate: `${rand(0, 360).toFixed(0)}deg`
  });
  layer.appendChild(mark);
  holes.push(mark);
  while (holes.length > MAX_HOLES) {
    holes.shift()?.remove();
  }
  mark.animate(
    [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.35 },
      { opacity: 0, offset: 1 }
    ],
    { duration: HOLE_LIFE, easing: "ease-in", fill: "forwards" }
  ).onfinish = () => {
    mark.remove();
    const index = holes.indexOf(mark);
    if (index >= 0) {
      holes.splice(index, 1);
    }
  };
}

/** Tinido metálico sintetizado: parciais inarmônicos sobre um estalo, e um assobio que cai. */
function ping() {
  const ac = context();
  if (!ac) {
    return;
  }
  const t = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 0.16;
  out.connect(ac.destination);
  const noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.03), ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length) ** 2;
  }
  const hit = ac.createBufferSource();
  hit.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3200;
  band.Q.value = 0.9;
  hit.connect(band).connect(out);
  hit.start(t);
  const base = rand(1700, 2500);
  for (const [ratio, gain, length] of [
    [1, 0.5, 0.55],
    [2.76, 0.28, 0.35],
    [5.4, 0.16, 0.2],
    [8.93, 0.08, 0.12]
  ]) {
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.frequency.value = base * ratio;
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
  const whine = ac.createOscillator();
  const whineGain = ac.createGain();
  whine.type = "triangle";
  whine.frequency.setValueAtTime(rand(3400, 4200), t + 0.02);
  whine.frequency.exponentialRampToValueAtTime(rand(700, 1000), t + 0.4);
  whineGain.gain.setValueAtTime(0.0001, t);
  whineGain.gain.linearRampToValueAtTime(0.12, t + 0.04);
  whineGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  whine.connect(whineGain).connect(out);
  whine.start(t);
  whine.stop(t + 0.45);
}

/** Ricochete na marca: faíscas, tinido e um tranco. */
function ricochet(target: Element, clientX: number, clientY: number) {
  ping();
  const fixed = insideFixed(target);
  const layer = layerFor(fixed);
  const x = clientX + (fixed ? 0 : scrollX);
  const y = clientY + (fixed ? 0 : scrollY);
  const base = rand(0, Math.PI * 2);
  for (let index = 0; index < 7; index += 1) {
    const spark = document.createElement("div");
    spark.className = "ricochet-spark";
    Object.assign(spark.style, { left: `${x}px`, top: `${y}px` });
    layer.appendChild(spark);
    const angle = base + (index / 7) * Math.PI * 2 + rand(-0.3, 0.3);
    const distance = rand(26, 64);
    const degrees = (angle * 180) / Math.PI;
    spark.animate(
      [
        { transform: `translate(-50%,-50%) rotate(${degrees}deg) translateX(4px) scaleX(1)`, opacity: 1 },
        { transform: `translate(-50%,-50%) rotate(${degrees}deg) translateX(${distance}px) scaleX(.3)`, opacity: 0 }
      ],
      { duration: rand(220, 360), easing: "cubic-bezier(.1,.7,.3,1)" }
    ).onfinish = () => spark.remove();
  }
  const box = target.getBoundingClientRect();
  const side = Math.sign(box.left + box.width / 2 - clientX) || 1;
  (target as HTMLElement).animate?.(
    [{ translate: "0 0" }, { translate: `${side * 3}px -1px` }, { translate: `${-side * 2}px 1px` }, { translate: `${side}px 0` }, { translate: "0 0" }],
    { duration: 220, easing: "ease-out" }
  );
}

export function Shatter() {
  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.detail === 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const start = event.target as Element | null;
      if (!start?.closest || start.closest(SKIP)) {
        return;
      }
      // Arrastar para selecionar texto não é tiro.
      if (!start.closest("a[href]") && !getSelection()?.isCollapsed) {
        return;
      }
      const brand = start.closest(BRAND);
      if (brand) {
        ricochet(brand, event.clientX, event.clientY);
        return;
      }
      hole(start, event.clientX, event.clientY);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
