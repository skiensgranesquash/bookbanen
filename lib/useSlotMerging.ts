"use client";

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SLOT_LENGTH_MINUTES } from "@/lib/config";

/**
 * Delt mellom BookingCalendar.tsx (offentlig side) og BookingsInsights.tsx
 * (admins manuelle slot-rutenett) – begge rutenettene skal visuelt FLYTE
 * SAMMEN til én sammenhengende "blokk" (ingen kant/hjørne mellom dem) når to
 * påfølgende halvtimer deler akkurat samme visuelle tilstand – enten fordi de
 * begge er en del av din VALGTE (eller forhåndsviste, ved hover) hele time,
 * eller fordi de begge er FYSISK opptatt av en ekte booking (en 1- eller
 * flertimers booking dekker flere halvtimer, som da skal se ut som ÉN
 * sammenhengende rød blokk i stedet for flere enkeltceller etter hverandre).
 *
 * "normal" (ledig, grønn) slås ALDRI sammen – det ville sett ut som om flere
 * uavhengige valgbare tider er tvunget sammen til én, noe de ikke er.
 * "pending" (lyseblå, kun på den offentlige bookingsiden) slås heller ikke
 * sammen – det er alltid akkurat ÉN halvtime som venter på at kunden skal
 * velge 30 min eller 1 time, se BookingCalendar.tsx.
 */
export type SlotVisualState = "selected" | "hover" | "booked" | "blocked" | "pending" | "normal";

export interface MergeableSlot {
  /** ISO-8601 starttidspunkt. */
  startTime: string;
  /** Unik nøkkel innenfor rutenettet (vanligvis samme som startTime eller slot.label). */
  key: string;
}

interface SlotMergeBridge {
  key: string;
  state: SlotVisualState;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SlotMergeResult {
  /** Settes som ref på selve rutenett-containeren (må være `position: relative`). */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Settes som ref-callback på HVER slot-knapp, nøkkelet med samme `key` som i input-arrayet. */
  registerButtonRef: (key: string) => (el: HTMLButtonElement | null) => void;
  mergeLeft: (key: string) => boolean;
  mergeRight: (key: string) => boolean;
  /** Usynlige "bro"-rektangler som tegnes over mellomrommet mellom to sammenslåtte celler, i samme farge som tilstanden deres. */
  bridges: SlotMergeBridge[];
}

/**
 * Regner ut hvilke par av påfølgende rutenett-slots som skal se ut som ÉN
 * sammenhengende blokk, og måler (via faktiske DOM-posisjoner – CSS-rutenett
 * sitt `gap` kan ikke overstyres per par) nøyaktig hvor stort mellomrommet
 * mellom dem er, slik at en "bro" kan dekke det. Slår ALDRI sammen to celler
 * som har havnet på hver sin rad i det responsive rutenettet (sjekkes via
 * `getBoundingClientRect().top`), og ALDRI to celler som ikke faktisk er
 * nabo-halvtimer i tid (viktig den dagen et rutenett kan ha hull, f.eks. en
 * lunsjpause mellom to åpningstidsintervaller).
 */
export function useSlotMerging<T extends MergeableSlot>(
  slots: T[],
  stateFor: (slot: T, index: number) => SlotVisualState,
  extraDeps: unknown[]
): SlotMergeResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [bridges, setBridges] = useState<SlotMergeBridge[]>([]);
  const [mergeLeftSet, setMergeLeftSet] = useState<Set<string>>(new Set());
  const [mergeRightSet, setMergeRightSet] = useState<Set<string>>(new Set());

  const registerButtonRef = useMemo(
    () =>
      (key: string) =>
      (el: HTMLButtonElement | null) => {
        if (el) buttonRefs.current.set(key, el);
        else buttonRefs.current.delete(key);
      },
    []
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const nextBridges: SlotMergeBridge[] = [];
      const nextLeft = new Set<string>();
      const nextRight = new Set<string>();
      const slotMs = SLOT_LENGTH_MINUTES * 60_000;

      for (let i = 0; i < slots.length - 1; i++) {
        const a = slots[i];
        const b = slots[i + 1];
        const stateA = stateFor(a, i);
        const stateB = stateFor(b, i + 1);
        if (stateA === "normal" || stateA !== stateB) continue;
        if (new Date(b.startTime).getTime() - new Date(a.startTime).getTime() !== slotMs) continue;

        const elA = buttonRefs.current.get(a.key);
        const elB = buttonRefs.current.get(b.key);
        if (!elA || !elB) continue;
        const rectA = elA.getBoundingClientRect();
        const rectB = elB.getBoundingClientRect();
        if (Math.abs(rectA.top - rectB.top) > 1) continue; // ulike rader – ikke slå sammen
        if (rectB.left <= rectA.left) continue;

        nextRight.add(a.key);
        nextLeft.add(b.key);
        nextBridges.push({
          key: `${a.key}__${b.key}`,
          state: stateA,
          left: rectA.right - containerRect.left,
          top: rectA.top - containerRect.top,
          width: Math.max(0, rectB.left - rectA.right),
          height: rectA.height,
        });
      }

      setBridges(nextBridges);
      setMergeLeftSet(nextLeft);
      setMergeRightSet(nextRight);
    }

    measure();

    const container = containerRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && container) ro.observe(container);
    window.addEventListener("resize", measure);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
    // Målingen avhenger av selve layouten (slots) og av alt som endrer en
    // celles state (valgt/hover/osv, gitt via extraDeps av kalleren).
  }, [slots, ...extraDeps]);

  return {
    containerRef,
    registerButtonRef,
    mergeLeft: (key) => mergeLeftSet.has(key),
    mergeRight: (key) => mergeRightSet.has(key),
    bridges,
  };
}
