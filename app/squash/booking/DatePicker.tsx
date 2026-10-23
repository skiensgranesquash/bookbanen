"use client";

import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { nb } from "date-fns/locale";
import styles from "./booking.module.css";

const WEEKDAY_LABELS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

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
 * Enkel, avhengighetsfri måneds-kalender (bruker kun date-fns, som allerede
 * er en avhengighet) – erstatter den native <input type="date"> slik at
 * brukeren ser en ordentlig kalender å velge dato fra.
 */
export default function DatePicker({ value, onChange, minDate, maxDate }: DatePickerProps) {
  const selected = parseDateOnly(value);
  const min = parseDateOnly(minDate);
  const max = maxDate ? parseDateOnly(maxDate) : undefined;

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected));

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const canGoPrev = isAfter(startOfMonth(viewMonth), startOfMonth(min));
  const canGoNext = !max || isBefore(startOfMonth(viewMonth), startOfMonth(max));

  return (
    <div className={styles.datePicker}>
      <div className={styles.datePickerHeader}>
        <button
          type="button"
          className={styles.datePickerNav}
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          disabled={!canGoPrev}
          aria-label="Forrige måned"
        >
          ‹
        </button>
        <span className={styles.datePickerTitle}>{format(viewMonth, "MMMM yyyy", { locale: nb })}</span>
        <button
          type="button"
          className={styles.datePickerNav}
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          disabled={!canGoNext}
          aria-label="Neste måned"
        >
          ›
        </button>
      </div>

      <div className={styles.datePickerWeekdays}>
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className={styles.datePickerGrid}>
        {days.map((day) => {
          const dateStr = toDateString(day);
          const outsideMonth = !isSameMonth(day, viewMonth);
          const disabled = isBefore(day, min) || (max ? isAfter(day, max) : false);
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, today);

          const classNames = [styles.datePickerDay];
          if (outsideMonth) classNames.push(styles.datePickerDayOutside);
          if (isSelected) classNames.push(styles.datePickerDaySelected);
          if (isToday && !isSelected) classNames.push(styles.datePickerDayToday);

          return (
            <button
              key={dateStr}
              type="button"
              className={classNames.join(" ")}
              disabled={disabled}
              onClick={() => onChange(dateStr)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
