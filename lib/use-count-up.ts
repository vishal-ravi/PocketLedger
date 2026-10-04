'use client';
import {useEffect, useRef, useState} from 'react';
import {formatMoney} from '@/lib/money';

export function useCountUp(target: number, duration = 950) {
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const safeTarget = Number.isFinite(target) ? target : 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(safeTarget * eased);
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration]);

  return value;
}

export const inr = (value: number, symbol = '₹') => formatMoney(value, symbol);
