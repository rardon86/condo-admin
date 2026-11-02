import { useQuery } from '@tanstack/react-query';
import { get } from './api';

export interface CatalogItem { id: string; catalog: string; code: string; name: string; sortOrder: number; active: boolean }
export interface Catalog { key: 'PROPERTY_TYPE' | 'NEWS_CATEGORY'; label: string; items: CatalogItem[] }

/** Catálogos del proyecto (tipos de propiedad, categorías de avisos…). */
export function useCatalogs() {
  return useQuery({ queryKey: ['catalogs'], queryFn: () => get<Catalog[]>('/catalogs'), staleTime: 60_000 });
}

/** Opciones activas de un catálogo y un traductor código → nombre (incluye inactivos para registros viejos). */
export function useCatalog(key: Catalog['key']) {
  const q = useCatalogs();
  const items = q.data?.find((c) => c.key === key)?.items ?? [];
  const names = Object.fromEntries(items.map((i) => [i.code, i.name]));
  return { options: items.filter((i) => i.active), label: (code: string) => names[code] ?? code, isLoading: q.isLoading };
}
