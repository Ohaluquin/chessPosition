const ClassroomService = {
  async autoAssign(app, onProgress = null) {
    const blocks = this.buildBlocks(app);
    const homeRooms = this.createHomeRoomRegistry(app);
    const summary = {
      totalBloques: blocks.length,
      asignados: 0,
      sinAula: 0,
      especiales: 0,
      laboratorios: 0,
      estructura: 0,
      optativas: 0,
      recursamiento: 0,
      fallback: 0,
    };

    app.horario.sesiones.forEach((sesion) => {
      sesion.aulaId = null;
    });

    const notify = async (current, detail) => {
      if (!onProgress) return;
      await onProgress({
        label: "Autoasignando aulas",
        detail,
        current,
        total: 6,
      });
    };

    await notify(1, "Asignando bloques especiales...");
    this.assignSpecialBlocks(app, blocks, summary);
    await notify(2, "Asignando laboratorios...");
    this.assignLabBlocks(app, blocks, summary);
    await notify(3, "Asignando aulas por estructura...");
    this.assignStructureBlocks(app, blocks, homeRooms, summary);
    await notify(4, "Asignando optativas...");
    this.assignOptativeBlocks(app, blocks, summary);
    await notify(5, "Asignando recursamientos...");
    this.assignRecursamientoBlocks(app, blocks, homeRooms, summary);
    await notify(6, "Aplicando asignacion de respaldo...");
    this.assignFallbackBlocks(app, blocks, summary);

    summary.asignados = blocks.filter((block) => !!block.aulaId).length;
    summary.sinAula = blocks.length - summary.asignados;
    return summary;
  },

  normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  },

  getPeriodo(app) {
    return this.normalizeText(app.data?.meta?.periodo || "par") || "par";
  },

  isPeriodoPar(app) {
    return this.getPeriodo(app) === "par";
  },

  getCycleOrder(app) {
    if (this.isPeriodoPar(app)) {
      return {
        structureGrades: [2, 4, 6],
        recursamientoGrades: [1, 3, 5],
      };
    }

    return {
      structureGrades: [1, 3, 5],
      recursamientoGrades: [2, 4, 6],
    };
  },

  getCycleNameForGrade(grado) {
    if (grado === 1 || grado === 2) return "primer_ciclo";
    if (grado === 3 || grado === 4) return "segundo_ciclo";
    if (grado === 5 || grado === 6) return "tercer_ciclo";
    return "general";
  },

  getNormalRooms(app) {
    return (app.data.aulas || []).filter((aula) => aula.tipo === "normal");
  },

  getNormalRoomsByCycle(app) {
    const normals = this.getNormalRooms(app);
    const byId = new Map(normals.map((aula) => [aula.id, aula]));
    const pick = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
    const getRoomNumber = (aula) => {
      const match = String(aula?.nombre || "").match(/(\d+)/);
      return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
    };

    return {
      primer_ciclo: pick(["a15", "a14", "a13", "a12", "a11", "a10", "a9"]),
      segundo_ciclo: pick(["a4", "a5", "a6", "a7", "a8"]),
      tercer_ciclo: pick(["a1", "a2", "a3"]),
      todas: [...normals].sort((a, b) => getRoomNumber(a) - getRoomNumber(b)),
    };
  },

  getTurno(grupo) {
    return grupo?.turno === "vespertino" ? "vespertino" : "matutino";
  },

  createHomeRoomRegistry(app) {
    return {
      matutino: new Set(),
      vespertino: new Set(),
      grupoAula: new Map(),
      roomPool: this.getNormalRoomsByCycle(app),
    };
  },

  buildBlocks(app) {
    const sessions = [...(app.horario.sesiones || [])].sort((a, b) => {
      const groupA = app.data.grupos.find((grupo) => grupo.id === a.grupoId)?.nombre || "";
      const groupB = app.data.grupos.find((grupo) => grupo.id === b.grupoId)?.nombre || "";
      if (groupA !== groupB) return groupA.localeCompare(groupB, "es");
      if (a.dia !== b.dia) return a.dia - b.dia;
      if (a.hora !== b.hora) return a.hora - b.hora;
      if (a.asignaturaId !== b.asignaturaId) {
        return String(a.asignaturaId).localeCompare(String(b.asignaturaId), "es");
      }
      if (a.profesorId !== b.profesorId) {
        return String(a.profesorId).localeCompare(String(b.profesorId), "es");
      }
      return String(a.tipoSesion || "clase").localeCompare(
        String(b.tipoSesion || "clase"),
        "es",
      );
    });

    const blocks = [];
    sessions.forEach((sesion) => {
      const grupo = app.data.grupos.find((item) => item.id === sesion.grupoId) || null;
      const asignatura =
        app.data.asignaturas.find((item) => item.id === sesion.asignaturaId) || null;
      const last = blocks[blocks.length - 1];

      if (
        last &&
        last.grupoId === sesion.grupoId &&
        last.asignaturaId === sesion.asignaturaId &&
        last.profesorId === sesion.profesorId &&
        last.dia === sesion.dia &&
        last.tipoSesion === (sesion.tipoSesion || "clase") &&
        last.hours[last.hours.length - 1] + 1 === sesion.hora
      ) {
        last.hours.push(sesion.hora);
        last.sessions.push(sesion);
        return;
      }

      blocks.push({
        grupoId: sesion.grupoId,
        grupo,
        asignaturaId: sesion.asignaturaId,
        asignatura,
        profesorId: sesion.profesorId,
        dia: sesion.dia,
        tipoSesion: sesion.tipoSesion || "clase",
        turno: this.getTurno(grupo),
        hours: [sesion.hora],
        sessions: [sesion],
        aulaId: null,
      });
    });

    return blocks;
  },

  isRoomAvailable(app, roomId, day, hours) {
    if (!roomId) return false;
    return hours.every((hour) => {
      const blocked = app.horario.hasBloqueo?.("AULA", roomId, day, hour);
      if (blocked) return false;

      return !app.horario.sesiones.some(
        (sesion) => sesion.aulaId === roomId && sesion.dia === day && sesion.hora === hour,
      );
    });
  },

  assignBlockToRoom(block, roomId) {
    block.aulaId = roomId;
    block.sessions.forEach((sesion) => {
      sesion.aulaId = roomId;
    });
  },

  tryAssignBlock(app, block, roomIds) {
    for (const roomId of roomIds) {
      if (this.isRoomAvailable(app, roomId, block.dia, block.hours)) {
        this.assignBlockToRoom(block, roomId);
        return roomId;
      }
    }
    return null;
  },

  getSpecialRoomId(block) {
    const academiaId = block.asignatura?.academiaId;
    if (academiaId === "computacion") return "computo";
    if (academiaId === "artes") return "artes";
    if (academiaId === "musica") return "musica";
    return null;
  },

  isOptativeBlock(block) {
    const subjectId = this.normalizeText(block.asignatura?.id);
    const subjectName = this.normalizeText(block.asignatura?.nombre);
    return (
      subjectName.startsWith("optativa ") ||
      subjectId.startsWith("optativa_") ||
      subjectId.includes("_opt") ||
      subjectName.includes(" opt")
    );
  },

  isRegularClassroomBlock(block) {
    if (!block?.asignatura) return false;
    if (block.tipoSesion === "laboratorio") return false;
    if (this.getSpecialRoomId(block)) return false;
    return true;
  },

  getPreferredCycleRoomIds(app, grado) {
    const pool = this.getNormalRoomsByCycle(app);
    const cycleName = this.getCycleNameForGrade(grado);
    const cycleRooms = pool[cycleName] || [];
    return cycleRooms.map((aula) => aula.id);
  },

  getAllNormalRoomIds(app) {
    return this.getNormalRoomsByCycle(app).todas.map((aula) => aula.id);
  },

  getFreeHomeRoom(registry, turno, preferredRoomIds, fallbackRoomIds = []) {
    const used = registry[turno];
    const orderedIds = [...preferredRoomIds, ...fallbackRoomIds].filter(
      (roomId, index, list) => roomId && list.indexOf(roomId) === index,
    );

    const chosen = orderedIds.find((roomId) => !used.has(roomId)) || null;
    if (!chosen) return null;

    used.add(chosen);
    return chosen;
  },

  getGroupsByGrades(app, grades) {
    const gradeSet = new Set(grades);
    return (app.data.grupos || [])
      .filter((grupo) => gradeSet.has(grupo.grado))
      .sort((a, b) => {
        if (a.grado !== b.grado) return a.grado - b.grado;
        if (a.turno !== b.turno) return a.turno.localeCompare(b.turno, "es");
        return a.nombre.localeCompare(b.nombre, "es");
      });
  },

  reserveHomeRoomsForGroups(app, groups, registry) {
    groups.forEach((grupo) => {
      const preferred = this.getPreferredCycleRoomIds(app, grupo.grado);
      const fallback = this.getAllNormalRoomIds(app);
      const roomId = this.getFreeHomeRoom(registry, this.getTurno(grupo), preferred, fallback);
      if (roomId) {
        registry.grupoAula.set(grupo.id, roomId);
      }
    });
  },

  assignHomeRoomBlocks(app, blocks, groups, registry, summary, summaryKey) {
    const allowedGroups = new Set(groups.map((grupo) => grupo.id));

    blocks
      .filter((block) => !block.aulaId)
      .filter((block) => allowedGroups.has(block.grupoId))
      .filter((block) => this.isRegularClassroomBlock(block))
      .filter((block) => !this.isOptativeBlock(block))
      .forEach((block) => {
        const roomId = registry.grupoAula.get(block.grupoId);
        if (!roomId) return;
        if (!this.isRoomAvailable(app, roomId, block.dia, block.hours)) return;
        this.assignBlockToRoom(block, roomId);
        summary[summaryKey] += 1;
      });
  },

  assignSpecialBlocks(app, blocks, summary) {
    blocks
      .filter((block) => !block.aulaId)
      .filter((block) => block.tipoSesion !== "laboratorio")
      .forEach((block) => {
        const roomId = this.getSpecialRoomId(block);
        if (!roomId) return;

        if (this.tryAssignBlock(app, block, [roomId])) {
          summary.especiales += 1;
        }
      });
  },

  assignLabBlocks(app, blocks, summary) {
    const labs = (app.data.aulas || [])
      .filter((aula) => aula.tipo === "laboratorio")
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .map((aula) => aula.id);

    blocks
      .filter((block) => !block.aulaId)
      .filter((block) => block.tipoSesion === "laboratorio")
      .forEach((block) => {
        const preferredLabs = ["lab1", "lab2"].filter((roomId) => labs.includes(roomId));
        const fallbackLabs = labs.filter((roomId) => !preferredLabs.includes(roomId));
        if (this.tryAssignBlock(app, block, [...preferredLabs, ...fallbackLabs])) {
          summary.laboratorios += 1;
        }
      });
  },

  assignStructureBlocks(app, blocks, registry, summary) {
    const { structureGrades } = this.getCycleOrder(app);
    const structureGroups = this.getGroupsByGrades(app, structureGrades);
    this.reserveHomeRoomsForGroups(app, structureGroups, registry);
    this.assignHomeRoomBlocks(
      app,
      blocks,
      structureGroups,
      registry,
      summary,
      "estructura",
    );
  },

  assignOptativeBlocks(app, blocks, summary) {
    const preferredRooms = this.getNormalRoomsByCycle(app).tercer_ciclo.map((aula) => aula.id);
    const fallbackRooms = this.getAllNormalRoomIds(app);

    blocks
      .filter((block) => !block.aulaId)
      .filter((block) => this.isOptativeBlock(block))
      .forEach((block) => {
        const specialRoomId = this.getSpecialRoomId(block);
        const orderedRooms = [
          ...(specialRoomId ? [specialRoomId] : []),
          ...preferredRooms,
          ...fallbackRooms,
        ].filter((roomId, index, list) => roomId && list.indexOf(roomId) === index);

        if (this.tryAssignBlock(app, block, orderedRooms)) {
          summary.optativas += 1;
        }
      });
  },

  assignRecursamientoBlocks(app, blocks, registry, summary) {
    const { recursamientoGrades } = this.getCycleOrder(app);
    const recursamientoGroups = this.getGroupsByGrades(app, recursamientoGrades);
    this.reserveHomeRoomsForGroups(app, recursamientoGroups, registry);
    this.assignHomeRoomBlocks(
      app,
      blocks,
      recursamientoGroups,
      registry,
      summary,
      "recursamiento",
    );
  },

  assignFallbackBlocks(app, blocks, summary) {
    blocks
      .filter((block) => !block.aulaId)
      .filter((block) => block.tipoSesion !== "laboratorio")
      .forEach((block) => {
        const preferredRooms = this.getPreferredCycleRoomIds(app, block.grupo?.grado);
        const fallbackRooms = this.getAllNormalRoomIds(app);
        if (this.tryAssignBlock(app, block, [...preferredRooms, ...fallbackRooms])) {
          summary.fallback += 1;
        }
      });
  },
};
