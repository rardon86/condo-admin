import { BadRequestException, Body, ConflictException, Controller, Get, Global, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, Db, Tx } from '../../db/client';
import { catalogItems } from '../../db/schema';

/** Catálogos editables por proyecto. Las columnas que los usan guardan el `code`. */
export const CATALOGS = {
  PROPERTY_TYPE: 'Tipos de propiedad',
  NEWS_CATEGORY: 'Categorías de avisos',
} as const;
export type CatalogKey = keyof typeof CATALOGS;

/** Valores iniciales de cada proyecto (los mismos que inserta la migración 0003). */
export const DEFAULT_CATALOG_ITEMS: { catalog: CatalogKey; code: string; name: string }[] = [
  { catalog: 'PROPERTY_TYPE', code: 'HOUSE', name: 'Casa' },
  { catalog: 'PROPERTY_TYPE', code: 'APARTMENT', name: 'Apartamento' },
  { catalog: 'PROPERTY_TYPE', code: 'LOT', name: 'Lote' },
  { catalog: 'PROPERTY_TYPE', code: 'COMMERCIAL', name: 'Local comercial' },
  { catalog: 'PROPERTY_TYPE', code: 'OTHER', name: 'Otro' },
  { catalog: 'NEWS_CATEGORY', code: 'AVISO', name: 'Aviso' },
  { catalog: 'NEWS_CATEGORY', code: 'MANTENIMIENTO', name: 'Mantenimiento' },
  { catalog: 'NEWS_CATEGORY', code: 'ASAMBLEA', name: 'Asamblea' },
  { catalog: 'NEWS_CATEGORY', code: 'SEGURIDAD', name: 'Seguridad' },
  { catalog: 'NEWS_CATEGORY', code: 'EVENTO', name: 'Evento' },
  { catalog: 'NEWS_CATEGORY', code: 'FINANZAS', name: 'Finanzas' },
];

const zCatalog = z.enum(Object.keys(CATALOGS) as [CatalogKey, ...CatalogKey[]]);
const itemSchema = z.object({
  catalog: zCatalog,
  code: z.string().trim().min(1).max(30).regex(/^[A-Z0-9_]+$/i, 'Código: solo letras, números y guion bajo').transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

@Injectable()
export class CatalogsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async seed(complexId: string, tx: Tx = this.db) {
    await tx
      .insert(catalogItems)
      .values(DEFAULT_CATALOG_ITEMS.map((x) => ({ ...x, complexId, sortOrder: DEFAULT_CATALOG_ITEMS.filter((y) => y.catalog === x.catalog).indexOf(x) + 1 })))
      .onConflictDoNothing();
  }

  /** Valida que el código exista y esté activo en el catálogo del proyecto. */
  async assert(complexId: string, catalog: CatalogKey, code: string, tx: Tx = this.db) {
    const [x] = await tx
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(and(eq(catalogItems.complexId, complexId), eq(catalogItems.catalog, catalog), eq(catalogItems.code, code), eq(catalogItems.active, true)));
    if (!x) throw new BadRequestException(`Valor no válido para ${CATALOGS[catalog].toLowerCase()}`);
  }
}

@Controller('catalogs')
export class CatalogsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Todos los catálogos del proyecto (lectura para cualquier usuario del proyecto, incluidos propietarios). */
  @Get()
  @Roles(...ROLES.INTERNAL, 'RESIDENT')
  async list(@Tenant() t: TenantCtx) {
    const rows = await this.db.select().from(catalogItems).where(eq(catalogItems.complexId, t.complexId)).orderBy(asc(catalogItems.catalog), asc(catalogItems.sortOrder), asc(catalogItems.name));
    return Object.entries(CATALOGS).map(([key, label]) => ({ key, label, items: rows.filter((r) => r.catalog === key) }));
  }

  @Post()
  @Roles(...ROLES.MANAGE)
  async create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(itemSchema)) b: z.infer<typeof itemSchema>) {
    const [row] = await this.db.insert(catalogItems).values({ ...b, complexId: t.complexId }).onConflictDoNothing().returning();
    if (!row) throw new ConflictException('Ese código ya existe en el catálogo');
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'CREATE', entity: 'catalog_item', entityId: row.id, data: b });
    return row;
  }

  /** El código no cambia (lo referencian los registros); se puede renombrar, ordenar o desactivar. */
  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(itemUpdateSchema)) b: z.infer<typeof itemUpdateSchema>) {
    const [row] = await this.db
      .update(catalogItems)
      .set({ ...b, updatedAt: new Date() })
      .where(and(eq(catalogItems.id, id), eq(catalogItems.complexId, t.complexId)))
      .returning();
    if (!row) throw new NotFoundException();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE', entity: 'catalog_item', entityId: id, data: b });
    return row;
  }
}

@Global()
@Module({ controllers: [CatalogsController], providers: [CatalogsService], exports: [CatalogsService] })
export class CatalogsModule {}
