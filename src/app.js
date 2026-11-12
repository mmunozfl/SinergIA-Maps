import { createStore, decodePayload, consumePendingAction } from './core/store.js';
import { consumeAuthCallback, getValidSession } from './core/auth.js';
import { getCrucesDeckItems } from './core/matcher.js';
import { el, renderInto } from './ui/dom.js';
import {
  renderMapaView,
  renderEntrevistaView,
  renderCrucesView,
  renderEvidenciaView,
  renderQuienesSomosView,
  renderAuthModal,
  renderDeleteModal
} from './ui/views.js';

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
  valid.add('evidencia');
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
    selectedNodeIds: [],
    interviewMode: 'new',
    editingProfileId: null,
    interviewStep: 0,
    interviewDraft: null,
    interviewStartedAt: Date.now(),
    interviewCompletedProfileId: null,
    deckIndex: 0,
    deckFilterMacro: '',
    deckSavedOnly: false,
    deckConnectedId: null,
    encounterTarget: null,
    authModal: null,
    deleteModal: null
  };

  const toastNode = el('div', { className: 'toast', role: 'status', 'aria-live': 'polite' });
  const modalNode = el('div', { className: 'modal-root' });
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
    el('span', { className: 'footer__program', text: modelo.programa.subtitulo })
  ]);

  renderInto(appRoot, [headerNode, mainNode, footerNode, modalNode, toastNode]);

  function hasCompletedSurvey(state) {
    return Boolean(state?.myProfileId && (state.profiles || []).some((p) => p.id === state.myProfileId));
  }

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

  function buildRouteUrl(routeId) {
    const base = `${window.location.pathname}${window.location.search}`;
    return routeId === 'mapa' ? base : `${base}#${routeId}`;
  }

  function clearDefaultMapHash() {
    if (window.location.hash === '#mapa') {
      history.replaceState(null, '', buildRouteUrl('mapa'));
    }
  }

  function createBrandIcon(altText) {
    const faviconHref = document.querySelector('link[rel="icon"]')?.getAttribute('href');
    if (faviconHref) {
      return el('img', {
        className: 'brand__icon',
        src: faviconHref,
        alt: altText,
        width: '44',
        height: '44'
      });
    }
    return el('span', { text: 'S' });
  }

  function navigate(routeId) {
    uiState.route = routeId;
    if (routeId === 'cruces') {
      uiState.deckConnectedId = null;
    }
    if (routeId === 'entrevista') {
      uiState.interviewMode = 'new';
      uiState.editingProfileId = null;
      uiState.interviewStep = 0;
      uiState.interviewDraft = null;
      uiState.interviewCompletedProfileId = null;
      uiState.interviewStartedAt = Date.now();
    }
    const targetUrl = buildRouteUrl(routeId);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== targetUrl) {
      history.pushState(null, '', targetUrl);
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
      history.pushState(null, '', buildRouteUrl('entrevista'));
    }
    render();
  }

  function startEncounter(colleague) {
    uiState.encounterTarget = colleague;
    navigate('evidencia');
  }

  function openAuthModal({ email = '', reason = '', afterVerify = { type: 'identify' } } = {}) {
    uiState.authModal = {
      email,
      reason,
      step: 'email',
      sending: false,
      verifying: false,
      error: '',
      afterVerify
    };
    renderModals();
  }

  function closeAuthModal({ keepPending = false } = {}) {
    if (!keepPending) consumePendingAction();
    uiState.authModal = null;
    renderModals();
  }

  function openDeleteModal(profile) {
    if (!profile) return;
    const hasSupabase = Boolean(modelo.storageConfig?.supabaseUrl && modelo.storageConfig?.supabaseAnonKey);
    if (hasSupabase && !store.isProfileVerifiedOwner(profile)) {
      openAuthModal({
        email: profile.correo,
        reason: 'Por seguridad, verifica tu correo antes de retirar tu ficha del mapa.',
        afterVerify: { type: 'delete', profileId: profile.id }
      });
      return;
    }
    uiState.deleteModal = { profile, deleting: false, error: '' };
    renderModals();
  }

  async function handleConfirmDelete(profile) {
    uiState.deleteModal = { ...uiState.deleteModal, deleting: true, error: '' };
    renderModals();
    try {
      await store.deleteMyProfile(profile.id);
      uiState.deleteModal = null;
      if (uiState.selectedNodeId === profile.id) {
        uiState.selectedNodeId = null;
      }
      if (Array.isArray(uiState.selectedNodeIds)) {
        uiState.selectedNodeIds = uiState.selectedNodeIds.filter((id) => id !== profile.id);
      }
      if (uiState.editingProfileId === profile.id) {
        uiState.interviewMode = 'new';
        uiState.editingProfileId = null;
        uiState.interviewDraft = null;
      }
      if (uiState.route === 'cruces' && !hasCompletedSurvey(store.getState())) {
        uiState.route = 'mapa';
        history.replaceState(null, '', buildRouteUrl('mapa'));
      }
      renderModals();
      render();
      onToast('Tu ficha fue eliminada del mapa SinergIA.');
    } catch (err) {
      if (err.code === 'AUTH_REQUIRED') {
        uiState.deleteModal = null;
        openAuthModal({
          email: profile.correo,
          reason: err.message,
          afterVerify: { type: 'delete', profileId: profile.id }
        });
        return;
      }
      uiState.deleteModal = { profile, deleting: false, error: err.message };
      renderModals();
      onToast(err.message, true);
    }
  }

  async function handleSignOut() {
    await store.signOut();
    uiState.selectedNodeId = null;
    uiState.selectedNodeIds = [];
    uiState.interviewMode = 'new';
    uiState.editingProfileId = null;
    if (uiState.route === 'cruces' && !hasCompletedSurvey(store.getState())) {
      uiState.route = 'mapa';
      history.replaceState(null, '', buildRouteUrl('mapa'));
    }
    onToast('Verificación cerrada en este navegador.');
    render();
  }

  async function handleAuthCompleted(session) {
    const inlineAfterVerify = uiState.authModal?.afterVerify || null;
    const storedPending = consumePendingAction();
    const pending = inlineAfterVerify || storedPending;

    store.setAuthSession(session);
    uiState.authModal = null;
    renderModals();

    const matched = store.getMyProfile();

    if (pending?.type === 'save_draft' && pending?.draft) {
      const verifiedEmail = session?.user?.email?.toLowerCase();
      const draftEmail = String(pending.draft.correo || '').trim().toLowerCase();
      if (verifiedEmail && draftEmail === verifiedEmail) {
        const draftToSave = {
          ...pending.draft,
          id: matched?.id || pending.draft.id,
          correo: verifiedEmail
        };
        const res = await store.saveMyInterview(draftToSave, { markAsMine: true, isEditing: true });
        if (res.remoteMode !== 'blocked') {
          uiState.route = 'entrevista';
          uiState.interviewMode = 'new';
          uiState.editingProfileId = null;
          uiState.interviewDraft = null;
          uiState.interviewStep = 0;
          uiState.interviewCompletedProfileId = res.profile.id;
          uiState.selectedNodeId = res.profile.id;
          render();
          onToast('Correo verificado y ficha actualizada en vivo.');
          return;
        }
        onToast(res.remoteError || 'No se pudo guardar la ficha verificada.', true);
      } else {
        onToast(`Verificaste ${verifiedEmail}, distinto del correo ingresado (${draftEmail}).`, true);
      }

      uiState.route = 'entrevista';
      uiState.interviewMode = matched ? 'edit' : 'new';
      uiState.editingProfileId = matched?.id || null;
      uiState.interviewDraft = pending.draft;
      render();
      return;
    }

    if (pending?.type === 'delete' && matched) {
      uiState.selectedNodeId = matched.id;
      uiState.deleteModal = { profile: matched, deleting: false, error: '' };
      render();
      renderModals();
      return;
    }

    if (pending?.type === 'edit' && matched) {
      startEditProfile(matched);
      onToast(`Identidad verificada. Editando ficha de ${matched.nombre}.`);
      return;
    }

    if (matched) {
      uiState.selectedNodeId = matched.id;
      navigate('mapa');
      onToast(`¡Hola, ${matched.nombre}! Tu ficha fue reconocida en el mapa.`);
      return;
    }

    uiState.interviewDraft = { ...(uiState.interviewDraft || {}), correo: session.user.email };
    navigate('entrevista');
    onToast(`Correo verificado (${session.user.email}). Completa la entrevista para aparecer en el mapa.`);
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
    const nextRoute = hasCompletedSurvey(store.getState()) ? 'cruces' : 'mapa';
    uiState.route = nextRoute;
    history.replaceState(null, '', buildRouteUrl(nextRoute));
  }

  function renderHeader(state) {
    const crucesUnlocked = hasCompletedSurvey(state);
    const visibleNav = (modelo.navegacion || []).filter((item) => item.id !== 'cruces' || crucesUnlocked);
    const isCrucesRoute = uiState.route === 'cruces' && crucesUnlocked;

    let conectaStrip = null;
    if (isCrucesRoute) {
      const {
        deckItems,
        rawIndex,
        isCompletedDeck,
        currentSavedCount
      } = getCrucesDeckItems(state, modelo, uiState);

      const macroSelect = el(
        'select',
        {
          className: 'topbar-conecta-select',
          'aria-label': 'Filtrar por área o vicerrectoría',
          onChange: (e) => {
            uiState.deckFilterMacro = e.target.value;
            uiState.deckIndex = 0;
            uiState.deckConnectedId = null;
            render();
          }
        },
        [
          el('option', { value: '', text: 'Todas las áreas' }),
          ...(modelo.organigramaUCM || []).map((g) =>
            el('option', {
              value: g.macroId,
              text: g.macroNombre,
              selected: uiState.deckFilterMacro === g.macroId
            })
          )
        ]
      );

      const savedBtn = el('button', {
        type: 'button',
        className: uiState.deckSavedOnly ? 'topbar-chip is-active' : 'topbar-chip',
        text: `⭐ Guardados (${currentSavedCount})`,
        title: uiState.deckSavedOnly ? 'Ver todas las fichas' : 'Ver solo colegas guardados en favoritos',
        onClick: () => {
          uiState.deckSavedOnly = !uiState.deckSavedOnly;
          uiState.deckIndex = 0;
          uiState.deckConnectedId = null;
          render();
        }
      });

      const prevBtn =
        rawIndex > 0 && deckItems.length
          ? el('button', {
              type: 'button',
              className: 'topbar-chip topbar-chip--nav',
              text: '← Anterior',
              title: 'Volver a la ficha anterior',
              onClick: () => {
                uiState.deckIndex = Math.max(0, Math.min(rawIndex, deckItems.length) - 1);
                uiState.deckConnectedId = null;
                render();
              }
            })
          : null;

      const counterText = deckItems.length
        ? isCompletedDeck
          ? `${deckItems.length} de ${deckItems.length} · Fin`
          : `${rawIndex + 1} de ${deckItems.length}`
        : '0 fichas';

      const counterBadge = el('span', {
        className: 'topbar-counter-pill',
        text: counterText,
        title: 'Progreso de recorrido de fichas'
      });

      conectaStrip = el('div', { className: 'topbar-conecta-strip' }, [
        el('div', { className: 'container topbar-conecta-inner' }, [
          el('div', { className: 'topbar-conecta-group' }, [macroSelect, savedBtn]),
          el('div', { className: 'topbar-conecta-group' }, [prevBtn, counterBadge])
        ])
      ]);
    }

    renderInto(
      headerNode,
      [
        el('div', { className: 'container topbar__inner' }, [
          el(
            'a',
            {
              className: 'brand',
              href: buildRouteUrl('mapa'),
              title: `Volver a ${modelo.programa.nombreApp}`,
              'aria-label': `Ir al inicio (${modelo.programa.nombreApp})`,
              onClick: (e) => {
                e.preventDefault();
                navigate('mapa');
              }
            },
            [
              el('div', { className: 'brand__mark' }, createBrandIcon(modelo.programa.nombreApp)),
              el('div', {}, [
                el('h1', { className: 'brand__title', text: modelo.programa.nombreApp }),
                el('p', { className: 'brand__sub', text: modelo.programa.subtitulo })
              ])
            ]
          ),
          el('div', { className: 'topbar__right' }, [
            el(
              'nav',
              { className: 'nav-tabs', 'aria-label': 'Navegación principal' },
              visibleNav.map((item) =>
                el('button', {
                  type: 'button',
                  className: uiState.route === item.id ? 'nav-tab is-active' : 'nav-tab',
                  text: item.label,
                  onClick: () => navigate(item.id)
                })
              )
            )
          ])
        ]),
        conectaStrip
      ].filter(Boolean)
    );
  }

  function renderModals() {
    const modalEl = uiState.authModal
      ? renderAuthModal({
          modalState: uiState.authModal,
          modelo,
          setModalPatch: (patch) => {
            if (!uiState.authModal) return;
            uiState.authModal = { ...uiState.authModal, ...patch };
            renderModals();
          },
          onClose: closeAuthModal,
          onAuthenticated: handleAuthCompleted,
          onToast
        })
      : uiState.deleteModal
        ? renderDeleteModal({
            deleteState: uiState.deleteModal,
            onConfirmDelete: handleConfirmDelete,
            onClose: () => {
              uiState.deleteModal = null;
              renderModals();
            }
          })
        : null;
    renderInto(modalNode, modalEl);
  }

  function render() {
    const state = store.getState();
    renderHeader(state);

    const ctx = {
      state,
      modelo,
      uiState,
      setUiState,
      store,
      onToast,
      onNavigate: navigate,
      onStartEncounter: startEncounter,
      onEditProfile: startEditProfile,
      onDeleteProfile: openDeleteModal,
      onOpenAuthModal: openAuthModal,
      onSignOut: handleSignOut
    };

    let view;
    if (uiState.route === 'entrevista') view = renderEntrevistaView(ctx);
    else if (uiState.route === 'cruces') view = renderCrucesView(ctx);
    else if (uiState.route === 'evidencia') view = renderEvidenciaView(ctx);
    else if (uiState.route === 'quienes-somos') view = renderQuienesSomosView(ctx);
    else view = renderMapaView(ctx);

    renderInto(mainNode, view);
    renderModals();
  }

  function isEditingActiveForm() {
    if (uiState.authModal || uiState.deleteModal) return true;
    if (uiState.route === 'entrevista' || uiState.route === 'evidencia') return true;
    const active = document.activeElement;
    return Boolean(
      active &&
        mainNode.contains(active) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
    );
  }

  function syncRouteFromUrl() {
    handleImportFromHash();
    uiState.route = parseRoute(modelo);
    clearDefaultMapHash();
    render();
  }

  window.addEventListener('hashchange', syncRouteFromUrl);
  window.addEventListener('popstate', syncRouteFromUrl);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (uiState.authModal && !uiState.authModal.sending) {
      closeAuthModal({ keepPending: uiState.authModal.step === 'sent' });
    } else if (uiState.deleteModal && !uiState.deleteModal.deleting) {
      uiState.deleteModal = null;
      renderModals();
    }
  });

  store.subscribe(() => {
    if (isEditingActiveForm()) return;
    render();
  });

  const authCallback = await consumeAuthCallback(modelo.storageConfig || {});
  handleImportFromHash();
  clearDefaultMapHash();
  render();
  await store.syncFromSources();

  if (authCallback.status === 'authenticated') {
    await handleAuthCompleted(authCallback.session);
  } else {
    if (authCallback.status === 'error') {
      onToast(authCallback.error, true);
    }
    const validSession = await getValidSession(modelo.storageConfig || {});
    if (validSession) {
      store.setAuthSession(validSession);
    } else if (store.getState().authUser) {
      store.setAuthSession(null, { clearLocalIdentity: true });
    }
    render();
  }

  // Refresco automático en vivo cada 8 s solo cuando no se está escribiendo en formularios y hubo cambios reales.
  if (modelo.storageConfig?.supabaseUrl && modelo.storageConfig?.supabaseAnonKey) {
    setInterval(async () => {
      if (document.visibilityState !== 'visible' || isEditingActiveForm()) return;
      await store.syncFromSources({ background: true });
    }, 8000);
  }
}

bootstrap();
