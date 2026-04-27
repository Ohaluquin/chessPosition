/**
 * Core Data Models
 */

class Academia {
  constructor(id, nombre, { limiteSalon = null, profesores = [] } = {}) {
    this.id = id;
    this.nombre = nombre;
    this.limiteSalon = limiteSalon === null ? null : Math.max(0, Number(limiteSalon) || 0);
    this.profesores = Array.isArray(profesores) ? [...profesores] : [];
    this.asignaturas = []; // Array of Asignatura IDs or objects
  }
}

class Asignatura {
  constructor({
    id,
    nombre,
    academiaId,
    sesionesPorSemana,
    duracionSegmentos,
    estudio = { mode: "none" },
    requiereLaboratorio = false,
    weeklyBlockVariants = [],
    selectedWeeklyBlockVariant = null,
  }) {
    this.id = id;
    this.nombre = nombre;
    this.academiaId = academiaId;

    // Modelo real
    this.sesionesPorSemana = sesionesPorSemana; // ej. 2
    this.duracionSegmentos = duracionSegmentos; // ej. 3 → 90 min

    // Hora de estudio (explícita, sin números mágicos)
    this.estudio = {
      mode: estudio.mode || "none",
    };

    this.requiereLaboratorio = requiereLaboratorio;
    this.weeklyBlockVariants = this.normalizeWeeklyBlockVariants(weeklyBlockVariants);
    this.selectedWeeklyBlockVariant = selectedWeeklyBlockVariant || null;
  }

  buildDefaultRequiredBlocks() {
    const blocks = [];
    const totalSesiones = Math.max(0, this.sesionesPorSemana || 0);
    const baseDuration = Math.max(1, this.duracionSegmentos || 1);
    const studyMode = this.estudio?.mode || "none";

    if (this.requiereLaboratorio && totalSesiones > 0) {
      blocks.push({ kind: "laboratorio", duration: baseDuration });
    }

    const regularCount = Math.max(0, totalSesiones);
    for (let i = 0; i < regularCount; i += 1) {
      blocks.push({ kind: "clase", duration: baseDuration });
    }

    if (studyMode === "sesion_separate") {
      blocks.push({ kind: "estudio", duration: 2 });
    }

    return blocks;
  }

  normalizeWeeklyBlockVariants(variants) {
    return (Array.isArray(variants) ? variants : [])
      .map((variant, index) => {
        const blocks = (variant?.blocks || [])
          .map((block) => ({
            kind: block?.kind || "clase",
            duration: Math.max(1, Math.min(5, Number(block?.duration) || 1)),
          }))
          .filter((block) => !!block.kind && block.duration > 0);

        if (blocks.length === 0) return null;

        return {
          key: String(variant?.key || `custom_${index + 1}`),
          label: String(variant?.label || `Variante ${index + 1}`),
          blocks,
        };
      })
      .filter(Boolean);
  }

  buildClassOnlyVariants() {
    if (this.requiereLaboratorio) return [];

    const totalSegments = this.totalSegmentosSemanaBase;
    if (totalSegments < 4) return [];

    const variants = [];
    const unique = new Set();
    const durations = [5, 4, 3, 2];

    const visit = (remaining, current) => {
      if (remaining === 0) {
        if (current.length === 0) return;
        const normalized = [...current].sort((a, b) => b - a);
        const key = normalized.join("-");
        if (unique.has(key)) return;
        unique.add(key);
        variants.push(normalized);
        return;
      }

      for (const duration of durations) {
        if (duration > remaining) continue;
        if (current.length > 0 && duration > current[current.length - 1]) continue;
        visit(remaining - duration, [...current, duration]);
      }
    };

    visit(totalSegments, []);

    const defaultKey = this.buildDefaultRequiredBlocks()
      .map((block) => `${block.kind}:${block.duration}`)
      .join("|");

    return variants
      .map((durationsList) => ({
        key: `class_only_${durationsList.join("_")}`,
        label: durationsList.every((duration) => duration === durationsList[0])
          ? `${durationsList.length} sesiones de ${durationsList[0] * 30} min`
          : `Sesiones de ${durationsList.map((duration) => duration * 30).join("/") } min`,
        blocks: durationsList.map((duration) => ({ kind: "clase", duration })),
      }))
      .filter((variant) => {
        const variantKey = variant.blocks
          .map((block) => `${block.kind}:${block.duration}`)
          .join("|");
        return variantKey !== defaultKey;
      });
  }

  getBlockVariants() {
    const primary = {
      key: "default",
      label: "Base",
      blocks: this.buildDefaultRequiredBlocks(),
    };

    const variants = [primary];
    const seen = new Set([
      primary.blocks.map((block) => `${block.kind}:${block.duration}`).join("|"),
    ]);

    [...this.weeklyBlockVariants, ...this.buildClassOnlyVariants()].forEach((variant) => {
      const signature = variant.blocks
        .map((block) => `${block.kind}:${block.duration}`)
        .join("|");
      if (seen.has(signature)) return;
      seen.add(signature);
      variants.push(variant);
    });

    return variants;
  }

  getRequiredBlocks(variantKey = null) {
    const preferredKey = variantKey || this.selectedWeeklyBlockVariant || "default";
    const variants = this.getBlockVariants();
    const chosen = variants.find((variant) => variant.key === preferredKey) || variants[0];
    return chosen.blocks.map((block) => ({ ...block }));
  }

  getVariantLabel(variantKey = null) {
    const preferredKey = variantKey || this.selectedWeeklyBlockVariant || "default";
    const variants = this.getBlockVariants();
    return (
      variants.find((variant) => variant.key === preferredKey)?.label ||
      variants[0]?.label ||
      "Base"
    );
  }

  get totalSegmentosSemanaBase() {
    return this.buildDefaultRequiredBlocks().reduce(
      (total, block) => total + block.duration,
      0,
    );
  }

  // Carga total semanal en segmentos
  get totalSegmentosSemana() {
    return this.getRequiredBlocks().reduce(
      (total, block) => total + block.duration,
      0,
    );
  }
}

class Grupo {
  constructor({
    id,
    nombre,
    turno,
    grado = null,
    planAsignaturas = [],
    profesoresPorAsignatura = {},
    estructuraPorAsignatura = {},
  }) {
    this.id = id;
    this.nombre = nombre;
    this.turno = turno; // 'matutino' | 'vespertino'
    this.grado = grado;

    // Array de IDs de asignatura
    this.planAsignaturas = [...planAsignaturas];
    this.profesoresPorAsignatura = { ...profesoresPorAsignatura };
    this.estructuraPorAsignatura = { ...estructuraPorAsignatura };
  }

  tieneAsignatura(asignaturaId) {
    return this.planAsignaturas.includes(asignaturaId);
  }
}

class Profesor {
  constructor({ id, nombre, academiaId, turno, activo = true }) {
    this.id = id;
    this.nombre = nombre;
    this.academiaId = academiaId; // una sola
    this.turno = turno; // 'matutino' | 'vespertino'
    this.activo = activo;

    // Bloqueos/permiso explícitos viven en Horario.bloqueos
    // Esto es solo para compatibilidad futura
    this.disponibilidad = {};
    this.gruposAsignados = [];
  }

  isAvailable(dia, hora) {
    if (this.activo === false) return false;

    const slotKey = `${dia}-${hora}`;
    const raw = this.disponibilidad?.[slotKey];

    if (raw === false || raw === 0 || raw === "0" || raw === "no") {
      return false;
    }

    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (
        normalized === "---" ||
        normalized === "bloqueado" ||
        normalized === "ocupado" ||
        normalized === "false"
      ) {
        return false;
      }
    }

    return true;
  }
}

class Aula {
  constructor(id, nombre, tipo) {
    this.id = id;
    this.nombre = nombre;
    this.tipo = tipo; // 'normal', 'laboratorio', 'especial'
  }
}

class Sesion {
  constructor(
    grupoId,
    asignaturaId,
    profesorId,
    aulaId,
    dia,
    hora,
    tipoSesion = "clase",
    locked = false,
  ) {
    this.grupoId = grupoId;
    this.asignaturaId = asignaturaId;
    this.profesorId = profesorId;
    this.aulaId = aulaId;
    this.dia = dia;
    this.hora = hora;
    this.tipoSesion = tipoSesion;
    this.locked = locked === true;
  }
}

class Bloqueo {
  /**
   * @param {'ACADEMIA'|'PROFESOR'|'GRUPO'|'AULA'} scope
   * @param {string|null} targetId  // null when scope === 'GLOBAL'
   * @param {number} dia           // 0-4
   * @param {number} hora          // 0..N-1
   * @param {string} motivo
   */
  constructor(scope, targetId, dia, hora, motivo = "Bloqueado") {
    this.scope = scope;
    this.targetId = targetId;
    this.dia = dia;
    this.hora = hora;
    this.motivo = motivo;
  }
}

class Horario {
  constructor() {
    this.sesiones = [];
    this.bloqueos = [];
  }

  // -----------------------
  // Sesiones
  // -----------------------
  addSesion(sesion) {
    this.sesiones.push(sesion);
  }

  removeSesion(sesion) {
    const index = this.sesiones.indexOf(sesion);
    if (index > -1) this.sesiones.splice(index, 1);
  }

  findSesion(dia, hora, grupoId) {
    return this.sesiones.find(
      (s) => s.dia === dia && s.hora === hora && s.grupoId === grupoId,
    );
  }

  getSesionesByGrupo(grupoId) {
    return this.sesiones.filter((s) => s.grupoId === grupoId);
  }

  getSesionesByProfesor(profesorId) {
    return this.sesiones.filter((s) => s.profesorId === profesorId);
  }

  getSesionesByAula(aulaId) {
    return this.sesiones.filter((s) => s.aulaId === aulaId);
  }

  // -----------------------
  // Bloqueos
  // -----------------------
  _sameTarget(a, b) {
    // normaliza null/undefined
    return (a ?? null) === (b ?? null);
  }

  _sameKey(b, scope, targetId, dia, hora) {
    return (
      b.scope === scope &&
      this._sameTarget(b.targetId, targetId) &&
      b.dia === dia &&
      b.hora === hora
    );
  }

  addBloqueo(bloqueo) {
    // Evita duplicados exactos por llave
    const exists = this.bloqueos.some((b) =>
      this._sameKey(
        b,
        bloqueo.scope,
        bloqueo.targetId,
        bloqueo.dia,
        bloqueo.hora,
      ),
    );
    if (exists) return false;
    this.bloqueos.push(bloqueo);
    return true;
  }

  removeBloqueo(bloqueo) {
    // Remueve por referencia si viene un objeto existente
    const index = this.bloqueos.indexOf(bloqueo);
    if (index > -1) {
      this.bloqueos.splice(index, 1);
      return true;
    }
    return false;
  }

  removeBloqueoByKey(scope, targetId, dia, hora) {
    const before = this.bloqueos.length;
    this.bloqueos = this.bloqueos.filter(
      (b) => !this._sameKey(b, scope, targetId, dia, hora),
    );
    return this.bloqueos.length !== before;
  }

  findBloqueo(scope, targetId, dia, hora) {
    return (
      this.bloqueos.find((b) => this._sameKey(b, scope, targetId, dia, hora)) ||
      null
    );
  }

  hasBloqueo(scope, targetId, dia, hora) {
    return !!this.findBloqueo(scope, targetId, dia, hora);
  }

  /**
   * Regla general:
   * - Si hay un bloqueo específico 
   */
  isBlocked(scope, targetId, dia, hora) {
    return !!this.findBloqueo(scope, targetId, dia, hora);
  }

  /**
   * Toggle por llave. Si existe: lo elimina.
   * Si no existe: lo crea. Si motivo cambia y ya existía: lo actualiza (opcional).
   */
  toggleBloqueo(scope, targetId, dia, hora, motivo = "Bloqueado") {
    const existing = this.findBloqueo(scope, targetId, dia, hora);

    if (existing) {
      this.removeBloqueo(existing);
      return { action: "removed", bloqueo: existing };
    }

    const nuevo = new Bloqueo(scope, targetId ?? null, dia, hora, motivo);
    this.addBloqueo(nuevo);
    return { action: "added", bloqueo: nuevo };
  }

  /**
   * Set explícito (útil cuando quieres "forzar" un motivo).
   * Si ya existe, actualiza motivo. Si no existe, lo crea.
   */
  setBloqueo(scope, targetId, dia, hora, motivo = "Bloqueado") {
    const existing = this.findBloqueo(scope, targetId, dia, hora);
    if (existing) {
      existing.motivo = motivo;
      return { action: "updated", bloqueo: existing };
    }
    const nuevo = new Bloqueo(scope, targetId ?? null, dia, hora, motivo);
    this.addBloqueo(nuevo);
    return { action: "added", bloqueo: nuevo };
  }
}
