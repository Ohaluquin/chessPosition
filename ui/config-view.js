const ConfigView = {
  dayOptions: [
    ["lunes", "Lu"],
    ["martes", "Ma"],
    ["miercoles", "Mi"],
    ["jueves", "Ju"],
    ["viernes", "Vi"],
  ],

  clone(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  },

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },

  toMinutes(value) {
    const [hour, minute] = String(value || "00:00").split(":").map(Number);
    return hour * 60 + minute;
  },

  getSlotDuration(slot) {
    if (Number(slot?.duracionMin) > 0) return Number(slot.duracionMin);
    if (Rules.isValidTime(slot?.inicio) && Rules.isValidTime(slot?.fin)) {
      return Math.max(0, this.toMinutes(slot.fin) - this.toMinutes(slot.inicio));
    }
    return 90;
  },

  slotSignature(slot) {
    return JSON.stringify({
      id: slot?.id || "",
      nombre: slot?.nombre || "",
      periodo: slot?.periodo || "",
      gradoObjetivo: slot?.gradoObjetivo == null ? null : Number(slot.gradoObjetivo),
      turno: slot?.turno || "",
      inicio: slot?.inicio || "",
      duracionMin: this.getSlotDuration(slot),
      dias: (slot?.dias || []).map(Rules.normalizeText).sort(),
      activa: slot?.activa !== false,
    });
  },

  open(app) {
    if (!(app.data?.grupos || []).length && !(app.data?.profesores || []).length) {
      alert("Carga una plantilla o importa un JSON antes de editar la configuración.");
      return;
    }

    this.app = app;
    this.previousData = this.clone(app.data);
    const meta = app.data.meta || {};
    const setValue = (id, value) => {
      const input = document.getElementById(id);
      if (input) input.value = value ?? "";
    };
    setValue("config-name", meta.nombre || "Horario de trabajo");
    setValue("config-period", meta.periodo === "par" ? "par" : "impar");

    ["matutino", "vespertino"].forEach((turno) => {
      const groupWindow = Rules.getConfiguredTimeWindow(app.data, "grupo", turno);
      const professorWindow = Rules.getConfiguredTimeWindow(app.data, "profesor", turno);
      setValue(`config-group-${turno}-start`, groupWindow.inicio);
      setValue(`config-group-${turno}-end`, groupWindow.fin);
      setValue(`config-professor-${turno}-start`, professorWindow.inicio);
      setValue(`config-professor-${turno}-end`, professorWindow.fin);
    });

    this.renderOptativeSlots(app.data.franjasOptativas || []);
    this.renderFixedRules(app.data.reglasFijas || []);
    Dialogs.open("dialog-config");
  },

  renderOptativeSlots(slots) {
    const host = document.getElementById("config-optative-list");
    if (!host) return;
    host.innerHTML = "";
    slots.forEach((slot) => this.addOptativeSlot(slot));
    if (slots.length === 0) this.updateEmptyState(host, "No hay franjas configuradas.");
  },

  addOptativeSlot(slot = null) {
    const host = document.getElementById("config-optative-list");
    if (!host) return;
    host.querySelector(".config-empty")?.remove();
    const index = host.children.length + 1;
    const item = document.createElement("article");
    item.className = "config-card config-optative-item";
    item.dataset.originalId = slot?.id || "";
    item.dataset.motivo = slot?.motivo || "";
    const days = new Set((slot?.dias || []).map((day) => Rules.normalizeText(day)));
    const period = slot?.periodo || "";
    const turn = slot?.turno || "";
    item.innerHTML = `
      <div class="config-card-head">
        <strong>Franja optativa</strong>
        <button type="button" class="btn-danger config-remove">Eliminar</button>
      </div>
      <div class="config-fields config-fields-optative">
        <label>ID
          <input data-field="id" type="text" value="${this.escapeHtml(slot?.id || `opt_nueva_${index}`)}" ${slot?.id ? "readonly" : ""}>
        </label>
        <label>Nombre
          <input data-field="nombre" type="text" value="${this.escapeHtml(slot?.nombre || `Nueva franja ${index}`)}">
        </label>
        <label>Periodo
          <select data-field="periodo">
            <option value=""${period === "" ? " selected" : ""}>Cualquiera</option>
            <option value="impar"${period === "impar" ? " selected" : ""}>Impar</option>
            <option value="par"${period === "par" ? " selected" : ""}>Par</option>
          </select>
        </label>
        <label>Grado
          <input data-field="gradoObjetivo" type="number" min="1" max="6" value="${this.escapeHtml(slot?.gradoObjetivo ?? "")}" placeholder="Cualquiera">
        </label>
        <label>Turno
          <select data-field="turno">
            <option value=""${turn === "" ? " selected" : ""}>Cualquiera</option>
            <option value="matutino"${turn === "matutino" ? " selected" : ""}>Matutino</option>
            <option value="vespertino"${turn === "vespertino" ? " selected" : ""}>Vespertino</option>
          </select>
        </label>
        <label>Inicio
          <input data-field="inicio" type="time" value="${this.escapeHtml(slot?.inicio || "08:00")}">
        </label>
        <label>Duración (min)
          <input data-field="duracionMin" type="number" min="30" step="30" value="${this.escapeHtml(this.getSlotDuration(slot))}">
        </label>
        <label class="config-check-label">
          <input data-field="activa" type="checkbox" ${slot?.activa === false ? "" : "checked"}> Activa
        </label>
      </div>
      <div class="config-days" aria-label="Días permitidos">
        <span>Días:</span>
        ${this.dayOptions
          .map(
            ([value, label]) => `
              <label><input data-day type="checkbox" value="${value}" ${days.has(value) ? "checked" : ""}> ${label}</label>
            `,
          )
          .join("")}
      </div>
    `;
    item.querySelector(".config-remove").onclick = () => {
      item.remove();
      if (host.children.length === 0) this.updateEmptyState(host, "No hay franjas configuradas.");
    };
    host.appendChild(item);
  },

  renderFixedRules(rules) {
    const host = document.getElementById("config-rules-list");
    if (!host) return;
    host.innerHTML = "";
    rules.forEach((rule) => this.addFixedRule(rule));
    if (rules.length === 0) this.updateEmptyState(host, "No hay reglas fijas configuradas.");
  },

  addFixedRule(rule = null) {
    const host = document.getElementById("config-rules-list");
    if (!host) return;
    host.querySelector(".config-empty")?.remove();
    const index = host.children.length + 1;
    const item = document.createElement("article");
    item.className = "config-card config-rule-item";
    const scope = rule?.scope || "GRUPO";
    const day = Rules.normalizeText(rule?.dia || "lunes");
    const turn = rule?.filters?.turno || "";
    const academy = rule?.filters?.academiaId || "";
    const classroom = rule?.filters?.aulaId || "";
    item.innerHTML = `
      <div class="config-card-head">
        <strong>Regla fija</strong>
        <button type="button" class="btn-danger config-remove">Eliminar</button>
      </div>
      <div class="config-fields config-fields-rule">
        <label>ID
          <input data-field="id" type="text" value="${this.escapeHtml(rule?.id || `regla_nueva_${index}`)}">
        </label>
        <label>Ámbito
          <select data-field="scope">
            ${["GRUPO", "PROFESOR", "ACADEMIA", "AULA"]
              .map((value) => `<option value="${value}"${scope === value ? " selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </label>
        <label>Día
          <select data-field="dia">
            ${this.dayOptions
              .map(([value]) => `<option value="${value}"${day === value ? " selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </label>
        <label>Inicio
          <input data-field="inicio" type="time" value="${this.escapeHtml(rule?.inicio || "08:00")}">
        </label>
        <label>Fin
          <input data-field="fin" type="time" value="${this.escapeHtml(rule?.fin || "09:00")}">
        </label>
        <label>Motivo
          <input data-field="motivo" type="text" value="${this.escapeHtml(rule?.motivo || "Bloqueado")}">
        </label>
        <label>Turno (filtro)
          <select data-field="filterTurno">
            <option value=""${turn === "" ? " selected" : ""}>Todos</option>
            <option value="matutino"${turn === "matutino" ? " selected" : ""}>Matutino</option>
            <option value="vespertino"${turn === "vespertino" ? " selected" : ""}>Vespertino</option>
          </select>
        </label>
        <label>Academia (filtro)
          <select data-field="filterAcademia">
            <option value="">Todas</option>
            ${(this.app?.data?.academias || [])
              .filter((entry) => entry.id !== "__ALL__")
              .map(
                (entry) =>
                  `<option value="${this.escapeHtml(entry.id)}"${academy === entry.id ? " selected" : ""}>${this.escapeHtml(entry.nombre)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>Grado (filtro)
          <input data-field="filterGrado" type="number" min="1" max="6" value="${this.escapeHtml(rule?.filters?.grado ?? "")}" placeholder="Todos">
        </label>
        <label>Aula (filtro)
          <select data-field="filterAula">
            <option value="">Todas</option>
            ${(this.app?.data?.aulas || [])
              .map(
                (entry) =>
                  `<option value="${this.escapeHtml(entry.id)}"${classroom === entry.id ? " selected" : ""}>${this.escapeHtml(entry.nombre)}</option>`,
              )
              .join("")}
          </select>
        </label>
      </div>
    `;
    item.querySelector(".config-remove").onclick = () => {
      item.remove();
      if (host.children.length === 0) this.updateEmptyState(host, "No hay reglas fijas configuradas.");
    };
    host.appendChild(item);
  },

  updateEmptyState(host, message) {
    const empty = document.createElement("p");
    empty.className = "config-empty";
    empty.textContent = message;
    host.appendChild(empty);
  },

  field(item, name) {
    return item.querySelector(`[data-field="${name}"]`);
  },

  readWindow(prefix, label) {
    const inicio = document.getElementById(`${prefix}-start`)?.value || "";
    const fin = document.getElementById(`${prefix}-end`)?.value || "";
    if (!Rules.isValidTime(inicio) || !Rules.isValidTime(fin) || inicio >= fin) {
      throw new Error(`Revisa el horario de ${label}: la hora inicial debe ser menor que la final.`);
    }
    return { inicio, fin };
  },

  collectOptativeSlots() {
    const slots = [...document.querySelectorAll(".config-optative-item")].map((item) => {
      const id = this.field(item, "id").value.trim();
      const nombre = this.field(item, "nombre").value.trim();
      const inicio = this.field(item, "inicio").value;
      const duracionMin = Number(this.field(item, "duracionMin").value);
      const dias = [...item.querySelectorAll("[data-day]:checked")].map((input) => input.value);
      if (!id || !nombre) throw new Error("Cada franja necesita ID y nombre.");
      if (!Rules.isValidTime(inicio) || !Number.isFinite(duracionMin) || duracionMin <= 0) {
        throw new Error(`Revisa el inicio y la duración de la franja ${nombre}.`);
      }
      if (dias.length === 0) throw new Error(`Selecciona al menos un día para ${nombre}.`);
      const gradoRaw = this.field(item, "gradoObjetivo").value;
      return {
        id,
        nombre,
        periodo: this.field(item, "periodo").value || undefined,
        gradoObjetivo: gradoRaw === "" ? undefined : Number(gradoRaw),
        turno: this.field(item, "turno").value || undefined,
        inicio,
        duracionMin,
        dias,
        motivo: item.dataset.motivo || `Optativa - ${nombre}`,
        activa: this.field(item, "activa").checked,
      };
    });
    this.assertUniqueIds(slots, "franjas optativas");
    return slots.map((slot) => Object.fromEntries(Object.entries(slot).filter(([, value]) => value !== undefined)));
  },

  collectFixedRules() {
    const rules = [...document.querySelectorAll(".config-rule-item")].map((item) => {
      const id = this.field(item, "id").value.trim();
      const inicio = this.field(item, "inicio").value;
      const fin = this.field(item, "fin").value;
      if (!id) throw new Error("Cada regla fija necesita un ID.");
      if (!Rules.isValidTime(inicio) || !Rules.isValidTime(fin) || inicio >= fin) {
        throw new Error(`Revisa el intervalo de la regla ${id}.`);
      }
      const filters = {};
      const turno = this.field(item, "filterTurno").value;
      const academiaId = this.field(item, "filterAcademia").value;
      const grado = this.field(item, "filterGrado").value;
      const aulaId = this.field(item, "filterAula").value;
      if (turno) filters.turno = turno;
      if (academiaId) filters.academiaId = academiaId;
      if (grado !== "") filters.grado = Number(grado);
      if (aulaId) filters.aulaId = aulaId;
      return {
        id,
        scope: this.field(item, "scope").value,
        dia: this.field(item, "dia").value,
        inicio,
        fin,
        motivo: this.field(item, "motivo").value.trim() || "Bloqueado",
        ...(Object.keys(filters).length ? { filters } : {}),
      };
    });
    this.assertUniqueIds(rules, "reglas fijas");
    return rules;
  },

  assertUniqueIds(items, label) {
    const ids = items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`No puede haber IDs repetidos en ${label}.`);
    }
  },

  getChangedSlotIds(previousSlots, nextSlots) {
    const previous = new Map(previousSlots.map((slot) => [slot.id, this.slotSignature(slot)]));
    const next = new Map(nextSlots.map((slot) => [slot.id, this.slotSignature(slot)]));
    return new Set(
      [...new Set([...previous.keys(), ...next.keys()])].filter(
        (id) => previous.get(id) !== next.get(id),
      ),
    );
  },

  save(app) {
    try {
      const nextSlots = this.collectOptativeSlots();
      const nextRules = this.collectFixedRules();
      const windows = {
        grupo: {
          matutino: this.readWindow("config-group-matutino", "grupos matutinos"),
          vespertino: this.readWindow("config-group-vespertino", "grupos vespertinos"),
        },
        profesor: {
          matutino: this.readWindow("config-professor-matutino", "profesores matutinos"),
          vespertino: this.readWindow("config-professor-vespertino", "profesores vespertinos"),
        },
      };

      const changedSlotIds = this.getChangedSlotIds(
        this.previousData?.franjasOptativas || [],
        nextSlots,
      );
      const affectedPairs = [];
      (app.data.grupos || []).forEach((group) => {
        Object.entries(group.franjasOptativasPorAsignatura || {}).forEach(
          ([subjectId, slotIds]) => {
            const ids = Array.isArray(slotIds) ? slotIds : [slotIds];
            if (ids.some((id) => changedSlotIds.has(id))) {
              affectedPairs.push([group.id, subjectId]);
            }
          },
        );
      });
      const affectedSegments = (app.horario.sesiones || []).filter((session) =>
        affectedPairs.some(
          ([groupId, subjectId]) =>
            session.grupoId === groupId && session.asignaturaId === subjectId,
        ),
      ).length;
      if (
        affectedSegments > 0 &&
        !window.confirm(
          `Cambiar las franjas eliminará ${affectedSegments} segmento(s) optativo(s) ya programado(s). ¿Continuar?`,
        )
      ) {
        return;
      }

      const previousData = this.previousData || this.clone(app.data);
      app.data.meta = {
        ...(app.data.meta || {}),
        nombre: document.getElementById("config-name")?.value.trim() || "Horario de trabajo",
        periodo: document.getElementById("config-period")?.value || "impar",
      };
      app.data.config = {
        ...(app.data.config || {}),
        turnos: {
          ...(app.data.config?.turnos || {}),
          grupo: windows.grupo,
          profesor: windows.profesor,
        },
      };
      app.data.franjasOptativas = nextSlots;
      app.data.reglasFijas = nextRules;

      const validSlotIds = new Set(nextSlots.map((slot) => slot.id));
      (app.data.grupos || []).forEach((group) => {
        Object.entries(group.franjasOptativasPorAsignatura || {}).forEach(
          ([subjectId, slotIds]) => {
            const ids = (Array.isArray(slotIds) ? slotIds : [slotIds]).filter((id) =>
              validSlotIds.has(id),
            );
            group.franjasOptativasPorAsignatura[subjectId] = ids;
          },
        );
      });
      affectedPairs.forEach(([groupId, subjectId]) =>
        GroupService.clearScheduledSubjectSessions(app, groupId, subjectId),
      );
      Persistence.rebuildDerivedBlocks(app.data, app.horario, previousData);
      if (app.fileContext) app.fileContext.modified = true;
      app.setupUI();
      if (app.currentView?.type === "GRUPO" && app.currentView.entity) {
        GroupView.renderEditor(app);
      }
      Dialogs.close("dialog-config");
      alert(
        "Configuración aplicada a esta copia de trabajo. Usa Exportar JSON para conservarla.",
      );
    } catch (error) {
      alert(error?.message || "No se pudo guardar la configuración.");
    }
  },
};
