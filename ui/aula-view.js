const AulaView = {
  select(app, aula) {
    app.currentView = { type: "AULA", entity: aula };
    app.updateTitle();
    app.refreshGrid();
  },

  renderList(app) {
    const activeId =
      app.currentView?.type === "AULA" ? app.currentView?.entity?.id : null;

    Views.renderList(
      "aulas-list",
      app.data.aulas || [],
      "nombre",
      (aula) => this.select(app, aula),
      activeId,
    );
  },

  renderGrid(app, aula) {
    Views.resetVisibleHours?.();

    const sesiones = app.horario
      .getSesionesByAula?.(aula.id)
      .slice()
      .sort((a, b) => {
        if (a.dia !== b.dia) return a.dia - b.dia;
        if (a.hora !== b.hora) return a.hora - b.hora;
        return String(a.grupoId).localeCompare(String(b.grupoId), "es");
      });

    const blocks = Views.buildContiguousBlocks(
      sesiones,
      (sesion) =>
        [
          sesion.aulaId,
          sesion.grupoId,
          sesion.asignaturaId,
          sesion.profesorId,
          sesion.tipoSesion || "clase",
        ].join("|"),
    ).map((block) => {
      const sesion = block.entries[0];
      const grupo = app.data.grupos.find((item) => item.id === sesion.grupoId);
      const asignatura = app.data.asignaturas.find(
        (item) => item.id === sesion.asignaturaId,
      );
      const profesor = app.data.profesores.find((item) => item.id === sesion.profesorId);
      const endLabel =
        app.hours[block.endHour + 1] || app.hours[block.endHour] || "";

      const conflict = block.entries.some((current) =>
        app.horario.sesiones.some(
          (item) =>
            item !== current &&
            item.aulaId === current.aulaId &&
            item.dia === current.dia &&
            item.hora === current.hora,
        ),
      );

      const content = `
        <div class="session-info">
          <strong>${grupo?.nombre || "???"}</strong>
          <small class="session-line">${app.hours[block.startHour]} - ${endLabel}</small>
          <small class="session-line">${asignatura?.nombre || "Sin asignatura"}</small>
          <small class="session-line session-meta-optional">${profesor?.nombre || "Sin profesor"}</small>
        </div>
      `;

      return {
        dia: block.dia,
        startHour: block.startHour,
        endHour: block.endHour,
        content,
        color: conflict ? "#ffcdd2" : "#e3f2fd",
        isConflict: conflict,
      };
    });

    Views.renderMergedBlocks(blocks);

    (app.horario.bloqueos || [])
      .filter((bloqueo) => bloqueo.scope === "AULA" && bloqueo.targetId === aula.id)
      .forEach((bloqueo) => {
        Views.renderBloqueo?.(bloqueo.dia, bloqueo.hora, bloqueo.motivo || "Bloqueado");
      });
  },
};
