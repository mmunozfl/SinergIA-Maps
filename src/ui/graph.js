import { el } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  if (text !== null) node.textContent = String(text);
  return node;
}

function truncateLabel(text, max = 22) {
  const str = String(text || '').trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function wrapLines(text, maxChars = 24, maxLines = 2) {
  const words = String(text || '').trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  const consumed = lines.join(' ').length;
  if (consumed < String(text || '').trim().length && lines.length) {
    lines[lines.length - 1] = truncateLabel(lines[lines.length - 1], maxChars);
  }
  return lines;
}

function drawSvgTextLines(parent, lines, { x, centerY, fill, fontSize = 9.5, fontWeight = 600 }) {
  const lineHeight = fontSize + 2.5;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;
  lines.forEach((line, idx) => {
    parent.appendChild(
      svgEl(
        'text',
        {
          x,
          y: startY + idx * lineHeight,
          'text-anchor': 'middle',
          fill,
          'font-size': fontSize,
          'font-weight': fontWeight,
          'font-family': 'system-ui, -apple-system, sans-serif'
        },
        line
      )
    );
  });
}

function edgeColor(edge, palette) {
  if (edge.kind === 'ayuda_mutua') return palette.doradoSinergia;
  if (edge.kind === 'saber_compartido') return palette.celesteUcm;
  return palette.azulMedio;
}

function computePositionsRed(nodes, width, height) {
  const positions = new Map();
  const count = nodes.length;
  if (!count) return positions;

  if (count === 1) {
    positions.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return positions;
  }

  const ordered = [...nodes].sort(
    (a, b) => (a.macroId || '').localeCompare(b.macroId || '') || a.nombre.localeCompare(b.nombre)
  );
  const rx = Math.min(370, Math.max(210, count * 22));
  const ry = Math.min(205, Math.max(135, count * 14));
  const cx = width / 2;
  const cy = height / 2;

  ordered.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
    const ringOffset = count > 14 && idx % 2 === 1 ? 0.66 : 1;
    positions.set(node.id, {
      x: cx + rx * ringOffset * Math.cos(angle),
      y: cy + ry * ringOffset * Math.sin(angle)
    });
  });

  return positions;
}

/**
 * Construye las cajas y líneas jerárquicas del Organigrama UCM oficial (desde SSOT modelo.organigramaUCM)
 * y ubica los nodos de funcionarios entrevistados directamente sobre su unidad exacta.
 */
function renderOrganigramaOverlay(viewportGroup, nodes, edges, modelo, palette, selectedId, myProfileId, onSelectNode) {
  const width = 1120;
  const lineStroke = palette.celesteUcm;

  // Agrupación de funcionarios por nombre exacto de unidad
  const byUnit = new Map();
  for (const n of nodes) {
    const key = (n.area || '').trim().toLowerCase();
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(n);
  }

  const orgBoxes = [];
  const treeLines = svgEl('g', { class: 'org-lines' });
  const treeBoxes = svgEl('g', { class: 'org-boxes' });
  const edgesLayer = svgEl('g', { class: 'svg-edges' });
  const overlayLayer = svgEl('g', { class: 'org-users' });

  viewportGroup.appendChild(treeLines);
  viewportGroup.appendChild(treeBoxes);
  viewportGroup.appendChild(edgesLayer);
  viewportGroup.appendChild(overlayLayer);

  const addLine = (x1, y1, x2, y2) => {
    treeLines.appendChild(
      svgEl('line', { x1, y1, x2, y2, stroke: lineStroke, 'stroke-width': 1.5, opacity: 0.75 })
    );
  };

  // Nivel superior institucional (fiel al organigrama mayo 2026)
  const topNodes = [
    { name: 'Gran Cancillería', cx: 560, y: 14, w: 150, h: 32, style: 'navy' },
    { name: 'Contraloría', cx: 360, y: 42, w: 120, h: 28, style: 'celeste' },
    { name: 'Pastoral Universitaria', cx: 760, y: 42, w: 140, h: 28, style: 'celeste' },
    { name: 'Honorable Consejo Superior', cx: 560, y: 58, w: 184, h: 32, style: 'celeste' },
    { name: 'Secretaría General', cx: 330, y: 102, w: 140, h: 30, style: 'celeste' },
    { name: 'Dirección Jurídica', cx: 330, y: 142, w: 140, h: 28, style: 'leaf' },
    { name: 'Dirección de Equidad de Género y Diversidad', cx: 330, y: 176, w: 152, h: 34, style: 'leaf' },
    { name: 'Rectoría', cx: 560, y: 104, w: 150, h: 32, style: 'celeste' }
  ];

  // Líneas superiores
  addLine(560, 46, 560, 224);
  addLine(420, 52, 700, 52);
  addLine(400, 117, 560, 117);
  addLine(330, 132, 330, 176);

  for (const item of topNodes) orgBoxes.push(item);

  // 6 columnas principales desde modelo.organigramaUCM (SSOT)
  const columns = (modelo.organigramaUCM || []).filter((g) => g.esColumna);
  const padX = 20;
  const gapX = 14;
  const colW = (width - padX * 2 - gapX * Math.max(0, columns.length - 1)) / Math.max(1, columns.length);
  const spineY = 224;
  const headerY = 240;

  if (columns.length) {
    const firstCx = padX + colW / 2;
    const lastCx = padX + (columns.length - 1) * (colW + gapX) + colW / 2;
    addLine(firstCx, spineY, lastCx, spineY);
  }

  let maxBottomY = 640;

  columns.forEach((col, colIdx) => {
    const cx = padX + colIdx * (colW + gapX) + colW / 2;
    addLine(cx, spineY, cx, headerY);

    const units = col.unidades || [];
    const firstIsHeader = units[0] && (units[0].startsWith('Vicerrectoría') || units[0] === 'Pro Rectoría');
    const headerName = firstIsHeader ? units[0] : col.macroNombre;
    orgBoxes.push({ name: headerName, cx, y: headerY, w: colW, h: 38, style: 'celeste' });

    const subUnits = firstIsHeader ? units.slice(1) : units;
    if (subUnits.length) {
      const startY = headerY + 50;
      const stepY = 46;
      const lastCenterY = startY + (subUnits.length - 1) * stepY + 19;
      addLine(cx - colW * 0.44, headerY + 38, cx - colW * 0.44, lastCenterY);
      addLine(cx, headerY + 38, cx - colW * 0.44, headerY + 38);

      subUnits.forEach((uName, idx) => {
        const y = startY + idx * stepY;
        addLine(cx - colW * 0.44, y + 19, cx - colW * 0.36, y + 19);
        orgBoxes.push({
          name: uName,
          cx: cx + 8,
          y,
          w: colW - 18,
          h: 38,
          style: 'leaf'
        });
        maxBottomY = Math.max(maxBottomY, y + 52);
      });
    }
  });

  const userPositions = new Map();
  const placedIds = new Set();

  function drawUnitBoxWithUsers(box, matchedUsers) {
    const hasUsers = matchedUsers.length > 0;
    const x = box.cx - box.w / 2;

    const fill =
      box.style === 'navy'
        ? palette.azulMarino
        : box.style === 'celeste'
          ? palette.celesteUcm
          : hasUsers
            ? palette.celesteSuave
            : '#ffffff';

    const stroke = hasUsers ? palette.doradoSinergia : box.style === 'navy' ? palette.azulMarino : palette.celesteUcm;
    const textColor = box.style === 'leaf' ? palette.azulMarino : '#ffffff';

    treeBoxes.appendChild(
      svgEl('rect', {
        x,
        y: box.y,
        width: box.w,
        height: box.h,
        rx: 5,
        fill,
        stroke,
        'stroke-width': hasUsers ? 2.6 : 1.3
      })
    );

    const lines = wrapLines(box.name, Math.max(16, Math.floor(box.w / 6.2)), 2);
    drawSvgTextLines(treeBoxes, lines, {
      x: box.cx,
      centerY: box.y + box.h / 2,
      fill: textColor,
      fontSize: box.style === 'leaf' ? 8.8 : 9.6,
      fontWeight: box.style === 'leaf' ? 600 : 700
    });

    if (hasUsers) {
      matchedUsers.forEach((user, idx) => {
        placedIds.add(user.id);
        const chipW = Math.min(box.w + 8, 134);
        const chipH = 20;
        const offsetX = idx * 8;
        const offsetY = idx * 18;
        const chipX = x + box.w - chipW + 4 + offsetX;
        const chipY = box.y + box.h - 8 + offsetY;
        const anchorX = chipX + chipW / 2;
        const anchorY = chipY + chipH / 2;
        userPositions.set(user.id, { x: anchorX, y: anchorY });
        maxBottomY = Math.max(maxBottomY, chipY + chipH + 16);

        const isSelected = user.id === selectedId;
        const isMine = user.id === myProfileId;

        const ug = svgEl('g', {
          transform: `translate(${chipX}, ${chipY})`,
          style: 'cursor: pointer;'
        });

        ug.appendChild(
          svgEl('rect', {
            width: chipW,
            height: chipH,
            rx: 10,
            fill: isSelected ? palette.azulMarino : isMine ? palette.doradoSinergia : palette.azulMedio,
            stroke: '#ffffff',
            'stroke-width': 1.6
          })
        );
        ug.appendChild(
          svgEl(
            'text',
            {
              x: chipW / 2,
              y: 13.5,
              'text-anchor': 'middle',
              fill: isMine && !isSelected ? '#1f2937' : '#ffffff',
              'font-size': 9.5,
              'font-weight': 700,
              'font-family': 'system-ui, -apple-system, sans-serif'
            },
            truncateLabel(user.nombre, 18)
          )
        );
        ug.appendChild(svgEl('title', {}, `${user.nombre} (${user.cargo}) — Clic para ver ficha`));
        ug.addEventListener('click', () => onSelectNode(user.id));
        overlayLayer.appendChild(ug);
      });
    }
  }

  for (const box of orgBoxes) {
    const key = box.name.toLowerCase();
    const matchedUsers = byUnit.get(key) || [];
    drawUnitBoxWithUsers(box, matchedUsers);
  }

  // Garantiza que ningún usuario quede oculto si ingresó con un nombre de unidad previo o personalizado
  const unplaced = nodes.filter((n) => !placedIds.has(n.id));
  if (unplaced.length) {
    const unplacedGroups = new Map();
    for (const u of unplaced) {
      const label = (u.area || 'Otras unidades').trim();
      if (!unplacedGroups.has(label)) unplacedGroups.set(label, []);
      unplacedGroups.get(label).push(u);
    }

    const entries = [...unplacedGroups.entries()];
    const boxW = 210;
    const boxGap = 18;
    const colsPerRow = Math.min(4, entries.length);
    const totalW = colsPerRow * boxW + (colsPerRow - 1) * boxGap;
    const startX = (width - totalW) / 2 + boxW / 2;
    const baseY = maxBottomY + 10;

    entries.forEach(([areaLabel, users], idx) => {
      const row = Math.floor(idx / colsPerRow);
      const col = idx % colsPerRow;
      drawUnitBoxWithUsers(
        {
          name: areaLabel,
          cx: startX + col * (boxW + boxGap),
          y: baseY + row * 68,
          w: boxW,
          h: 38,
          style: 'leaf'
        },
        users
      );
    });
  }

  // Arcos de SinergIA trazados por encima del Organigrama UCM
  for (const edge of edges) {
    const p1 = userPositions.get(edge.sourceId);
    const p2 = userPositions.get(edge.targetId);
    if (!p1 || !p2) continue;

    const midX = (p1.x + p2.x) / 2;
    const midY = Math.min(p1.y, p2.y) - 54;
    const pathD = `M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`;
    const isSelectedEdge = selectedId && (edge.sourceId === selectedId || edge.targetId === selectedId);

    const path = svgEl('path', {
      d: pathD,
      fill: 'none',
      stroke: edgeColor(edge, palette),
      'stroke-width': isSelectedEdge ? 3.2 : 2.2,
      'stroke-dasharray': edge.kind === 'afinidades' ? '5 4' : 'none',
      opacity: selectedId ? (isSelectedEdge ? 0.96 : 0.2) : 0.85
    });
    path.appendChild(svgEl('title', {}, edge.reasons.join(' · ')));
    edgesLayer.appendChild(path);
  }

  return maxBottomY + 28;
}

/**
 * Dibuja el mapa interactivo de SinergIA (Red de Sinergia o Superpuesto al Organigrama UCM mayo 2026).
 */
export function renderSynergyDiagram({
  network,
  modelo,
  mode = 'red',
  selectedId = null,
  myProfileId = null,
  onNewInterview = null,
  onSelectNode,
  onToggleMode,
  onExportSvg
}) {
  const palette = modelo.paletaOficial;
  const width = mode === 'organigrama' ? 1120 : 980;
  let height = mode === 'organigrama' ? 720 : 540;
  let zoom = 1;
  const isEmptyRed = !network.nodes.length && mode === 'red';
  let svg = null;

  const wrapper = el('div', { className: 'diagram-shell' });
  const resetZoomBtn = el('button', {
    type: 'button',
    className: 'segmented__btn segmented__btn--zoom',
    text: '100%',
    title: 'Restablecer zoom',
    disabled: isEmptyRed,
    onClick: () => applyZoom(1)
  });

  const toolbar = el('div', { className: 'diagram-toolbar' }, [
    el('div', { className: 'diagram-toolbar__actions' }, [
      onNewInterview
        ? el('button', {
            type: 'button',
            className: 'btn btn--cta btn--toolbar',
            text: '+ Nueva Entrevista SinergIA',
            onClick: onNewInterview
          })
        : null,
      el('div', { className: 'segmented', role: 'group', 'aria-label': 'Modo de visualización' }, [
        el('button', {
          type: 'button',
          className: mode === 'red' ? 'segmented__btn is-active' : 'segmented__btn',
          text: 'Red de Sinergia Real',
          onClick: () => onToggleMode('red')
        }),
        el('button', {
          type: 'button',
          className: mode === 'organigrama' ? 'segmented__btn is-active' : 'segmented__btn',
          text: 'Sobre el Organigrama',
          onClick: () => onToggleMode('organigrama')
        })
      ])
    ]),
    el('div', { className: 'diagram-tools' }, [
      el('div', { className: 'segmented', role: 'group', 'aria-label': 'Zoom del mapa' }, [
        el('button', {
          type: 'button',
          className: 'segmented__btn segmented__btn--icon',
          text: '−',
          title: 'Alejar',
          disabled: isEmptyRed,
          onClick: () => applyZoom(Math.max(0.7, zoom - 0.15))
        }),
        resetZoomBtn,
        el('button', {
          type: 'button',
          className: 'segmented__btn segmented__btn--icon',
          text: '+',
          title: 'Acercar',
          disabled: isEmptyRed,
          onClick: () => applyZoom(Math.min(1.6, zoom + 0.15))
        })
      ]),
      el('button', {
        type: 'button',
        className: 'btn btn--secondary btn--toolbar',
        text: 'Exportar SVG',
        disabled: isEmptyRed,
        onClick: () => {
          if (svg) onExportSvg(svg);
        }
      })
    ])
  ]);

  if (isEmptyRed) {
    wrapper.appendChild(toolbar);
    wrapper.appendChild(
      el('div', { className: 'diagram-empty' }, [
        el('p', { className: 'diagram-empty__title', text: 'El mapa está listo para recibir la primera entrevista real' }),
        el('p', { className: 'diagram-empty__desc', text: modelo.programa.guiaVacio })
      ])
    );
    return wrapper;
  }

  svg = svgEl('svg', {
    class: 'synergy-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Mapa interactivo de conexiones SinergIA-Maps'
  });

  const bgRect = svgEl('rect', { x: 0, y: 0, width, height, fill: '#ffffff', rx: 12 });
  svg.appendChild(bgRect);

  const viewportGroup = svgEl('g', { id: 'viewport' });
  svg.appendChild(viewportGroup);

  function applyZoom(nextZoom) {
    zoom = Number(nextZoom.toFixed(2));
    resetZoomBtn.textContent = `${Math.round(zoom * 100)}%`;
    if (!svg) return;
    const dx = (width * (1 - zoom)) / 2;
    const dy = (height * (1 - zoom)) / 2;
    viewportGroup.setAttribute('transform', `translate(${dx}, ${dy}) scale(${zoom})`);
  }

  if (mode === 'organigrama') {
    height = renderOrganigramaOverlay(
      viewportGroup,
      network.nodes,
      network.edges,
      modelo,
      palette,
      selectedId,
      myProfileId,
      onSelectNode
    );
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    bgRect.setAttribute('height', String(height));
  } else {
    const positions = computePositionsRed(network.nodes, width, height);
    viewportGroup.appendChild(
      svgEl('ellipse', {
        cx: width / 2,
        cy: height / 2,
        rx: 340,
        ry: 195,
        fill: 'none',
        stroke: palette.celesteSuave,
        'stroke-width': 2,
        'stroke-dasharray': '6 6'
      })
    );

    const edgesLayer = svgEl('g', { class: 'svg-edges' });
    const nodesLayer = svgEl('g', { class: 'svg-nodes' });
    viewportGroup.appendChild(edgesLayer);
    viewportGroup.appendChild(nodesLayer);

    const edgeNodes = [];
    for (const edge of network.edges) {
      const p1 = positions.get(edge.sourceId);
      const p2 = positions.get(edge.targetId);
      if (!p1 || !p2) continue;

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2 - 24;
      const pathD = `M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`;
      const isSelectedEdge = selectedId && (edge.sourceId === selectedId || edge.targetId === selectedId);

      const path = svgEl('path', {
        d: pathD,
        fill: 'none',
        stroke: edgeColor(edge, palette),
        'stroke-width': isSelectedEdge ? 3 : edge.kind === 'ayuda_mutua' ? 2.2 : 1.5,
        'stroke-dasharray': edge.kind === 'afinidades' ? '5 4' : 'none',
        opacity: selectedId ? (isSelectedEdge ? 0.95 : 0.16) : 0.68
      });
      path.appendChild(svgEl('title', {}, edge.reasons.join(' · ')));
      edgesLayer.appendChild(path);
      edgeNodes.push({ edge, path });
    }

    const cardW = 156;
    const cardH = 52;

    for (const node of network.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const isSelected = node.id === selectedId;
      const isMine = node.id === myProfileId;

      const g = svgEl('g', {
        transform: `translate(${pos.x - cardW / 2}, ${pos.y - cardH / 2})`,
        style: 'cursor: pointer;'
      });

      g.appendChild(
        svgEl('rect', {
          width: cardW,
          height: cardH,
          rx: 9,
          fill: isSelected ? palette.azulMarino : isMine ? palette.celesteSuave : '#ffffff',
          stroke: isSelected ? palette.doradoSinergia : isMine ? palette.azulMarino : palette.celesteUcm,
          'stroke-width': isSelected || isMine ? 2.5 : 1.6
        })
      );

      g.appendChild(
        svgEl(
          'text',
          {
            x: 10,
            y: 21,
            fill: isSelected ? '#ffffff' : palette.azulMarino,
            'font-size': 12,
            'font-weight': 700,
            'font-family': 'system-ui, -apple-system, sans-serif'
          },
          truncateLabel(node.nombre, 20)
        )
      );

      g.appendChild(
        svgEl(
          'text',
          {
            x: 10,
            y: 37,
            fill: isSelected ? palette.celesteBorde : '#335c7d',
            'font-size': 10,
            'font-family': 'system-ui, -apple-system, sans-serif'
          },
          truncateLabel(node.area, 23)
        )
      );

      g.addEventListener('click', () => onSelectNode(node.id));
      g.addEventListener('mouseenter', () => {
        if (selectedId) return;
        for (const item of edgeNodes) {
          const hit = item.edge.sourceId === node.id || item.edge.targetId === node.id;
          item.path.setAttribute('opacity', hit ? '1' : '0.15');
          if (hit) item.path.setAttribute('stroke-width', '3');
        }
      });
      g.addEventListener('mouseleave', () => {
        if (selectedId) return;
        for (const item of edgeNodes) {
          item.path.setAttribute('opacity', '0.68');
          item.path.setAttribute('stroke-width', item.edge.kind === 'ayuda_mutua' ? '2.2' : '1.5');
        }
      });

      nodesLayer.appendChild(g);
    }
  }

  const legend = el('div', { className: 'diagram-legend' }, [
    el('span', { className: 'legend-item' }, [
      el('span', { className: 'legend-swatch legend-swatch--gold' }),
      'Puedo ayudar ↔ Busco orientación'
    ]),
    el('span', { className: 'legend-item' }, [
      el('span', { className: 'legend-swatch legend-swatch--celeste' }),
      'Tema compartido entre áreas'
    ]),
    el('span', { className: 'legend-item' }, [
      el('span', { className: 'legend-swatch legend-swatch--navy' }),
      'Afinidad humana no laboral'
    ])
  ]);

  wrapper.appendChild(toolbar);
  wrapper.appendChild(el('div', { className: 'diagram-canvas-wrap' }, svg));
  wrapper.appendChild(legend);
  return wrapper;
}
