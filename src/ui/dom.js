/**
 * Helper declarativo y seguro contra XSS (textContent por defecto) para construir nodos DOM.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) {
        node.dataset[dk] = String(dv);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list') {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child
    );
  }
  return node;
}

/**
 * Limpia y reemplaza el contenido de un contenedor.
 */
export function renderInto(container, content) {
  container.replaceChildren(...(Array.isArray(content) ? content : [content]).filter(Boolean));
}

function createTagsControl(field, modelo, initialList = [], communityTags = []) {
  const selected = new Set(Array.isArray(initialList) ? initialList : []);
  const presets = (modelo.etiquetasSugeridas && modelo.etiquetasSugeridas[field.source]) || [];
  const communitySet = new Set(communityTags);
  const allKnown = [...new Set([...presets, ...communityTags, ...selected])];

  const hidden = el('input', {
    type: 'hidden',
    name: field.id,
    value: JSON.stringify([...selected])
  });

  const chipsBox = el('div', { className: 'tags-picker' });

  function syncHidden() {
    hidden.value = JSON.stringify([...selected]);
  }

  function addChipButton(tagLabel) {
    const isCommunity = communitySet.has(tagLabel);
    const baseClass = isCommunity ? 'tag-chip tag-chip--community' : 'tag-chip';
    const btn = el('button', {
      type: 'button',
      className: selected.has(tagLabel) ? `${baseClass} is-selected` : baseClass,
      dataset: { tag: tagLabel },
      text: isCommunity ? `★ ${tagLabel}` : tagLabel,
      title: isCommunity ? 'Agregado por otro funcionario en la red' : '',
      onClick: () => {
        if (selected.has(tagLabel)) {
          selected.delete(tagLabel);
          btn.classList.remove('is-selected');
        } else {
          selected.add(tagLabel);
          btn.classList.add('is-selected');
        }
        syncHidden();
      }
    });
    chipsBox.appendChild(btn);
  }

  for (const tag of allKnown) addChipButton(tag);

  const customInput = el('input', {
    type: 'text',
    className: 'tags-custom-input',
    placeholder: 'Agregar otro tema y presionar +'
  });

  function commitCustom() {
    const val = customInput.value.trim();
    if (!val) return;
    const existingBtn = [...chipsBox.querySelectorAll('.tag-chip')].find(
      (b) => (b.dataset.tag || '').toLowerCase() === val.toLowerCase()
    );
    const canonical = existingBtn ? existingBtn.dataset.tag : val;
    if (!selected.has(canonical)) {
      selected.add(canonical);
      if (existingBtn) {
        existingBtn.classList.add('is-selected');
      } else {
        addChipButton(canonical);
      }
      syncHidden();
    }
    customInput.value = '';
  }

  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCustom();
    }
  });

  const customRow = el('div', { className: 'tags-custom-row' }, [
    customInput,
    el('button', { type: 'button', className: 'btn btn--ghost btn--sm', text: '+ Agregar', onClick: commitCustom })
  ]);

  return el('div', { className: 'tags-wrapper' }, [hidden, chipsBox, customRow]);
}

function createSelectControl(field, modelo, value, grouped = false) {
  const options = [el('option', { value: '', text: 'Selecciona una opción...' })];
  let matched = !value;

  if (grouped) {
    for (const macro of modelo[field.source] || []) {
      const group = el('optgroup', { label: macro.macroNombre });
      for (const unit of macro.unidades || []) {
        const isSel = unit === value;
        if (isSel) matched = true;
        group.appendChild(el('option', { value: unit, text: unit, selected: isSel }));
      }
      options.push(group);
    }
  } else {
    for (const item of modelo[field.source] || []) {
      const label = item.numero ? `${item.numero}. ${item.titulo}` : (item.nombre || item.titulo);
      const isSel = item.id === value;
      if (isSel) matched = true;
      options.push(el('option', { value: item.id, text: label, selected: isSel }));
    }
  }

  const selectEl = el(
    'select',
    {
      id: `field_${field.id}`,
      name: field.id,
      required: Boolean(field.required)
    },
    options
  );

  if (!matched && value) {
    return el('div', { className: 'select-legacy-wrap' }, [
      selectEl,
      el('p', {
        className: 'legacy-hint',
        text: `Valor previo no vigente: "${value}". Selecciona la unidad o facultad actual.`
      })
    ]);
  }

  return selectEl;
}

/**
 * Renderiza campos dinámicos a partir del esquema SSOT (soportando texto, select, select agrupado y tags).
 */
export function buildFormFields(fields, modelo, initialValues = {}, extraTagsBySource = {}) {
  const wrapper = el('div', { className: 'form-grid' });

  for (const field of fields) {
    const inputId = `field_${field.id}`;
    const value = initialValues[field.id] ?? '';
    let control;

    if (field.type === 'textarea') {
      control = el('textarea', {
        id: inputId,
        name: field.id,
        rows: 3,
        required: Boolean(field.required),
        placeholder: field.placeholder || '',
        value
      });
    } else if (field.type === 'select') {
      control = createSelectControl(field, modelo, value, false);
    } else if (field.type === 'select-grouped') {
      control = createSelectControl(field, modelo, value, true);
    } else if (field.type === 'tags') {
      const communityTags = extraTagsBySource[field.source] || [];
      control = createTagsControl(field, modelo, Array.isArray(value) ? value : [], communityTags);
    } else {
      control = el('input', {
        id: inputId,
        name: field.id,
        type: field.type || 'text',
        required: Boolean(field.required),
        placeholder: field.placeholder || '',
        value
      });
    }

    const isWide = field.type === 'textarea' || field.type === 'tags';
    const row = el('div', { className: isWide ? 'form-field form-field--full' : 'form-field' }, [
      el('label', { for: inputId }, [
        field.label,
        field.required ? el('span', { className: 'req-mark', text: ' *' }) : null
      ]),
      control
    ]);
    wrapper.appendChild(row);
  }

  return wrapper;
}

/**
 * Lee valores de un formulario según un esquema de campos SSOT.
 */
export function readFormValues(formElement, fields) {
  const data = {};
  const formData = new FormData(formElement);
  for (const field of fields) {
    const raw = formData.get(field.id);
    if (field.type === 'tags') {
      try {
        const parsed = JSON.parse(String(raw || '[]'));
        data[field.id] = Array.isArray(parsed) ? parsed : [];
      } catch {
        data[field.id] = [];
      }
    } else {
      data[field.id] = String(raw || '').trim();
    }
  }
  return data;
}
