const MAX_SHIFT_HOURS = 16; // turnos más largos se marcan para revisión

export interface Shift {
  in: Date;
  out: Date | null;
  hours: number;
  flags: string[];
}

type EntryRow = { type: 'IN' | 'OUT'; serverTime: Date; withinGeofence: boolean | null; manual: boolean; notes: string | null };

export function pairShifts(entries: EntryRow[]): Shift[] {
  const shifts: Shift[] = [];
  let open: { at: Date; flags: string[] } | null = null;
  const entryFlags = (e: EntryRow) => [
    ...(e.withinGeofence === false ? ['Fuera de geocerca'] : []),
    ...(e.manual ? ['Registro manual'] : []),
    ...(e.notes?.includes('GPS de baja precisión') ? ['GPS impreciso'] : []),
  ];
  for (const e of entries) {
    if (e.type === 'IN') {
      if (open) shifts.push({ in: open.at, out: null, hours: 0, flags: [...open.flags, 'Sin salida'] });
      open = { at: e.serverTime, flags: entryFlags(e) };
    } else if (open) {
      const hours = (e.serverTime.getTime() - open.at.getTime()) / 3_600_000;
      const flags = [...new Set([...open.flags, ...entryFlags(e)])];
      if (hours > MAX_SHIFT_HOURS) flags.push('Turno excesivo');
      shifts.push({ in: open.at, out: e.serverTime, hours: Math.round(hours * 100) / 100, flags });
      open = null;
    }
  }
  if (open) shifts.push({ in: open.at, out: null, hours: 0, flags: [...open.flags, 'En curso / sin salida'] });
  return shifts;
}
