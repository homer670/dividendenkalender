// Hooks shared by the screens

import { useEffect, useMemo, useState } from 'react';

import { Client } from '../core/model';
import { LastX, ReportingPeriod } from '../core/snapshot/reportingPeriod';
import { today } from '../core/util/dates';
import { Interval } from '../core/util/interval';
import { CalcContext } from '../state/calc';
import { ClientFilterItem } from '../state/clientFilters';
import { usePortfolio } from '../state/portfolio';
import { updateSettings, useSettings, settingsStore } from '../state/settings';

/** calculation context of the opened file (screens are only reachable while a file is open) */
export function useContextOrNull(): CalcContext | null {
  return usePortfolio((s) => (s.status === 'ready' ? s.context : null));
}

export interface Computed<T> {
  value: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Runs a (possibly expensive) calculation after the first render so that navigation
 * transitions stay responsive.
 */
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

/** identity based key of a dependency list */
function depsKey(deps: unknown[]): string {
  return deps
    .map((d) => {
      if ((typeof d === 'object' && d !== null) || typeof d === 'function') {
        let id = objectIds.get(d as object);
        if (id === undefined) objectIds.set(d as object, (id = nextObjectId++));
        return `#${id}`;
      }
      return `${typeof d}:${String(d)}`;
    })
    .join('|');
}

export function useComputed<T>(fn: () => T, deps: unknown[]): Computed<T> {
  // a new token for every change of the dependencies
  const key = depsKey(deps);
  const token = useMemo(() => ({ key }), [key]);
  const [state, setState] = useState<{ token: object | null; value: T | null; error: Error | null }>({ token: null, value: null, error: null });
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      try {
        const value = fn();
        if (!cancelled) setState({ token, value, error: null });
      } catch (e) {
        if (!cancelled) setState({ token, value: null, error: e instanceof Error ? e : new Error(String(e)) });
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const loading = state.token !== token;
  return { value: state.value, error: loading ? null : state.error, loading };
}

export interface PeriodSelection {
  period: ReportingPeriod;
  interval: Interval;
  periods: ReportingPeriod[];
  setPeriod: (p: ReportingPeriod) => void;
}

/** reporting period of a view (persisted per view) */
export function usePeriod(viewKey: string, ctx: CalcContext | null): PeriodSelection {
  const settings = useSettings();
  const code = settings.periods[viewKey];
  return useMemo(() => {
    const periods = ctx ? ctx.reportingPeriods() : [new LastX(1, 0)];
    const stored = code ? ReportingPeriod.tryFrom(code) : null;
    const period = stored ?? periods[0];
    const all = stored && !periods.some((p) => p.equals(stored)) ? [...periods, stored] : periods;
    return {
      period,
      interval: period.toInterval(today()),
      periods: all,
      setPeriod: (p: ReportingPeriod) =>
        updateSettings({ periods: { ...settingsStore.get().periods, [viewKey]: p.getCode() } }),
    };
  }, [ctx, code, viewKey]);
}

export interface FilterSelection {
  item: ClientFilterItem;
  items: ClientFilterItem[];
  client: Client;
  setFilter: (id: string) => void;
}

/** client filter of a view (persisted per view) */
export function useClientFilter(viewKey: string, ctx: CalcContext): FilterSelection {
  const settings = useSettings();
  const id = settings.filters[viewKey] ?? '';
  return useMemo(() => {
    const item = ctx.filterItem(id);
    return {
      item,
      items: ctx.filterItems,
      client: ctx.filteredClient(item.id),
      setFilter: (newId: string) => updateSettings({ filters: { ...settingsStore.get().filters, [viewKey]: newId } }),
    };
  }, [ctx, id, viewKey]);
}
