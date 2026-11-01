import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq, getTableColumns, inArray, notInArray, sql } from 'drizzle-orm';
import { logoColumns, zLogo } from '../../common/image';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, SuperAdmin } from '../../common/auth.decorators';
import { zMoney, ZodPipe, zUuid } from '../../common/zod.pipe';
import { DB, Db, Tx } from '../../db/client';
import { complexes, employeeAssignments, employees, memberships, units, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { LedgerService } from '../ledger/ledger.service';

const projectSchema = z.object({
  name: z.string().min(2).max(150),
  type: z.enum(['RESIDENTIAL', 'RECREATIONAL', 'MIXED']).default('RESIDENTIAL'),
  address: z.string().max(500).nullable().optional(),
  active: z.boolean().default(true),
  logo: zLogo,
  /** Administrador del proyecto (opcional): se crea si el correo no existe. */
  adminEmail: z.string().email().optional(),
  adminName: z.string().min(2).max(150).optional(),
  adminPassword: z.string().min(8).max(128).optional(),
});

const employeeSchema = z.object({
  fullName: z.string().min(2).max(150),
  documentId: z.string().max(30).nullable().optional(),
  position: z.string().max(80).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  hourlyRate: zMoney.default(0),
  active: z.boolean().default(true),
  /** Proyectos donde trabaja. */
  projectIds: z.array(zUuid).max(200).default([]),
  /** Acceso para marcar asistencia (opcional). */
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().min(8).max(128).optional(),
});

/**
 * Consola de la plataforma (solo superusuario):
 *  - Proyectos: crear y configurar complejos y asignar su administrador.
 *  - Empleados: registro único y asociación a uno o varios proyectos.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async projects() {
    const { logo: _logo, ...cols } = getTableColumns(complexes);
    const list = await this.db.select(cols).from(complexes).orderBy(asc(complexes.name));
    const count = async (q: Promise<{ complexId: string; n: number }[]>) => new Map((await q).map((r) => [r.complexId, r.n]));
    const [u, r, e, a] = await Promise.all([
      count(this.db.select({ complexId: units.complexId, n: sql<number>`count(*)::int` }).from(units).groupBy(units.complexId)),
      count(this.db.select({ complexId: memberships.complexId, n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.role, 'RESIDENT')).groupBy(memberships.complexId)),
      count(this.db.select({ complexId: employeeAssignments.complexId, n: sql<number>`count(*)::int` }).from(employeeAssignments).where(eq(employeeAssignments.active, true)).groupBy(employeeAssignments.complexId)),
      count(
        this.db
          .select({ complexId: memberships.complexId, n: sql<number>`count(*)::int` })
          .from(memberships)
          .where(sql`${memberships.role} in ('ADMIN','OWNER')`)
          .groupBy(memberships.complexId),
      ),
    ]);
    const adminRows = await this.db
      .select({ complexId: memberships.complexId, fullName: users.fullName, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(sql`${memberships.role} in ('ADMIN','OWNER')`);
    return list.map((c) => ({
      ...c,
      logoVersion: c.logoUpdatedAt ? c.logoUpdatedAt.toISOString() : null,
      counts: { units: u.get(c.id) ?? 0, residents: r.get(c.id) ?? 0, employees: e.get(c.id) ?? 0, admins: a.get(c.id) ?? 0 },
      admins: adminRows.filter((x) => x.complexId === c.id).map(({ fullName, email }) => ({ fullName, email })),
    }));
  }

  async createProject(userId: string, b: z.infer<typeof projectSchema>) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(complexes)
        .values({ name: b.name, type: b.type, address: b.address, active: b.active, ...logoColumns(b.logo) })
        .returning({ id: complexes.id, name: complexes.name });
      await this.ledger.seedChart(c.id, tx);
      if (b.adminEmail) await this.attachAdmin(tx, c.id, b);
      await this.audit.log({ complexId: c.id, userId, action: 'CREATE_PROJECT', entity: 'complex', entityId: c.id }, tx);
      return c;
    });
  }

  async updateProject(userId: string, id: string, b: Partial<z.infer<typeof projectSchema>>) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .update(complexes)
        .set({ name: b.name, type: b.type, address: b.address, active: b.active, ...logoColumns(b.logo), updatedAt: new Date() })
        .where(eq(complexes.id, id))
        .returning({ id: complexes.id, name: complexes.name });
      if (!c) throw new NotFoundException();
      if (b.adminEmail) await this.attachAdmin(tx, c.id, b);
      await this.audit.log({ complexId: c.id, userId, action: 'UPDATE_PROJECT', entity: 'complex', entityId: c.id }, tx);
      return c;
    });
  }

  private async attachAdmin(tx: Tx, complexId: string, b: Partial<z.infer<typeof projectSchema>>) {
    const email = b.adminEmail!.toLowerCase().trim();
    let [user] = await tx.select().from(users).where(eq(users.email, email));
    if (!user) {
      if (!b.adminPassword || !b.adminName) throw new BadRequestException('Para un administrador nuevo indique nombre y contraseña temporal');
      [user] = await tx.insert(users).values({ email, fullName: b.adminName, passwordHash: await this.auth.hash(b.adminPassword) }).returning();
    }
    await tx
      .insert(memberships)
      .values({ userId: user.id, complexId, role: 'ADMIN', status: 'ACTIVE' })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.complexId], set: { role: 'ADMIN', status: 'ACTIVE', updatedAt: new Date() } });
  }

  // ─── Empleados ───

  async employees() {
    const list = await this.db
      .select({
        id: employees.id, fullName: employees.fullName, documentId: employees.documentId, position: employees.position,
        phone: employees.phone, hourlyRate: employees.hourlyRate, active: employees.active, userId: employees.userId, loginEmail: users.email,
      })
      .from(employees)
      .leftJoin(users, eq(users.id, employees.userId))
      .orderBy(asc(employees.fullName));
    const assigns = await this.db
      .select({ employeeId: employeeAssignments.employeeId, complexId: complexes.id, name: complexes.name })
      .from(employeeAssignments)
      .innerJoin(complexes, eq(complexes.id, employeeAssignments.complexId))
      .where(eq(employeeAssignments.active, true));
    return list.map((e) => ({ ...e, projects: assigns.filter((a) => a.employeeId === e.id).map(({ complexId, name }) => ({ id: complexId, name })) }));
  }

  async saveEmployee(userId: string, b: Partial<z.infer<typeof employeeSchema>>, id?: string) {
    return this.db.transaction(async (tx) => {
      let current = id ? (await tx.select().from(employees).where(eq(employees.id, id)))[0] : undefined;
      if (id && !current) throw new NotFoundException();

      // Usuario para marcar asistencia
      let linkedUserId = current?.userId ?? null;
      if (b.loginEmail) {
        const email = b.loginEmail.toLowerCase().trim();
        let [user] = await tx.select().from(users).where(eq(users.email, email));
        if (!user) {
          if (!b.loginPassword) throw new BadRequestException('Indique una contraseña temporal para el acceso del empleado');
          [user] = await tx.insert(users).values({ email, fullName: b.fullName ?? current?.fullName ?? email, passwordHash: await this.auth.hash(b.loginPassword) }).returning();
        }
        const [taken] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id));
        if (taken && taken.id !== id) throw new ConflictException('Ese usuario ya está vinculado a otro empleado');
        linkedUserId = user.id;
      }

      const values = {
        fullName: b.fullName, documentId: b.documentId, position: b.position, phone: b.phone, active: b.active,
        hourlyRate: b.hourlyRate === undefined ? undefined : b.hourlyRate.toFixed(2), userId: linkedUserId, updatedAt: new Date(),
      };
      if (current) {
        [current] = await tx.update(employees).set(values).where(eq(employees.id, current.id)).returning();
      } else {
        [current] = await tx.insert(employees).values({ ...values, fullName: b.fullName! }).returning();
      }

      if (b.projectIds) await this.setAssignments(tx, current.id, b.projectIds);
      await this.syncStaffMemberships(tx, current.id);
      await this.audit.log({ userId, action: id ? 'UPDATE_EMPLOYEE' : 'CREATE_EMPLOYEE', entity: 'employee', entityId: current.id, data: { projectIds: b.projectIds } }, tx);
      return current;
    });
  }

  private async setAssignments(tx: Tx, employeeId: string, projectIds: string[]) {
    const ids = [...new Set(projectIds)];
    if (ids.length) {
      const found = await tx.select({ id: complexes.id }).from(complexes).where(inArray(complexes.id, ids));
      if (found.length !== ids.length) throw new BadRequestException('Proyecto inválido');
      for (const complexId of ids) {
        await tx
          .insert(employeeAssignments)
          .values({ employeeId, complexId, active: true })
          .onConflictDoUpdate({ target: [employeeAssignments.employeeId, employeeAssignments.complexId], set: { active: true, updatedAt: new Date() } });
      }
    }
    const others = and(eq(employeeAssignments.employeeId, employeeId), ids.length ? notInArray(employeeAssignments.complexId, ids) : undefined);
    await tx.update(employeeAssignments).set({ active: false, updatedAt: new Date() }).where(others);
  }

  /**
   * El usuario de un empleado necesita membresía STAFF en cada proyecto asignado para poder marcar.
   * Nunca rebaja un rol superior que la persona ya tenga en un proyecto.
   */
  private async syncStaffMemberships(tx: Tx, employeeId: string) {
    const [e] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!e?.userId) return;
    const active = e.active
      ? (await tx.select({ complexId: employeeAssignments.complexId }).from(employeeAssignments).where(and(eq(employeeAssignments.employeeId, employeeId), eq(employeeAssignments.active, true)))).map((r) => r.complexId)
      : [];
    for (const complexId of active) {
      await tx.insert(memberships).values({ userId: e.userId, complexId, role: 'STAFF', status: 'ACTIVE' }).onConflictDoNothing();
    }
    // Retira el acceso STAFF de proyectos donde ya no trabaja
    await tx
      .delete(memberships)
      .where(and(eq(memberships.userId, e.userId), eq(memberships.role, 'STAFF'), active.length ? notInArray(memberships.complexId, active) : undefined));
  }
}

@Controller('admin')
@SuperAdmin()
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('projects')
  projects() {
    return this.svc.projects();
  }

  @Post('projects')
  createProject(@CurrentUser() u: AuthUser, @Body(new ZodPipe(projectSchema)) b: z.infer<typeof projectSchema>) {
    return this.svc.createProject(u.id, b);
  }

  @Patch('projects/:id')
  updateProject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(projectSchema.partial())) b: Partial<z.infer<typeof projectSchema>>) {
    return this.svc.updateProject(u.id, id, b);
  }

  @Get('employees')
  employees() {
    return this.svc.employees();
  }

  @Post('employees')
  createEmployee(@CurrentUser() u: AuthUser, @Body(new ZodPipe(employeeSchema)) b: z.infer<typeof employeeSchema>) {
    return this.svc.saveEmployee(u.id, b);
  }

  @Patch('employees/:id')
  updateEmployee(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(employeeSchema.partial())) b: Partial<z.infer<typeof employeeSchema>>) {
    return this.svc.saveEmployee(u.id, b, id);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
