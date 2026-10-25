"use client";

import { useState } from "react";
import { addDays, format, isAfter, isBefore, isSameDay } from "date-fns";
import { nb } from "date-fns/locale";
import styles from "./booking.module.css";

/** Indeks 0 = søndag, ..., 6 = lørdag – slik Date.prototype.getDay() returnerer. */
const WEEKDAY_SHORT = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];

/** Tolker en "YYYY-MM-DD"-streng som en lokal (nettleser-tidssone) dato – kun brukt til visning/navigasjon i selve kalenderen. */
function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface DatePickerProps {
  value: string;
  onChange: (dateStr: string) => void;
  minDate: string;
  maxDate?: string;
}

/**
 * Antall dager synlig i stripen samtidig. Ved enkeltbooking (maxDate satt)
 * tilsvarer dette nøyaktig hele det bookbare vinduet (i dag + MAX_DAYS_AHEAD
 * dager, se lib/config.ts), så det blir aldri noe å bla gjennom der. Ved
 * gjentakende booking (maxDate er undefined – startdatoen er ubegrenset) kan
 * man bla videre fremover, side for side.
 */
const WINDOW_SIZE = 15;

/**
 * Kompakt, horisontalt scrollbar dato-stripe – erstatter den tidligere
 * månedskalenderen. Siden en enkelttime uansett bare kan bookes innenfor et
 * vindu på MAX_DAYS_AHEAD dager, er det ingen vits i å vise en hel måned med
 * for det meste irrelevante/passerte datoer: stripen viser nøyaktig det
 * bookbare vinduet – ingen dager før minDate, ingen "utenfor måneden"-fylling.
 */
export default function DatePicker({ value, onChange, minDate, maxDate }: DatePickerProps) {
  const selected = parseDateOnly(value);
  const min = parseDateOnly(minDate);
  const max = maxDate ? parseDateOnly(maxDate) : undefined;

  const [pageOffset, setPageOffset] = useState(0);

  const windowStart = addDays(min, pageOffset * WINDOW_SIZE);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < WINDOW_SIZE; i++) {
    const day = addDays(windowStart, i);
    if (max && isAfter(day, max)) break;
    days.push(day);
  }

  const canGoPrev = pageOffset > 0;
  const lastVisibleDay = days[days.length - 1];
  const canGoNext = !max ? true : !!lastVisibleDay && isBefore(lastVisibleDay, max);

  // Tittel over stripen: måneden(e) de synlige dagene tilhører – "oktober",
  // eller "oktober–november" når vinduet strekker seg over et månedsskifte.
  const firstMonthLabel = format(windowStart, "MMMM", { locale: nb });
  const lastMonthLabel = lastVisibleDay ? format(lastVisibleDay, "MMMM", { locale: nb }) : firstMonthLabel;
  const title = firstMonthLabel === lastMonthLabel ? firstMonthLabel : `${firstMonthLabel}–${lastMonthLabel}`;

  return (
    <div className={styles.datePicker}>
      {(canGoPrev || canGoNext) && (
        <div className={styles.datePickerHeader}>
          <button
            type="button"
            className={styles.datePickerNav}
            onClick={() => setPageOffset((p) => Math.max(0, p - 1))}
            disabled={!canGoPrev}
            aria-label="Forrige periode"
          >
            ‹
          </button>
          <span className={styles.datePickerTitle}>{title}</span>
          <button
            type="button"
            className={styles.datePickerNav}
            onClick={() => setPageOffset((p) => p + 1)}
            disabled={!canGoNext}
            aria-label="Neste periode"
          >
            ›
          </button>
        </div>
      )}

      <div className={styles.datePickerStrip}>
        {days.map((day) => {
          const dateStr = toDateString(day);
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, today);

          const classNames = [styles.datePickerDay];
          if (isSelected) classNames.push(styles.datePickerDaySelected);
          if (isToday && !isSelected) classNames.push(styles.datePickerDayToday);

          return (
            <button key={dateStr} type="button" className={classNames.join(" ")} onClick={() => onChange(dateStr)}>
              <span className={styles.datePickerDayWeekday}>{WEEKDAY_SHORT[day.getDay()]}</span>
              <span className={styles.datePickerDayNumber}>{day.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
