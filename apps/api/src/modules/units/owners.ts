/**
 * Vínculo propiedad ↔ propietario (muchos a muchos, tabla `unit_owners`).
 * El propietario es un usuario con membresía RESIDENT en el proyecto; ingresa con su teléfono.
 */
import { BadRequestException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Db, Tx } from '../../db/client';
import { memberships, unitOwners, units, users } from '../../db/schema';

export { looksLikePhone, phoneUsername } from '../../common/phone';

/** Copia nombre(s), correo y teléfono de los dueños a la propiedad (lo que leen reportes y listados). */
export async function refreshOwnerSnapshot(tx: Tx, unitId: string) {
  const owners = await tx
    .select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone })
    .from(unitOwners)
    .innerJoin(users, eq(users.id, unitOwners.userId))
    .where(eq(unitOwners.unitId, unitId))
    .orderBy(asc(unitOwners.createdAt));
  await tx
    .update(units)
    .set({
      ownerUserId: owners[0]?.id ?? null,
      ownerName: owners.length ? owners.map((o) => o.fullName).join(' · ').slice(0, 150) : null,
      ownerEmail: owners.find((o) => o.email)?.email ?? null,
      ownerPhone: owners.find((o) => o.phone)?.phone ?? null,
      updatedAt: new Date(),
    })
    .where(eq(units.id, unitId));
}

/** Vincula un propietario del proyecto a una propiedad del proyecto (idempotente). */
export async function linkOwner(tx: Tx, complexId: string, unitId: string, userId: string) {
  const [unit] = await tx.select({ id: units.id }).from(units).where(and(eq(units.id, unitId), eq(units.complexId, complexId)));
  if (!unit) throw new BadRequestException('Propiedad inválida');
  const [m] = await tx
    .select({ unitId: memberships.unitId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId)));
  if (!m || m.role !== 'RESIDENT') throw new BadRequestException('Esa persona no es propietario de este proyecto');
  await tx.insert(unitOwners).values({ complexId, unitId, userId }).onConflictDoNothing();
  // La primera propiedad queda como principal del acceso (consultas y reclamos)
  if (!m.unitId) await tx.update(memberships).set({ unitId, updatedAt: new Date() }).where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId)));
  await refreshOwnerSnapshot(tx, unitId);
}

/** Desvincula; si era la propiedad principal del acceso, pasa a otra de las suyas (o ninguna). */
export async function unlinkOwner(tx: Tx, complexId: string, unitId: string, userId: string) {
  await tx.delete(unitOwners).where(and(eq(unitOwners.unitId, unitId), eq(unitOwners.userId, userId), eq(unitOwners.complexId, complexId)));
  const [m] = await tx.select({ unitId: memberships.unitId }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId)));
  if (m?.unitId === unitId) {
    const [next] = await ownedUnitIds(tx, complexId, userId);
    await tx.update(memberships).set({ unitId: next ?? null, updatedAt: new Date() }).where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId)));
  }
  await refreshOwnerSnapshot(tx, unitId);
}

/** Deja al propietario con exactamente estas propiedades del proyecto. */
export async function setOwnedUnits(tx: Tx, complexId: string, userId: string, unitIds: string[]) {
  const wanted = [...new Set(unitIds)];
  const current = await ownedUnitIds(tx, complexId, userId);
  for (const id of current.filter((x) => !wanted.includes(x))) await unlinkOwner(tx, complexId, id, userId);
  for (const id of wanted.filter((x) => !current.includes(x))) await linkOwner(tx, complexId, id, userId);
}

/** Propiedades de un propietario en el proyecto (más antiguas primero). */
export async function ownedUnitIds(db: Db | Tx, complexId: string, userId: string) {
  const rows = await db
    .select({ unitId: unitOwners.unitId })
    .from(unitOwners)
    .innerJoin(units, eq(units.id, unitOwners.unitId))
    .where(and(eq(unitOwners.complexId, complexId), eq(unitOwners.userId, userId)))
    .orderBy(asc(units.code));
  return rows.map((r) => r.unitId);
}

/** Dueños de varias propiedades, para listados. */
export async function ownersOf(db: Db | Tx, unitIds: string[]) {
  if (!unitIds.length) return [];
  return db
    .select({ unitId: unitOwners.unitId, userId: users.id, fullName: users.fullName, phone: users.phone, email: users.email })
    .from(unitOwners)
    .innerJoin(users, eq(users.id, unitOwners.userId))
    .where(inArray(unitOwners.unitId, unitIds))
    .orderBy(asc(unitOwners.createdAt));
}
