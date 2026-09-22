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
    variantPreferences = {},
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
      durationSegmentos: Math.max(1, Math.min(5, Number(estudio.durationSegmentos) || 2)),
    };

    this.requiereLaboratorio = requiereLaboratorio;
    this.weeklyBlockVariants = this.normalizeWeeklyBlockVariants(weeklyBlockVariants);
    this.selectedWeeklyBlockVariant = selectedWeeklyBlockVariant || null;
    this.variantPreferences = this.normalizeVariantPreferences(variantPreferences);
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
      blocks.push({ kind: "estudio", duration: this.getStudyDurationSegments() });
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

  normalizeVariantPreferences(preferences) {
    const source = preferences && typeof preferences === "object" ? preferences : {};
    const byPeriod = source.byPeriod || source.porPeriodo || source.periodo || {};
    const byModality =
      source.byModality || source.porModalidad || source.modalidad || {};
    return {
      default: String(source.default || source.predeterminada || "") || null,
      byPeriod: Object.fromEntries(
        Object.entries(byPeriod).filter(([, value]) => value).map(([key, value]) => [
          String(key).toLowerCase(),
          String(value),
        ]),
      ),
      byModality: Object.fromEntries(
        Object.entries(byModality).filter(([, value]) => value).map(([key, value]) => [
          String(key).toLowerCase(),
          String(value),
        ]),
      ),
    };
  }

  getPreferredVariantKey({ periodo = null, modalidad = null } = {}) {
    const normalizedPeriod = String(periodo || "").toLowerCase();
    const normalizedModality = String(modalidad || "").toLowerCase();
    return (
      this.variantPreferences?.byModality?.[normalizedModality] ||
      this.variantPreferences?.byPeriod?.[normalizedPeriod] ||
      this.variantPreferences?.default ||
      null
    );
  }

  buildClassOnlyVariants({ includeLaboratory = false } = {}) {
    const classSegments = Math.max(
      0,
      Number(this.sesionesPorSemana || 0) * Math.max(1, Number(this.duracionSegmentos || 1)),
    );
    const studySegments = this.getStudyDurationSegments();
    const candidateTotals = [
      classSegments - studySegments,
      classSegments,
      classSegments + studySegments,
    ].filter(
      (value, index, list) => value >= 4 && list.indexOf(value) === index,
    );
    if (candidateTotals.length === 0) return [];

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

    candidateTotals.forEach((totalSegments) => visit(totalSegments, []));

    const defaultKey = this.buildDefaultRequiredBlocks()
      .map((block) => `${block.kind}:${block.duration}`)
      .join("|");

    const labPrefix = includeLaboratory && this.requiereLaboratorio
      ? [{ kind: "laboratorio", duration: Math.max(1, Number(this.duracionSegmentos || 1)) }]
      : [];
    const keyPrefix = labPrefix.length > 0 ? "lab_" : "";
    return variants.map((durationsList) => ({
      key: `${keyPrefix}class_only_${durationsList.join("_")}`,
      label: durationsList.every((duration) => duration === durationsList[0])
        ? `${labPrefix.length > 0 ? "Laboratorio + " : ""}${durationsList.length} sesiones de ${durationsList[0] * 30} min`
        : `${labPrefix.length > 0 ? "Laboratorio + " : ""}sesiones de ${durationsList.map((duration) => duration * 30).join("/")} min`,
      blocks: [
        ...labPrefix,
        ...durationsList.map((duration) => ({ kind: "clase", duration })),
      ],
    })).filter((variant) => {
      const variantKey = variant.blocks.map((block) => `${block.kind}:${block.duration}`).join("|");
      return variantKey !== defaultKey;
    });
  }

  getStudyDurationSegments() {
    return Math.max(1, Math.min(5, Number(this.estudio?.durationSegmentos) || 2));
  }

  buildGenericStudyVariants() {
    const defaultBlocks = this.buildDefaultRequiredBlocks();
    const hasStudy = defaultBlocks.some((block) => block.kind === "estudio");
    const variants = [];

    if (hasStudy) {
      const withoutStudy = defaultBlocks.filter((block) => block.kind !== "estudio");
      if (withoutStudy.length > 0) {
        variants.push({
          key: "sin_estudio",
          label: "Sin hora de estudio",
          blocks: withoutStudy,
        });
      }
    } else {
      const classBlocks = defaultBlocks.filter((block) => block.kind === "clase");
      if (classBlocks.length > 0) {
        variants.push({
          key: "estudio_separado",
          label: "Con hora de estudio separada",
          blocks: [
            ...defaultBlocks,
            { kind: "estudio", duration: this.getStudyDurationSegments() },
          ],
        });
      }
    }

    return variants;
  }

  buildScienceVariants() {
    if (!this.requiereLaboratorio) return [];

    const baseDuration = Math.max(1, this.duracionSegmentos || 1);
    const longClassDuration = Math.max(baseDuration, 4);
    return [
      {
        key: "ciencias_lab_clase_estudio",
        label: "Laboratorio + 2 clases + estudio",
        blocks: [
          { kind: "laboratorio", duration: baseDuration },
          { kind: "clase", duration: baseDuration },
          { kind: "clase", duration: baseDuration },
          { kind: "estudio", duration: 2 },
        ],
      },
      {
        key: "ciencias_lab_clases",
        label: "Laboratorio + 2 clases",
        blocks: [
          { kind: "laboratorio", duration: baseDuration },
          { kind: "clase", duration: baseDuration },
          { kind: "clase", duration: baseDuration },
        ],
      },
      {
        key: "ciencias_tres_clases",
        label: "3 clases sin laboratorio",
        blocks: [
          { kind: "clase", duration: baseDuration },
          { kind: "clase", duration: baseDuration },
          { kind: "clase", duration: baseDuration },
        ],
      },
      {
        key: "ciencias_lab_clases_largas",
        label: "Laboratorio + 2 clases de 120 min",
        blocks: [
          { kind: "laboratorio", duration: baseDuration },
          { kind: "clase", duration: longClassDuration },
          { kind: "clase", duration: longClassDuration },
        ],
      },
    ];
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

    [
      ...this.weeklyBlockVariants,
      ...this.buildScienceVariants(),
      ...this.buildGenericStudyVariants(),
      ...this.buildClassOnlyVariants(),
      ...this.buildClassOnlyVariants({ includeLaboratory: true }),
    ].forEach((variant) => {
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
    tipo = "regular",
    modalidad = null,
    planAsignaturas = [],
    profesoresPorAsignatura = {},
    estructuraPorAsignatura = {},
    franjasOptativasPorAsignatura = {},
  }) {
    this.id = id;
    this.nombre = nombre;
    this.turno = turno; // 'matutino' | 'vespertino'
    this.grado = grado;
    this.tipo = tipo === "optativa" ? "optativa" : "regular";
    this.modalidad = ["estructura", "recursamiento"].includes(modalidad)
      ? modalidad
      : null;

    // Array de IDs de asignatura
    this.planAsignaturas = [...planAsignaturas];
    this.profesoresPorAsignatura = { ...profesoresPorAsignatura };
    this.estructuraPorAsignatura = { ...estructuraPorAsignatura };
    this.franjasOptativasPorAsignatura = Object.fromEntries(
      Object.entries(franjasOptativasPorAsignatura || {}).map(
        ([asignaturaId, slotIds]) => [
          asignaturaId,
          Array.isArray(slotIds) ? [...slotIds] : slotIds ? [slotIds] : [],
        ],
      ),
    );
  }

  tieneAsignatura(asignaturaId) {
    return this.planAsignaturas.includes(asignaturaId);
  }
}

class Profesor {
  constructor({ id, nombre, academiaId, turno, activo = true, horarioLaboral = null }) {
    this.id = id;
    this.nombre = nombre;
    this.academiaId = academiaId; // una sola
    this.turno = turno; // 'matutino' | 'vespertino'
    this.activo = activo;
    this.horarioLaboral =
      horarioLaboral?.inicio && horarioLaboral?.fin
        ? { inicio: horarioLaboral.inicio, fin: horarioLaboral.fin }
        : null;

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
    blockId = null,
  ) {
    this.grupoId = grupoId;
    this.asignaturaId = asignaturaId;
    this.profesorId = profesorId;
    this.aulaId = aulaId;
    this.dia = dia;
    this.hora = hora;
    this.tipoSesion = tipoSesion;
    this.locked = locked === true;
    this.blockId = blockId || null;
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
