const AcademyView = {
  renderGrid(app, academia) {
    const isAll = academia?.id === "__ALL__";

    app.horario.bloqueos
      ?.filter((b) => {
        if (isAll) return b.scope === "ACADEMIA";
        return b.scope === "ACADEMIA" && b.targetId === academia.id;
      })
      .forEach((b) => {
        const content = `<div class="session-info"><strong>X</strong> <small>${b.motivo || "Bloqueado"}</small></div>`;
        Views.updateCell(b.dia, b.hora, content, "#eeeeee", false);
      });

    const asigIds = app.data.asignaturas
      .filter((a) => a.academiaId === academia.id)
      .map((a) => a.id);

    const blocks = Views.buildContiguousBlocks(
      app.horario.sesiones.filter((s) => asigIds.includes(s.asignaturaId)),
      (sesion) =>
        [
          sesion.asignaturaId,
          sesion.grupoId,
          sesion.profesorId,
          sesion.tipoSesion || "clase",
        ].join("|"),
    )
      .map((block) => {
        const s = block.entries[0];
        const grupo = app.data.grupos.find((g) => g.id === s.grupoId);
        const asig = app.data.asignaturas.find((a) => a.id === s.asignaturaId);
        const prof = app.data.profesores.find((p) => p.id === s.profesorId);
        const endLabel =
          app.hours[block.endHour + 1] || app.hours[block.endHour] || "";

        const content = `
          <div class="session-info">
            <strong>${asig ? asig.nombre : "???"}</strong>
            <small class="session-line">${app.hours[block.startHour]} - ${endLabel}</small>
            <small class="session-line">${grupo ? grupo.nombre : "???"} - ${prof ? prof.nombre : "???"}</small>
          </div>
        `;

        const alreadyBlocked = block.entries.some((entry) =>
          app.horario.isBlocked?.("ACADEMIA", academia.id, entry.dia, entry.hora),
        );
        return alreadyBlocked ?
            null
          : {
              dia: block.dia,
              startHour: block.startHour,
              endHour: block.endHour,
              content,
              color: "#e8f5e9",
              isConflict: false,
            };
      })
      .filter(Boolean);

    Views.renderMergedBlocks(blocks);
  },

  handleCellClick(app, academia, day, hour) {
    const isAll = academia?.id === "__ALL__";
    if (isAll) {
      for (const a of app.data.academias) {
        app.horario.toggleBloqueo("ACADEMIA", a.id, day, hour, "Juntas/PAT");
      }
      app.refreshGrid();
      return;
    }

    app.horario.toggleBloqueo(
      "ACADEMIA",
      academia.id,
      day,
      hour,
      "Bloqueado",
    );
    app.refreshGrid();
  },
};
