import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { isManager, TenantCtx } from '../../common/auth.decorators';
import { AuditService } from '../../common/audit.service';
import { nearestFence } from '../../common/geo';
import { fromCents, toCents } from '../../common/money';
import { pairShifts } from '../../common/shifts';
import { zUuid } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { complexes, employeeAssignments, employees, geofences, timeEntries, users } from '../../db/schema';

export const clockSchema = z.object({
  type: z.enum(['IN', 'OUT']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000).optional(),
  deviceTime: z.string().datetime({ offset: true }).optional(),
  /** Solo administradores: marcar por otro empleado (queda como registro manual). */
  employeeId: zUuid.optional(),
  notes: z.string().max(300).optional(),
});

const MAX_ACCURACY_M = 150; // por encima, la lectura GPS se considera poco confiable
const MAX_CLOCK_SKEW_MS = 5 * 60_000; // diferencia tolerada entre reloj del dispositivo y servidor

/**
 * Control de marcación con geolocalización.
 *  - La hora autoritativa es la del servidor; la del dispositivo se guarda para detectar manipulación.
 *  - Se calcula la geocerca más cercana y la distancia; si el complejo exige geocerca, se rechaza fuera de zona.
 *  - Se evita doble entrada/salida consecutiva.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async myEmployee(complexId: string, userId: string) {
    const [row] = await this.db
      .select({ e: employees })
      .from(employees)
      .innerJoin(employeeAssignments, eq(employeeAssignments.employeeId, employees.id))
      .where(and(eq(employeeAssignments.complexId, complexId), eq(employeeAssignments.active, true), eq(employees.userId, userId), eq(employees.active, true)));
    return row?.e ?? null;
  }

  /** Empleado asignado (activo) al proyecto. */
  async assignedEmployee(complexId: string, employeeId: string) {
    const [row] = await this.db
      .select({ e: employees })
      .from(employees)
      .innerJoin(employeeAssignments, eq(employeeAssignments.employeeId, employees.id))
      .where(and(eq(employeeAssignments.complexId, complexId), eq(employeeAssignments.active, true), eq(employees.id, employeeId)));
    return row?.e ?? null;
  }

  async clock(t: TenantCtx, userId: string, b: z.infer<typeof clockSchema>, meta: { ip?: string; userAgent?: string }) {
    let employee: typeof employees.$inferSelect | null | undefined;
    if (b.employeeId) {
      if (!isManager(t.role)) throw new ForbiddenException('Solo un administrador puede marcar por otro empleado');
      employee = await this.assignedEmployee(t.complexId, b.employeeId);
    } else {
      employee = await this.myEmployee(t.complexId, userId);
    }
    if (!employee) throw new BadRequestException('No hay un empleado activo asignado a este proyecto para este usuario');

    const [last] = await this.db.select().from(timeEntries).where(eq(timeEntries.employeeId, employee.id)).orderBy(desc(timeEntries.serverTime)).limit(1);
    const expected = !last || last.type === 'OUT' ? 'IN' : 'OUT';
    if (b.type !== expected) throw new BadRequestException(b.type === 'IN' ? 'Ya tiene una entrada abierta; marque salida primero' : 'No tiene una entrada abierta');

    const [complex] = await this.db.select().from(complexes).where(eq(complexes.id, t.complexId));
    const fences = await this.db.select().from(geofences).where(and(eq(geofences.complexId, t.complexId), eq(geofences.active, true)));
    const near = nearestFence(b.latitude, b.longitude, fences, b.accuracy ?? 0);

    if (complex.requireGeofence && fences.length > 0 && !near?.within && !b.employeeId) {
      throw new BadRequestException(
        'Está fuera de la zona permitida para marcar. Acérquese a la portería o al área asignada.',
      );
    }

    const flags: string[] = [];
    if ((b.accuracy ?? 0) > MAX_ACCURACY_M) flags.push('GPS de baja precisión');
    if (b.deviceTime && Math.abs(new Date(b.deviceTime).getTime() - Date.now()) > MAX_CLOCK_SKEW_MS) flags.push('Reloj del dispositivo desfasado');

    const [row] = await this.db
      .insert(timeEntries)
      .values({
        complexId: t.complexId,
        employeeId: employee.id,
        type: b.type,
        deviceTime: b.deviceTime ? new Date(b.deviceTime) : null,
        latitude: b.latitude,
        longitude: b.longitude,
        accuracyMeters: b.accuracy,
        geofenceId: near?.fence.id,
        distanceMeters: near ? Math.round(near.distance) : null,
        withinGeofence: near ? near.within : null,
        manual: !!b.employeeId,
        recordedBy: userId,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
        notes: [b.notes, ...flags].filter(Boolean).join(' · ') || null,
      })
      .returning();
    await this.audit.log({ complexId: t.complexId, userId, action: `CLOCK_${b.type}`, entity: 'time_entry', entityId: row.id });
    return { ...row, employeeName: employee.fullName, geofenceName: near?.fence.name ?? null, flags };
  }

  async entries(complexId: string, from: Date, to: Date, employeeId?: string) {
    const conds = [eq(timeEntries.complexId, complexId), gte(timeEntries.serverTime, from), lt(timeEntries.serverTime, to)];
    if (employeeId) conds.push(eq(timeEntries.employeeId, employeeId));
    return this.db
      .select({
        id: timeEntries.id,
        employeeId: timeEntries.employeeId,
        employeeName: employees.fullName,
        type: timeEntries.type,
        serverTime: timeEntries.serverTime,
        deviceTime: timeEntries.deviceTime,
        latitude: timeEntries.latitude,
        longitude: timeEntries.longitude,
        accuracyMeters: timeEntries.accuracyMeters,
        distanceMeters: timeEntries.distanceMeters,
        withinGeofence: timeEntries.withinGeofence,
        geofenceName: geofences.name,
        manual: timeEntries.manual,
        notes: timeEntries.notes,
        ip: timeEntries.ip,
        userAgent: timeEntries.userAgent,
        recordedByName: users.fullName,
      })
      .from(timeEntries)
      .innerJoin(employees, eq(employees.id, timeEntries.employeeId))
      .leftJoin(geofences, eq(geofences.id, timeEntries.geofenceId))
      .leftJoin(users, eq(users.id, timeEntries.recordedBy))
      .where(and(...conds))
      .orderBy(asc(timeEntries.serverTime));
  }

  /** Reporte de horas: empareja entradas/salidas por empleado y calcula costo de mano de obra. */
  async report(complexId: string, from: Date, to: Date, employeeId?: string) {
    const rows = await this.entries(complexId, from, to, employeeId);
    const ids = [...byEmpIds(rows)];
    const emps = ids.length ? await this.db.select().from(employees).where(inArray(employees.id, ids)) : [];
    const byEmp = new Map<string, typeof rows>();
    for (const r of rows) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);

    const result = emps
      .filter((e) => byEmp.has(e.id))
      .map((e) => {
        const shifts = pairShifts(byEmp.get(e.id)!);
        const totalHours = Math.round(shifts.reduce((s, x) => s + x.hours, 0) * 100) / 100;
        const rate = toCents(e.hourlyRate);
        return {
          employeeId: e.id,
          fullName: e.fullName,
          position: e.position,
          hourlyRate: fromCents(rate),
          totalHours,
          laborCost: fromCents(Math.round(totalHours * rate)),
          shifts,
          flaggedCount: shifts.filter((s) => s.flags.length).length,
        };
      });
    return {
      from,
      to,
      employees: result,
      totals: {
        hours: Math.round(result.reduce((s, r) => s + r.totalHours, 0) * 100) / 100,
        laborCost: Math.round(result.reduce((s, r) => s + r.laborCost, 0) * 100) / 100,
      },
    };
  }
}

const byEmpIds = (rows: { employeeId: string }[]) => new Set(rows.map((r) => r.employeeId));
