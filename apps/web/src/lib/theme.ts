import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

/** Tema actual (oscuro por defecto), persistido por usuario en este navegador. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a1526' : '#eef1f4');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

/** Colores de gráficos legibles en ambos temas. */
export const CHART = {
  income: '#10b981',
  incomeSoft: 'rgba(16,185,129,0.4)',
  expense: '#f2765b',
  expenseSoft: 'rgba(242,118,91,0.4)',
  accent: '#d4af37',
  navy: '#3b6fd8',
  grid: 'rgba(139,156,183,0.18)',
  axis: 'var(--color-slate-500)',
};

export const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-slate-200)',
    borderRadius: 10,
    color: 'var(--color-slate-900)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  },
  labelStyle: { color: 'var(--color-slate-900)', fontWeight: 600 },
  itemStyle: { color: 'var(--color-slate-700)' },
  cursor: { fill: 'rgba(139,156,183,0.08)' },
};
