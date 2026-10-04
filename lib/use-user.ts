'use client';
import {useEffect, useState} from 'react';

export type UserProfile = {
  id: string;
  email: string;
  fullName: string;
  currencySymbol: string;
  monthlyIncome: number;
  budgetRollover?: boolean;
};

let cache: UserProfile | null = null;
const listeners = new Set<(user: UserProfile) => void>();

export async function loadUser(): Promise<UserProfile> {
  const res = await fetch('/api/user');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load profile');
  const user = data.user as UserProfile;
  cache = user;
  listeners.forEach((fn) => fn(user));
  return user;
}

export function useUser() {
  const [user, setUser] = useState<UserProfile | null>(cache);
  useEffect(() => {
    if (!cache) loadUser().catch(() => {});
    const fn = (next: UserProfile) => setUser(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return user;
}

export {formatMoney} from '@/lib/money';
