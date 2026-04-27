const Views = {
  renderGrid: (containerId, days, hours, onCellAction) => {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`[Views.renderGrid] No existe #${containerId}`);
      return;
    }
    container.innerHTML = "";
    container.classList.add("grid-shell");

    const table = document.createElement("table");
    table.className = "timetable-grid";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.appendChild(document.createElement("th"));
    days.forEach((day) => {
      const th = document.createElement("th");
      th.textContent = day;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    hours.forEach((hourLabel, hourIndex) => {
      const row = document.createElement("tr");

      const th = document.createElement("th");
      th.textContent = hourLabel;
      row.appendChild(th);

      days.forEach((_, dayIndex) => {
        const td = document.createElement("td");
        td.dataset.day = dayIndex;
        td.dataset.hour = hourIndex;
        td.className = "grid-cell";

        td.addEventListener("click", (ev) => {
          onCellAction(dayIndex, hourIndex, ev);
        });

        td.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          onCellAction(dayIndex, hourIndex, ev);
        });

        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);

    const overlay = document.createElement("div");
    overlay.className = "grid-overlay";
    container.appendChild(overlay);
  },

  updateCell: (day, hour, content, color = null, isConflict = false) => {
    const cell = document.querySelector(
      `.grid-cell[data-day="${day}"][data-hour="${hour}"]`,
    );
    if (!cell) return;

    cell.innerHTML = content || "";
    cell.style.backgroundColor = color || "";
    cell.classList.toggle("conflict", !!isConflict);
  },

  clearGrid: () => {
    document.querySelectorAll(".grid-cell").forEach((cell) => {
      cell.innerHTML = "";
      cell.style.backgroundColor = "";
      cell.classList.remove("conflict");
    });
    document.querySelectorAll(".grid-overlay").forEach((overlay) => {
      overlay.innerHTML = "";
    });
  },

  renderList: (containerId, items, labelField, onClick, activeId = null) => {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`[Views.renderList] No existe #${containerId}`);
      return;
    }
    container.innerHTML = "";

    const ul = document.createElement("ul");
    ul.className = "item-list";

    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item[labelField];
      li.dataset.id = item.id;

      if (item.id === activeId) li.classList.add("active");

      li.onclick = () => {
        Array.from(ul.children).forEach((c) => c.classList.remove("active"));
        li.classList.add("active");
        onClick(item);
      };

      ul.appendChild(li);
    });

    container.appendChild(ul);
  },

  populateSelect: (selectOrId, items, labelField, valueField = "id") => {
    const select =
      typeof selectOrId === "string" ?
        document.getElementById(selectOrId)
      : selectOrId;

    if (!select) {
      console.warn(`[Views.populateSelect] No existe #${selectOrId}`);
      return;
    }

    select.innerHTML = '<option value="">Seleccionar...</option>';
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item[valueField];
      option.textContent = item[labelField];
      select.appendChild(option);
    });
  },
};

Views.buildContiguousBlocks = function (entries, getTrackId) {
  const sorted = [...(entries || [])].sort((a, b) => {
    if (a.dia !== b.dia) return a.dia - b.dia;
    return a.hora - b.hora;
  });

  const blocks = [];
  sorted.forEach((entry) => {
    const trackId = getTrackId(entry);
    const last = blocks[blocks.length - 1];
    if (
      last &&
      last.trackId === trackId &&
      last.dia === entry.dia &&
      last.endHour + 1 === entry.hora
    ) {
      last.endHour = entry.hora;
      last.entries.push(entry);
      return;
    }

    blocks.push({
      trackId,
      dia: entry.dia,
      startHour: entry.hora,
      endHour: entry.hora,
      entries: [entry],
    });
  });

  return blocks;
};

Views.renderMergedBlocks = function (blocks) {
  const shell = document.getElementById("main-grid");
  const overlay = shell?.querySelector(".grid-overlay");
  if (!shell || !overlay) return;

  overlay.innerHTML = "";
  const shellRect = shell.getBoundingClientRect();
  const insetX = 8;
  const insetY = 6;

  blocks.forEach((block) => {
    const startCell = document.querySelector(
      `.grid-cell[data-day="${block.dia}"][data-hour="${block.startHour}"]`,
    );
    const endCell = document.querySelector(
      `.grid-cell[data-day="${block.dia}"][data-hour="${block.endHour}"]`,
    );
    if (!startCell || !endCell) return;
    if (startCell.offsetParent === null || endCell.offsetParent === null) return;

    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();

    const card = document.createElement("div");
    card.className = "merged-session-block";
    if (block.isConflict) card.classList.add("is-conflict");
    if (block.className) card.classList.add(block.className);
    if (block.endHour - block.startHour + 1 <= 3) {
      card.classList.add("is-compact");
    }
    card.style.left = `${Math.round(startRect.left - shellRect.left + insetX)}px`;
    card.style.top = `${Math.round(startRect.top - shellRect.top + insetY)}px`;
    card.style.width = `${Math.max(0, Math.round(startRect.width - insetX * 2))}px`;
    card.style.height = `${Math.max(
      0,
      Math.round(endRect.bottom - startRect.top - insetY * 2),
    )}px`;
    card.style.backgroundColor = block.color || "";
    if (block.style) {
      card.style.cssText += block.style;
    }
    card.innerHTML = block.content || "";
    overlay.appendChild(card);
  });
};

Views.setVisibleHours = function (startTime, endTime) {
  const rows = document.querySelectorAll(".timetable-grid tbody tr");
  rows.forEach((row) => {
    const hourLabel = row.querySelector("th")?.textContent;
    if (!hourLabel) return;

    row.style.display =
      hourLabel < startTime || hourLabel >= endTime ? "none" : "";
  });
};

Views.resetVisibleHours = function () {
  document.querySelectorAll(".timetable-grid tbody tr").forEach((row) => {
    row.style.display = "";
  });
};

Views.renderBloqueo = function (day, hour, motivo = "") {
  this.updateCell(
    day,
    hour,
    motivo ? `<small>${motivo}</small>` : "Bloqueado",
    "#ddd",
    false,
  );
};
