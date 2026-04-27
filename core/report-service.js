const ReportService = {
  exportGruposHTML(app) {
    const html = this.buildDocument(
      "Horarios por grupo",
      (app.data.grupos || [])
        .slice()
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        .map((grupo) => this.buildGroupSection(app, grupo))
        .join("\n"),
    );

    this.downloadTextFile("Grupos.html", html, "text/html;charset=utf-8");
    this.openPrintPreview(html, "Horarios por grupo");
  },

  exportProfesoresHTML(app) {
    const html = this.buildDocument(
      "Horarios por profesor",
      (app.data.profesores || [])
        .filter((profesor) => profesor.activo !== false)
        .slice()
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        .map((profesor) => this.buildTeacherSection(app, profesor))
        .join("\n"),
    );

    this.downloadTextFile("Profesores.html", html, "text/html;charset=utf-8");
    this.openPrintPreview(html, "Horarios por profesor");
  },

  exportEscolaresTXT(app) {
    const lines = [];

    (app.data.grupos || [])
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .forEach((grupo) => {
        lines.push(grupo.nombre);

        const sesiones = app.horario.sesiones
          .filter((sesion) => sesion.grupoId === grupo.id)
          .sort((a, b) => {
            if (a.dia !== b.dia) return a.dia - b.dia;
            if (a.hora !== b.hora) return a.hora - b.hora;
            return String(a.asignaturaId).localeCompare(String(b.asignaturaId), "es");
          });

        const blocks = this.buildBlocksFromSessions(sesiones);
        blocks.forEach((block) => {
          const asignatura =
            app.data.asignaturas.find((item) => item.id === block.asignaturaId)?.nombre ||
            block.asignaturaId;
          const profesor =
            app.data.profesores.find((item) => item.id === block.profesorId)?.nombre ||
            block.profesorId;
          const aula =
            app.data.aulas.find((item) => item.id === block.aulaId)?.nombre ||
            (block.aulaId ? block.aulaId : "Sin aula");

          lines.push(
            [
              this.getDayLabel(block.dia),
              `${app.hours[block.startHour]}-${app.hours[block.endHour + 1] || ""}`.replace(/-$/, ""),
              asignatura,
              profesor,
              aula,
            ].join(" | "),
          );
        });

        lines.push("");
      });

    this.downloadTextFile(
      "Escolares.txt",
      lines.join("\n"),
      "text/plain;charset=utf-8",
    );
  },

  buildDocument(title, bodyContent) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1 { margin-bottom: 20px; }
    h2, h3 { margin: 0 0 8px; }
    .page { page-break-before: always; margin-bottom: 32px; }
    .page:first-of-type { page-break-before: auto; }
    .meta { margin-bottom: 12px; color: #444; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #444; padding: 6px; vertical-align: top; text-align: center; }
    th { background: #efefef; }
    .hour-col { width: 88px; font-weight: bold; }
    .cell-main { font-weight: bold; }
    .cell-sub { display: block; font-size: 12px; margin-top: 4px; }
    @media print {
      body { margin: 0; }
      .page { break-before: page; }
      .page:first-of-type { break-before: auto; }
    }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  ${bodyContent}
</body>
</html>`;
  },

  buildGroupSection(app, grupo) {
    const loadSummary = GroupService.getGroupLoadSummary(app, grupo.id);
    const subtitle =
      `${grupo.nombre} - ${this.capitalize(grupo.turno || "")} | ` +
      `Dias ocupados: ${loadSummary.occupiedDays} | ` +
      `Brecha diaria: ${loadSummary.balanceGap} | ` +
      `LOCK: ${loadSummary.lockedSegments}`;
    const grid = this.buildGroupGrid(app, grupo);
    return this.buildGridSection(subtitle, `Grupo ${this.escapeHtml(grupo.nombre)}`, grid);
  },

  buildTeacherSection(app, profesor) {
    const academia =
      app.data.academias.find((item) => item.id === profesor.academiaId)?.nombre ||
      "Sin academia";
    const loadSummary = GroupService.getProfesorLoadSummary(app, profesor.id);
    const academiaSummary = GroupService.getAcademiaLoadSummary(app, profesor.academiaId);
    const subtitle =
      `${profesor.nombre} - ${academia} | ` +
      `Grupos: ${loadSummary.grupos} | ` +
      `Materias: ${loadSummary.asignaciones} | ` +
      `Segmentos: ${loadSummary.segmentosProgramados} | ` +
      `Brecha academia: ${academiaSummary.brechaSegmentos}`;
    const grid = this.buildTeacherGrid(app, profesor);
    return this.buildGridSection(subtitle, `Profesor ${this.escapeHtml(profesor.nombre)}`, grid);
  },

  buildGridSection(subtitle, heading, grid) {
    const rowsHtml = this.renderGridRows(grid);
    return `
      <section class="page">
        <h2>${this.escapeHtml(heading)}</h2>
        <div class="meta">${this.escapeHtml(subtitle)}</div>
        <table>
          <thead>
            <tr>
              <th class="hour-col">Hora</th>
              <th>Lunes</th>
              <th>Martes</th>
              <th>Miercoles</th>
              <th>Jueves</th>
              <th>Viernes</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </section>
    `;
  },

  buildGroupGrid(app, grupo) {
    const sessionMap = new Map();
    app.horario.sesiones
      .filter((sesion) => sesion.grupoId === grupo.id)
      .forEach((sesion) => {
        const key = `${sesion.dia}|${sesion.hora}`;
        const asignatura =
          app.data.asignaturas.find((item) => item.id === sesion.asignaturaId)?.nombre ||
          sesion.asignaturaId;
        const profesor =
          app.data.profesores.find((item) => item.id === sesion.profesorId)?.nombre ||
          sesion.profesorId;
        const aula =
          app.data.aulas.find((item) => item.id === sesion.aulaId)?.nombre ||
          (sesion.aulaId ? sesion.aulaId : "");

        sessionMap.set(key, {
          main: asignatura,
          subs: [
            profesor,
            aula,
          ].filter(Boolean),
          trackId: [
            sesion.grupoId,
            sesion.asignaturaId,
            sesion.profesorId,
            sesion.aulaId || "",
            sesion.tipoSesion || "clase",
            sesion.dia,
          ].join("|"),
        });
      });

    return this.buildRenderGrid(app, grupo.turno, sessionMap);
  },

  buildTeacherGrid(app, profesor) {
    const sessionMap = new Map();
    app.horario.sesiones
      .filter((sesion) => sesion.profesorId === profesor.id)
      .forEach((sesion) => {
        const key = `${sesion.dia}|${sesion.hora}`;
        const grupo =
          app.data.grupos.find((item) => item.id === sesion.grupoId)?.nombre ||
          sesion.grupoId;
        const asignatura =
          app.data.asignaturas.find((item) => item.id === sesion.asignaturaId)?.nombre ||
          sesion.asignaturaId;
        const aula =
          app.data.aulas.find((item) => item.id === sesion.aulaId)?.nombre ||
          (sesion.aulaId ? sesion.aulaId : "");

        sessionMap.set(key, {
          main: asignatura,
          subs: [
            grupo,
            aula,
          ].filter(Boolean),
          trackId: [
            sesion.profesorId,
            sesion.grupoId,
            sesion.asignaturaId,
            sesion.aulaId || "",
            sesion.tipoSesion || "clase",
            sesion.dia,
          ].join("|"),
        });
      });

    return this.buildRenderGrid(app, profesor.turno, sessionMap);
  },

  buildRenderGrid(app, turno, sessionMap) {
    const hourIndices = this.getVisibleHourIndices(app, turno);
    const dayCount = 5;
    const skip = new Set();
    const rows = [];

    hourIndices.forEach((hourIndex) => {
      const row = {
        hourLabel: app.hours[hourIndex],
        cells: [],
      };

      for (let day = 0; day < dayCount; day += 1) {
        const cellKey = `${day}|${hourIndex}`;
        if (skip.has(cellKey)) continue;

        const entry = sessionMap.get(cellKey);
        if (!entry) {
          row.cells.push({ empty: true });
          continue;
        }

        let rowspan = 1;
        for (let next = hourIndex + 1; hourIndices.includes(next); next += 1) {
          const nextEntry = sessionMap.get(`${day}|${next}`);
          if (!nextEntry || nextEntry.trackId !== entry.trackId) break;
          rowspan += 1;
          skip.add(`${day}|${next}`);
        }

        row.cells.push({
          empty: false,
          rowspan,
          main: entry.main,
          subs: entry.subs,
        });
      }

      rows.push(row);
    });

    return rows;
  },

  renderGridRows(rows) {
    return rows
      .map((row) => {
        const cells = row.cells
          .map((cell) => {
            if (cell.empty) return "<td></td>";
            const subHtml = cell.subs
              .map((item) => `<span class="cell-sub">${this.escapeHtml(item)}</span>`)
              .join("");
            return `<td rowspan="${cell.rowspan}"><div class="cell-main">${this.escapeHtml(
              cell.main,
            )}</div>${subHtml}</td>`;
          })
          .join("");

        return `<tr><td class="hour-col">${this.escapeHtml(row.hourLabel)}</td>${cells}</tr>`;
      })
      .join("\n");
  },

  buildBlocksFromSessions(sesiones) {
    const blocks = [];
    sesiones.forEach((sesion) => {
      const last = blocks[blocks.length - 1];
      if (
        last &&
        last.grupoId === sesion.grupoId &&
        last.asignaturaId === sesion.asignaturaId &&
        last.profesorId === sesion.profesorId &&
        last.aulaId === (sesion.aulaId || null) &&
        last.tipoSesion === (sesion.tipoSesion || "clase") &&
        last.dia === sesion.dia &&
        last.endHour + 1 === sesion.hora
      ) {
        last.endHour = sesion.hora;
        return;
      }

      blocks.push({
        grupoId: sesion.grupoId,
        asignaturaId: sesion.asignaturaId,
        profesorId: sesion.profesorId,
        aulaId: sesion.aulaId || null,
        tipoSesion: sesion.tipoSesion || "clase",
        dia: sesion.dia,
        startHour: sesion.hora,
        endHour: sesion.hora,
      });
    });

    return blocks;
  },

  getVisibleHourIndices(app, turno) {
    const inicio = turno === "vespertino" ? "14:00" : "08:00";
    const fin = turno === "vespertino" ? "20:00" : "14:00";

    return app.hours
      .map((label, index) => ({ label, index }))
      .filter(({ label }) => label >= inicio && label < fin)
      .map(({ index }) => index);
  },

  formatSessionKind(tipoSesion) {
    if (tipoSesion === "laboratorio") return "Laboratorio";
    if (tipoSesion === "estudio") return "Estudio";
    return "Clase";
  },

  getDayLabel(day) {
    return ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"][day] || "";
  },

  capitalize(text) {
    const value = String(text || "");
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  },

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  },

  downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  openPrintPreview(html, title) {
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.title = title;
    printWindow.document.close();
  },
};
