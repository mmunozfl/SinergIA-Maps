import { createStore, decodePayload } from './core/store.js';
import { el, renderInto } from './ui/dom.js';
import { renderMapaView, renderEntrevistaView, renderCrucesView, renderEvidenciaView } from './ui/views.js';

const MODEL_URL = './data/modelo-sinergia.json';

function showToast(toastNode, message, isError = false) {
  toastNode.textContent = message;
  toastNode.className = isError ? 'toast toast--error is-visible' : 'toast is-visible';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toastNode.classList.remove('is-visible');
  }, 4200);
}

function applyOfficialPalette(paleta) {
  if (!paleta) return;
  const root = document.documentElement;
  root.style.setProperty('--ucm-navy', paleta.azulMarino);
  root.style.setProperty('--ucm-celeste', paleta.celesteUcm);
  root.style.setProperty('--ucm-blue-mid', paleta.azulMedio);
  root.style.setProperty('--ucm-celeste-soft', paleta.celesteSuave);
  root.style.setProperty('--ucm-celeste-border', paleta.celesteBorde);
  root.style.setProperty('--ucm-gold', paleta.doradoSinergia);
}

function parseRoute(modelo) {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (rawHash.startsWith('import=')) return 'import';
  const valid = new Set((modelo.navegacion || []).map((n) => n.id));
  return valid.has(rawHash) ? rawHash : 'mapa';
}

async function bootstrap() {
  const appRoot = document.getElementById('app');

  let modelo;
  try {
    const res = await fetch(MODEL_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    modelo = await res.json();
  } catch (err) {
    renderInto(
      appRoot,
      el('div', { className: 'container' }, [
        el('div', { className: 'card' }, [
          el('h1', { text: 'No se pudo cargar la configuración de SinergIA' }),
          el('p', {
            text: 'Si abriste el archivo directamente con doble clic (protocolo file://), el navegador bloquea la carga de módulos JSON. Ábrelo desde GitHub Pages o con un servidor local (ej. python -m http.server).'
          }),
          el('p', { className: 'muted-sm', text: `Detalle: ${err.message}` })
        ])
      ])
    );
    return;
  }

  applyOfficialPalette(modelo.paletaOficial);
  const store = createStore(modelo);

  const uiState = {
    route: parseRoute(modelo),
    diagramMode: 'red',
    selectedNodeId: null,
    interviewMode: 'new',
    editingProfileId: null,
    interviewStep: 0,
    interviewDraft: null,
    interviewStartedAt: Date.now(),
    interviewCompletedProfileId: null,
    filters: { query: '', macroId: '', conductaId: '', onlyOtherAreas: false },
    encounterTarget: null
  };

  const toastNode = el('div', { className: 'toast', role: 'status', 'aria-live': 'polite' });
  const headerNode = el('header', { className: 'topbar no-print' });
  const mainNode = el('main', { className: 'container main-content' });
  const autor = modelo.programa.autor;
  const footerNode = el('footer', { className: 'footer no-print' }, [
    el('span', { className: 'footer__org', text: `${modelo.programa.institucion} · ${modelo.programa.titulo}` }),
    autor?.nombre
      ? el('a', {
          className: 'footer__author',
          href: autor.correo ? `mailto:${autor.correo}` : '#',
          title: autor.correo ? `Enviar correo a ${autor.nombre} (${autor.correo})` : autor.nombre,
          text: autor.nombre
        })
      : null,
    el('span', { className: 'footer__program', text: 'Programa Nuestro Sello · SinergIA UCM' })
  ]);

  renderInto(appRoot, [headerNode, mainNode, footerNode, toastNode]);

  function onToast(msg, isError = false) {
    showToast(toastNode, msg, isError);
  }

  function setUiState(patch) {
    const shouldScrollTop =
      ('interviewStep' in patch && patch.interviewStep !== uiState.interviewStep) ||
      ('interviewCompletedProfileId' in patch &&
        patch.interviewCompletedProfileId !== uiState.interviewCompletedProfileId);
    Object.assign(uiState, patch);
    render();
    if (shouldScrollTop) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function navigate(routeId) {
    uiState.route = routeId;
    if (routeId === 'entrevista') {
      uiState.interviewMode = 'new';
      uiState.editingProfileId = null;
      uiState.interviewStep = 0;
      uiState.interviewDraft = null;
      uiState.interviewCompletedProfileId = null;
      uiState.interviewStartedAt = Date.now();
    }
    if (window.location.hash !== `#${routeId}`) {
      window.location.hash = `#${routeId}`;
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startEditProfile(profile) {
    uiState.route = 'entrevista';
    uiState.interviewMode = 'edit';
    uiState.editingProfileId = profile.id;
    uiState.interviewStep = 0;
    uiState.interviewDraft = { ...profile };
    uiState.interviewCompletedProfileId = null;
    uiState.interviewStartedAt = Date.now();
    if (window.location.hash !== '#entrevista') {
      window.location.hash = '#entrevista';
    }
    render();
  }

  function startEncounter(colleague) {
    uiState.encounterTarget = colleague;
    navigate('evidencia');
  }

  function handleImportFromHash() {
    const rawHash = window.location.hash.replace(/^#/, '');
    if (!rawHash.startsWith('import=')) return;
    try {
      const token = rawHash.slice('import='.length);
      const payload = decodePayload(token);
      const res = store.importBundle(payload);
      onToast(`Se importó correctamente la ficha compartida (${res.importedProfiles}).`);
    } catch {
      onToast('No se pudo leer el enlace de ficha compartido.', true);
    }
    uiState.route = 'cruces';
    history.replaceState(null, '', '#cruces');
  }

  function renderHeader() {
    renderInto(
      headerNode,
      el('div', { className: 'container topbar__inner' }, [
        el('div', { className: 'brand' }, [
          el('div', { className: 'brand__mark', text: 'UCM' }),
          el('div', {}, [
            el('h1', { className: 'brand__title', text: modelo.programa.nombreApp }),
            el('p', { className: 'brand__sub', text: modelo.programa.subtitulo })
          ])
        ]),
        el('div', { className: 'topbar__right' }, [
          el(
            'nav',
            { className: 'nav-tabs', 'aria-label': 'Navegación principal' },
            (modelo.navegacion || []).map((item) =>
              el('button', {
                type: 'button',
                className: uiState.route === item.id ? 'nav-tab is-active' : 'nav-tab',
                text: item.label,
                onClick: () => navigate(item.id)
              })
            )
          )
        ])
      ])
    );
  }

  function render() {
    const state = store.getState();
    renderHeader();

    const ctx = {
      state,
      modelo,
      uiState,
      setUiState,
      store,
      onToast,
      onNavigate: navigate,
      onStartEncounter: startEncounter,
      onEditProfile: startEditProfile
    };

    let view;
    if (uiState.route === 'entrevista') view = renderEntrevistaView(ctx);
    else if (uiState.route === 'cruces') view = renderCrucesView(ctx);
    else if (uiState.route === 'evidencia') view = renderEvidenciaView(ctx);
    else view = renderMapaView(ctx);

    renderInto(mainNode, view);
  }

  function isEditingActiveForm() {
    if (uiState.route === 'entrevista' || uiState.route === 'evidencia') return true;
    const active = document.activeElement;
    return Boolean(
      active &&
        mainNode.contains(active) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
    );
  }

  window.addEventListener('hashchange', () => {
    handleImportFromHash();
    uiState.route = parseRoute(modelo);
    render();
  });

  store.subscribe(() => {
    if (isEditingActiveForm()) return;
    render();
  });
  handleImportFromHash();
  render();
  await store.syncFromSources();

  // Refresco automático en vivo cada 8 s solo cuando no se está escribiendo en formularios y hubo cambios reales.
  if (modelo.storageConfig?.supabaseUrl && modelo.storageConfig?.supabaseAnonKey) {
    setInterval(async () => {
      if (document.visibilityState !== 'visible' || isEditingActiveForm()) return;
      await store.syncFromSources({ background: true });
    }, 8000);
  }
}

bootstrap();
