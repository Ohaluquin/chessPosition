const WorkspaceView = {
  setup(app) {
    document.getElementById("btn-undo").onclick = () => this.moveHistory(app, false);
    document.getElementById("btn-redo").onclick = () => this.moveHistory(app, true);
    document.getElementById("btn-review").onclick = () => this.review(app);
    document.getElementById("btn-recovery").onclick = () => this.openRecovery(app);
    document.getElementById("btn-recovery-restore").onclick = () => {
      try {
        if (app.workspaceHistory.recover()) Dialogs.close("dialog-recovery");
      } catch (error) {
        alert("No se pudo restaurar la copia local. No se modificó la copia de trabajo.");
      }
    };
    document.getElementById("btn-recovery-later").onclick = () => Dialogs.close("dialog-recovery");
    document.getElementById("btn-review-close").onclick = () => Dialogs.close("dialog-review");
    window.addEventListener("beforeunload", (event) => {
      const history = app.workspaceHistory;
      if (!history.pendingRecovery && (app.data.asignaturas.length || history.hasUnexportedChanges())) history.flushBackup();
      if (history.hasUnexportedChanges() || history.running || app.groupEditorIsDraft) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    window.addEventListener("pagehide", () => {
      if (!app.workspaceHistory.pendingRecovery && app.data.asignaturas.length) app.workspaceHistory.flushBackup();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && !app.workspaceHistory.pendingRecovery && app.data.asignaturas.length) {
        app.workspaceHistory.flushBackup();
      }
    });
    this.update(app);
    if (app.workspaceHistory.pendingRecovery) this.openRecovery(app);
  },

  update(app) {
    const history = app.workspaceHistory;
    if (!history) return;
    const busy = history.running || app.automationBusy;
    [["btn-undo", history.undoStack, "Deshacer"], ["btn-redo", history.redoStack, "Rehacer"]].forEach(([id, stack, label]) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = busy || !stack.length;
      button.title = stack.length ? `${label}: ${stack[stack.length - 1].label}` : `No hay acciones para ${label.toLowerCase()}`;
    });
    const status = document.getElementById("workspace-status");
    if (status) {
      const labels = {
        idle: "Los cambios aplicados se respaldan solo en este navegador.",
        pending: "Guardando copia local…",
        saved: `Copia local guardada a las ${new Date(history.backupTime).toLocaleTimeString("es-MX")}.`,
        error: "No se pudo leer/guardar la copia local. Exporta un JSON para proteger tu trabajo.",
      };
      status.textContent = history.pendingRecovery ? "Hay una copia local disponible para restaurar." : labels[history.backupState];
      if (history.hasUnexportedChanges() && !history.pendingRecovery) status.textContent += " Hay cambios sin exportar a JSON.";
      status.dataset.state = history.backupState;
    }
    const recoveryButton = document.getElementById("btn-recovery");
    if (recoveryButton) {
      recoveryButton.hidden = !history.pendingRecovery;
      recoveryButton.disabled = busy;
    }
    const reviewButton = document.getElementById("btn-review");
    if (reviewButton) reviewButton.disabled = busy;
  },

  moveHistory(app, redo) {
    if (app.workspaceHistory.running || app.automationBusy) return;
    if (app.groupEditorIsDraft && !window.confirm("Hay un grupo nuevo sin guardar. Deshacer/Rehacer descartará ese borrador. ¿Continuar?")) return;
    if (redo) app.workspaceHistory.redo();
    else app.workspaceHistory.undo();
  },

  openRecovery(app) {
    const backup = app.workspaceHistory.pendingRecovery;
    if (!backup) return;
    const data = JSON.parse(backup.snapshot.documentJSON);
    const date = new Date(backup.savedAt);
    document.getElementById("recovery-summary").textContent =
      `${backup.snapshot.fileContext?.label || data.meta?.nombre || "Horario de trabajo"}: ` +
      `${data.grupos.length} grupos, ${data.sesiones.length} segmentos. ` +
      `Respaldo del ${Number.isNaN(date.getTime()) ? "último uso" : date.toLocaleString("es-MX")}.`;
    Dialogs.open("dialog-recovery");
  },

  review(app, exportAction = null, exportLabel = "") {
    if (app.automationBusy || app.workspaceHistory.running) return;
    const audit = ScheduleAudit.inspect(app);
    document.getElementById("review-summary").textContent =
      `${audit.groups} grupos · ${audit.sessions} segmentos · ${audit.errors} problemas · ${audit.warnings} avisos`;
    const list = document.getElementById("review-issues");
    list.replaceChildren();
    audit.issues.forEach((issue) => {
      const item = document.createElement("li");
      item.className = `review-issue review-${issue.severity}`;
      const message = document.createElement("span");
      message.textContent = issue.message + (issue.count > 1 ? ` (${issue.count} incidencias)` : "");
      item.appendChild(message);
      if (app.data.grupos.some((grupo) => grupo.id === issue.grupoId)) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Ir al grupo";
        button.onclick = () => {
          Dialogs.close("dialog-review");
          app.switchView("GRUPO");
          app.groupEditorSelectedAsignaturaId = issue.asignaturaId || null;
          app.selectGrupo(app.data.grupos.find((grupo) => grupo.id === issue.grupoId));
        };
        item.appendChild(button);
      }
      list.appendChild(item);
    });
    if (!audit.issues.length) {
      const item = document.createElement("li");
      item.textContent = "No se detectaron pendientes ni inconsistencias en esta revisión.";
      list.appendChild(item);
    }
    const button = document.getElementById("btn-review-export");
    button.hidden = !exportAction;
    button.textContent = audit.errors ? `Exportar ${exportLabel} de todas formas`
      : audit.warnings ? `Exportar ${exportLabel} con pendientes` : `Exportar ${exportLabel}`;
    button.onclick = () => {
      if (app.automationBusy || app.workspaceHistory.running) return;
      Dialogs.close("dialog-review");
      exportAction?.();
    };
    Dialogs.open("dialog-review");
  },
};
