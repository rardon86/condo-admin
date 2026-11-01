import { Body, Controller, Delete, Get, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { zDate, ZodPipe, zUuid } from '../../common/zod.pipe';
import { zonedStartOfDay } from '../../common/dates';
import { DB, Db } from '../../db/client';
import { complexes, employeeAssignments, employees, geofences, timeEntries } from '../../db/schema';
import { AttendanceService, clockSchema } from './attendance.service';


const fenceSchema = z.object({
  name: z.string().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(5000).default(100),
  active: z.boolean().default(true),
});

const rangeSchema = z.object({ from: zDate, to: zDate, employeeId: zUuid.optional() });
/** Rango [from 00:00, to+1 00:00) interpretado en la zona horaria del complejo. */
const toRange = (q: { from: string; to: string }, tz: string) => {
  const next = new Date(`${q.to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: zonedStartOfDay(q.from, tz), to: zonedStartOfDay(next.toISOString().slice(0, 10), tz) };
};

/** Empleados asignados a este proyecto (el alta y la asignación las hace el superusuario). */
@Controller('employees')
export class EmployeesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @Roles(...ROLES.FIN_READ)
  list(@Tenant() t: TenantCtx) {
    return this.db
      .select({
        id: employees.id, fullName: employees.fullName, documentId: employees.documentId, position: employees.position,
        phone: employees.phone, hourlyRate: employees.hourlyRate, userId: employees.userId, active: employees.active,
      })
      .from(employees)
      .innerJoin(employeeAssignments, eq(employeeAssignments.employeeId, employees.id))
      .where(and(eq(employeeAssignments.complexId, t.complexId), eq(employeeAssignments.active, true)))
      .orderBy(asc(employees.fullName));
  }
}

@Controller('geofences')
export class GeofencesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Tenant() t: TenantCtx) {
    return this.db.select().from(geofences).where(eq(geofences.complexId, t.complexId)).orderBy(asc(geofences.name));
  }

  @Post()
  @Roles(...ROLES.MANAGE)
  async create(@Tenant() t: TenantCtx, @Body(new ZodPipe(fenceSchema)) b: z.infer<typeof fenceSchema>) {
    const [row] = await this.db.insert(geofences).values({ ...b, complexId: t.complexId }).returning();
    return row;
  }

  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fenceSchema.partial())) b: Partial<z.infer<typeof fenceSchema>>) {
    const [row] = await this.db.update(geofences).set({ ...b, updatedAt: new Date() }).where(and(eq(geofences.id, id), eq(geofences.complexId, t.complexId))).returning();
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Se desactiva (no se borra) para conservar la trazabilidad de marcaciones pasadas. */
  @Delete(':id')
  @Roles(...ROLES.MANAGE)
  async remove(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.update(geofences).set({ active: false, updatedAt: new Date() }).where(and(eq(geofences.id, id), eq(geofences.complexId, t.complexId)));
    return { ok: true };
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly svc: AttendanceService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Marcación de entrada/salida con ubicación GPS. */
  @Post('clock')
  clock(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(clockSchema)) b: z.infer<typeof clockSchema>, @Req() req: Request) {
    return this.svc.clock(t, u.id, b, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  /** Estado actual del usuario: empleado vinculado y última marcación. */
  @Get('me')
  async me(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser) {
    const employee = await this.svc.myEmployee(t.complexId, u.id);
    if (!employee) return { employee: null, last: null, recent: [] };
    const recent = await this.db.select().from(timeEntries).where(eq(timeEntries.employeeId, employee.id)).orderBy(desc(timeEntries.serverTime)).limit(10);
    return { employee, last: recent[0] ?? null, recent };
  }

  private async tz(complexId: string) {
    const [c] = await this.db.select({ tz: complexes.timezone }).from(complexes).where(eq(complexes.id, complexId));
    return c.tz;
  }

  @Get('entries')
  @Roles(...ROLES.FIN_READ)
  async entries(@Tenant() t: TenantCtx, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    const r = toRange(q, await this.tz(t.complexId));
    return this.svc.entries(t.complexId, r.from, r.to, q.employeeId);
  }

  @Get('report')
  @Roles(...ROLES.FIN_READ)
  async report(@Tenant() t: TenantCtx, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    const r = toRange(q, await this.tz(t.complexId));
    return this.svc.report(t.complexId, r.from, r.to, q.employeeId);
  }
}

@Module({
  controllers: [EmployeesController, GeofencesController, AttendanceController],
  providers: [AttendanceService],
})
export class StaffModule {}
