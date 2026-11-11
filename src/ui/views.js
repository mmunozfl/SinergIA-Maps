import { el, buildFormFields, readFormValues } from './dom.js';
import { renderSynergyDiagram } from './graph.js';
import { validateBySchema, decodePayload } from '../core/store.js';
import {
  analyzePairSynergy,
  buildSynergyNetwork,
  suggestMatches,
  computeMetrics,
  collectCommunityTags
} from '../core/matcher.js';
import {
  buildTeamsChatUrl,
  buildTeamsMeetingUrl,
  buildIcsInvite,
  buildShareUrl,
  buildEvidenceMarkdown,
  findModelLabel,
  downloadTextFile,
  exportSvgNode
} from '../core/exporters.js';

function canManageLocalProfiles() {
  return (
    new URLSearchParams(window.location.search).get('admin') === '1' ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  );
}

function getInitials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'UCM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function svgIcon(paths, { fill = 'none', stroke = 'currentColor', strokeWidth = 2.4, size = 24 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', fill);
  svg.setAttribute('stroke', stroke);
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function attachHorizontalSwipe(cardEl, { onSwipeLeft, onSwipeRight, isDisabled }) {
  let startX = 0;
  let startY = 0;
  let activePointerId = null;
  let dx = 0;
  let dragging = false;

  const stampLeft = cardEl.querySelector('.deck-stamp--left');
  const stampRight = cardEl.querySelector('.deck-stamp--right');

  const resetVisual = () => {
    cardEl.classList.remove('is-dragging');
    cardEl.style.transform = '';
    if (stampLeft) stampLeft.style.opacity = '0';
    if (stampRight) stampRight.style.opacity = '0';
  };

  cardEl.addEventListener('pointerdown', (e) => {
    if (isDisabled() || e.button > 0) return;
    if (e.target.closest('button, a, input, select, summary, label')) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = true;
    cardEl.classList.add('is-dragging');
    cardEl.setPointerCapture?.(activePointerId);
  });

  cardEl.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    cardEl.style.transform = `translate3d(${dx}px, ${dy * 0.12}px, 0) rotate(${(dx * 0.035).toFixed(2)}deg)`;
    const progress = Math.min(1, Math.max(0, (Math.abs(dx) - 18) / 72));
    if (stampRight) stampRight.style.opacity = dx > 0 ? String(progress) : '0';
    if (stampLeft) stampLeft.style.opacity = dx < 0 ? String(progress) : '0';
  });

  const finishGesture = (e) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    if (dx >= 85) {
      resetVisual();
      onSwipeRight();
      return;
    }
    if (dx <= -85) {
      resetVisual();
      onSwipeLeft();
      return;
    }
    resetVisual();
  };

  cardEl.addEventListener('pointerup', finishGesture);
  cardEl.addEventListener('pointercancel', finishGesture);
}

function defaultMeetingTime() {
  const dt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  dt.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function createActionButtonsForColleague(colleague, myProfile, modelo, onToast, onStartEncounter) {
  const dateInput = el('input', {
    type: 'datetime-local',
    className: 'mini-datetime',
    value: defaultMeetingTime(),
    'aria-label': 'Fecha y hora sugerida para la reunión en Teams'
  });

  const buildMeetingHref = () =>
    buildTeamsMeetingUrl({
      targetProfile: colleague,
      myProfile,
      startDateTimeLocal: dateInput.value,
      durationMinutes: modelo.duracionReunionMinutos
    });

  const btnTeams = el('a', {
    className: 'btn btn--primary btn--sm',
    href: buildTeamsChatUrl(colleague, myProfile),
    target: '_blank',
    rel: 'noopener noreferrer',
    text: 'Chat Teams'
  });

  const btnTeamsMeeting = el('a', {
    className: 'btn btn--secondary btn--sm',
    href: buildMeetingHref(),
    target: '_blank',
    rel: 'noopener noreferrer',
    text: `Agendar ${modelo.duracionReunionMinutos}m en Teams`,
    onClick: () => {
      try {
        btnTeamsMeeting.setAttribute('href', buildMeetingHref());
        onToast('Teams abierto con la invitación de 15 min lista para enviar.');
      } catch (err) {
        onToast(err.message, true);
      }
    }
  });

  dateInput.addEventListener('change', () => {
    try {
      btnTeamsMeeting.setAttribute('href', buildMeetingHref());
    } catch {
      // Si el usuario limpia parcialmente la fecha, se mantiene el último enlace válido.
    }
  });

  const btnIcsFallback = el('button', {
    type: 'button',
    className: 'btn-link-subtle',
    text: '(.ics)',
    title: 'Alternativa: descargar archivo .ics para Outlook de escritorio',
    onClick: () => {
      try {
        const ics = buildIcsInvite({
          targetProfile: colleague,
          myProfile,
          startDateTimeLocal: dateInput.value,
          durationMinutes: modelo.duracionReunionMinutos
        });
        const slug = colleague.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        downloadTextFile(`sinergia-${slug}.ics`, ics, 'text/calendar;charset=utf-8');
        onToast('Invitación .ics descargada.');
      } catch (err) {
        onToast(err.message, true);
      }
    }
  });

  const btnEvidence =
    canManageLocalProfiles() && onStartEncounter
      ? el('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          text: 'Acta BUK',
          onClick: () => onStartEncounter(colleague)
        })
      : null;

  return el('div', { className: 'colleague-actions' }, [
    el('div', { className: 'colleague-actions__row' }, [btnTeams, btnTeamsMeeting, btnEvidence]),
    el('div', { className: 'colleague-actions__schedule' }, [
      el('span', { className: 'muted-xs', text: 'Horario sugerido:' }),
      dateInput,
      btnIcsFallback
    ]),
    el('p', {
      className: 'muted-xs colleague-actions__hint',
      text: 'Teams envía la invitación oficial con Aceptar/Rechazar; si necesita otro horario pueden coordinarlo por Chat Teams.'
    })
  ]);
}

function renderTagList(items = [], variant = 'work') {
  if (!items.length) return null;
  return el(
    'div',
    { className: 'tag-list' },
    items.map((tag) => el('span', { className: `badge badge--${variant}`, text: tag }))
  );
}

/**
 * Vista 1: Mapa Vivo SinergIA + Analítica + Inspector.
 */
export function renderMapaView({ state, modelo, uiState, setUiState, onToast, onNavigate, onStartEncounter, onEditProfile }) {
  const network = buildSynergyNetwork(state.profiles);
  const metrics = computeMetrics(state, network);
  const myProfile = state.profiles.find((p) => p.id === state.myProfileId) || null;
  const selectedProfile = state.profiles.find((p) => p.id === uiState.selectedNodeId) || null;

  const metricsBar = el('section', { className: 'metrics-grid' }, [
    metricCard(metrics.totalProfiles, 'Funcionarios entrevistados'),
    metricCard(metrics.totalAreas, 'Unidades / Facultades'),
    metricCard(metrics.crossMacroEdges, 'Puentes inter-áreas'),
    metricCard(formatDuration(metrics.avgDurationSeconds), 'Tiempo prom. entrevista'),
    metricCard(metrics.totalEncounters, 'Actas para BUK')
  ]);

  const diagramPanel = el('section', { className: 'card card--mapa' }, [
    el('div', { className: 'card__header card__header--compact' }, [
      el('div', {}, [
        el('h2', { text: 'Mapa Interactivo de Sinergia vs. Organigrama UCM' }),
        el('p', {
          className: 'muted',
          text: 'Alterna entre la Red de Sinergia y el Organigrama oficial UCM (mayo 2026) para explorar conexiones y hacer clic en cualquier colega.'
        })
      ])
    ]),
    renderSynergyDiagram({
      network,
      modelo,
      mode: uiState.diagramMode || 'red',
      selectedId: uiState.selectedNodeId,
      myProfileId: state.myProfileId,
      onNewInterview: () => onNavigate('entrevista'),
      onSelectNode: (nodeId) => {
        setUiState({ selectedNodeId: uiState.selectedNodeId === nodeId ? null : nodeId });
      },
      onToggleMode: (nextMode) => setUiState({ diagramMode: nextMode }),
      onExportSvg: (svgNode) => {
        exportSvgNode(svgNode, 'mapa-sinergia-ucm.svg');
        onToast('Mapa SVG descargado para adjuntar en BUK o presentaciones.');
      }
    })
  ]);

  const inspectorContent = selectedProfile
    ? renderInspectorCard(selectedProfile, state.profiles, myProfile, modelo, onToast, onStartEncounter, onEditProfile)
    : renderInsightsSummary(network, modelo);

  const layout = el('div', { className: 'mapa-layout' }, [
    el('div', { className: 'mapa-main' }, [diagramPanel]),
    el('aside', { className: 'mapa-aside' }, [inspectorContent])
  ]);

  return el('div', { className: 'view-stack' }, [layout, metricsBar]);
}

function metricCard(value, label) {
  return el('div', { className: 'metric-card' }, [
    el('strong', { className: 'metric-card__value', text: String(value) }),
    el('span', { className: 'metric-card__label', text: label })
  ]);
}

function renderInspectorCard(profile, allProfiles, myProfile, modelo, onToast, onStartEncounter, onEditProfile) {
  const matches = suggestMatches(profile, allProfiles).filter((m) => m.analysis.score > 0).slice(0, 3);
  return el('div', { className: 'card inspector-card' }, [
    el('div', { className: 'inspector-card__top' }, [
      el('div', { className: 'profile-card__head' }, [
        el('span', { className: 'pill', text: profile.macroNombre }),
        canManageLocalProfiles() && onEditProfile
          ? el('button', {
              type: 'button',
              className: 'btn btn--ghost btn--sm',
              text: 'Editar ficha',
              onClick: () => onEditProfile(profile)
            })
          : null
      ]),
      el('h3', { text: profile.nombre }),
      el('p', { className: 'muted', text: `${profile.cargo} · ${profile.area}` }),
      profile.antiguedad ? el('p', { className: 'muted-xs', text: `Antigüedad UCM: ${profile.antiguedad}` }) : null,
      profile.duracionSegundos
        ? el('p', { className: 'muted-xs', text: `Respondió en ${formatDuration(profile.duracionSegundos)}` })
        : null
    ]),
    el('div', { className: 'inspector-section' }, [
      el('h4', { text: 'Qué hace en el día a día' }),
      el('p', { text: profile.queHace })
    ]),
    el('div', { className: 'inspector-section' }, [
      el('h4', { text: 'Puede orientar / ayudar en' }),
      renderTagList(profile.temasAyudo, 'work'),
      el('p', { className: 'muted-sm', text: profile.detalleAyudo })
    ]),
    el('div', { className: 'inspector-section' }, [
      el('h4', { text: 'Busca coordinar / aprender' }),
      renderTagList(profile.temasBusco, 'seek'),
      profile.detalleBusco ? el('p', { className: 'muted-sm', text: profile.detalleBusco }) : null
    ]),
    el('div', { className: 'inspector-section' }, [
      el('h4', { text: 'Fortaleza y puente humano' }),
      el('p', { className: 'muted-sm', text: findModelLabel(modelo, 'conductas', profile.conductaFortaleza) }),
      renderTagList(profile.interesesComunes, 'human'),
      el('p', { className: 'muted-sm', text: `Dato UCM (Onboarding): ${profile.datoOnboarding}` })
    ]),
    matches.length
      ? el('div', { className: 'inspector-section' }, [
          el('h4', { text: 'Conexiones principales descubiertas' }),
          el(
            'ul',
            { className: 'mini-matches' },
            matches.map((m) =>
              el('li', {}, [
                el('strong', { text: `${m.profile.nombre} (${m.profile.area}): ` }),
                el('span', { text: m.analysis.reasons.join(' · ') })
              ])
            )
          )
        ])
      : null,
    createActionButtonsForColleague(profile, myProfile, modelo, onToast, onStartEncounter)
  ]);
}

function renderInsightsSummary(network, modelo) {
  return el('div', { className: 'card' }, [
    el('h3', { text: 'Hallazgos en tiempo real' }),
    el('p', { className: 'muted', text: modelo.programa.propositoAcordado }),
    network.insights.topTopics.length
      ? el('div', { className: 'inspector-section' }, [
          el('h4', { text: 'Temas más frecuentes en la red' }),
          el(
            'ul',
            { className: 'topic-bars' },
            network.insights.topTopics.map((item) =>
              el('li', {}, [
                el('span', { text: item.topic }),
                el('strong', { text: `${item.count}` })
              ])
            )
          )
        ])
      : el('p', { className: 'muted-sm', text: 'Completa entrevistas para visualizar los puntos en común entre áreas.' }),
    el('div', { className: 'inspector-section' }, [
      el('h4', { text: 'Cómo leer las conexiones' }),
      el('p', { className: 'muted-sm', text: 'El dorado resalta pares donde un funcionario ofrece exactamente lo que otro busca aprender o destrabar.' })
    ])
  ]);
}

/**
 * Vista 2: Entrevista conversacional guiada "SinergIA" (siempre inicia limpia para entrevistar a otro colega, con cronómetro).
 */
export function renderEntrevistaView({ state, modelo, uiState, setUiState, store, onToast, onNavigate, onStartEncounter }) {
  const pasos = modelo.entrevistaPasos || [];
  const stepIdx = Math.min(Math.max(0, uiState.interviewStep || 0), pasos.length - 1);
  const currentStep = pasos[stepIdx];

  if (uiState.interviewCompletedProfileId) {
    const completed = state.profiles.find((p) => p.id === uiState.interviewCompletedProfileId);
    if (completed) {
      return renderInterviewSuccess(completed, state.profiles, modelo, setUiState, onToast, onNavigate, onStartEncounter);
    }
  }

  const startedAt = uiState.interviewStartedAt || Date.now();
  if (!uiState.interviewStartedAt) {
    uiState.interviewStartedAt = startedAt;
  }

  const editTargetId = uiState.editingProfileId || state.myProfileId;
  const targetProfile = state.profiles.find((p) => p.id === editTargetId) || null;
  const isEditing = uiState.interviewMode === 'edit' && Boolean(targetProfile);
  const draft = isEditing
    ? { ...targetProfile, ...(uiState.interviewDraft || {}) }
    : { ...(uiState.interviewDraft || {}) };

  const timerBadge = isEditing
    ? el('span', { className: 'pill pill--gold', text: `Editando ficha de ${targetProfile.nombre}` })
    : el('span', {
        className: 'timer-pill',
        text: `⏱ ${formatClock((Date.now() - startedAt) / 1000)}`
      });

  const timerInterval = isEditing
    ? null
    : setInterval(() => {
        if (!timerBadge.isConnected) {
          clearInterval(timerInterval);
          return;
        }
        timerBadge.textContent = `⏱ ${formatClock((Date.now() - startedAt) / 1000)}`;
      }, 1000);

  const topMeta = el('div', { className: 'interview-meta' }, [
    timerBadge,
    !isEditing && targetProfile
      ? el('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          text: `Editar ficha anterior (${targetProfile.nombre.split(' ')[0]})`,
          onClick: () =>
            setUiState({
              interviewMode: 'edit',
              editingProfileId: targetProfile.id,
              interviewStep: 0,
              interviewDraft: { ...targetProfile },
              interviewStartedAt: Date.now()
            })
        })
      : isEditing
        ? el('button', {
            type: 'button',
            className: 'btn btn--ghost btn--sm',
            text: '+ Cancelar edición y entrevistar a otra persona',
            onClick: () =>
              setUiState({
                interviewMode: 'new',
                editingProfileId: null,
                interviewStep: 0,
                interviewDraft: null,
                interviewStartedAt: Date.now()
              })
          })
        : null
  ]);

  const stepper = el(
    'div',
    { className: 'stepper' },
    pasos.map((p, idx) =>
      el(
        'button',
        {
          type: 'button',
          className:
            idx === stepIdx
              ? 'stepper__item is-active'
              : idx < stepIdx || isEditing
                ? 'stepper__item is-done'
                : 'stepper__item',
          disabled: !isEditing && idx > stepIdx,
          title: isEditing ? `Ir al paso ${p.numero}: ${p.titulo}` : '',
          onClick: () => {
            if (!isEditing) return;
            const stepValues = readFormValues(formEl, currentStep.campos);
            setUiState({
              interviewDraft: { ...draft, ...stepValues },
              interviewStep: idx
            });
          }
        },
        [
          el('span', { className: 'stepper__num', text: String(p.numero) }),
          el('span', { className: 'stepper__label', text: p.titulo })
        ]
      )
    )
  );

  const formEl = el('form', { className: 'interview-form', noValidate: true });
  const bubble = el('div', { className: 'ai-bubble' }, [
    el('span', { className: 'ai-bubble__badge', text: `SinergIA · Paso ${stepIdx + 1} de ${pasos.length}` }),
    el('p', { text: currentStep.intro })
  ]);

  const extraTagsBySource = {};
  for (const [sourceKey, baseList] of Object.entries(modelo.etiquetasSugeridas || {})) {
    extraTagsBySource[sourceKey] = collectCommunityTags(state.profiles, sourceKey, baseList);
  }

  formEl.appendChild(buildFormFields(currentStep.campos, modelo, draft, extraTagsBySource));

  const errorBox = el('div', { className: 'form-errors', hidden: true });
  formEl.appendChild(errorBox);

  const actions = el('div', { className: 'form-actions' }, [
    stepIdx > 0
      ? el('button', {
          type: 'button',
          className: 'btn btn--ghost',
          text: '← Anterior',
          onClick: () => {
            const stepValues = readFormValues(formEl, currentStep.campos);
            setUiState({
              interviewDraft: { ...draft, ...stepValues },
              interviewStep: stepIdx - 1
            });
          }
        })
      : el('span'),
    el('div', { className: 'form-actions__right' }, [
      isEditing && stepIdx < pasos.length - 1
        ? el('button', {
            type: 'button',
            className: 'btn btn--secondary',
            text: 'Guardar cambios ahora',
            onClick: () => submitInterview(true)
          })
        : null,
      el('button', {
        type: 'submit',
        className: 'btn btn--primary',
        text: stepIdx < pasos.length - 1 ? 'Siguiente →' : isEditing ? 'Guardar cambios' : 'Finalizar entrevista y conectar'
      })
    ])
  ]);
  formEl.appendChild(actions);

  async function submitInterview(saveImmediately = false) {
    const stepValues = readFormValues(formEl, currentStep.campos);
    const errors = validateBySchema(currentStep.campos, stepValues);
    if (errors.length) {
      errorBox.hidden = false;
      errorBox.replaceChildren(...errors.map((msg) => el('p', { text: msg })));
      return;
    }
    errorBox.hidden = true;
    const mergedDraft = { ...draft, ...stepValues };

    if (!saveImmediately && stepIdx < pasos.length - 1) {
      setUiState({ interviewDraft: mergedDraft, interviewStep: stepIdx + 1 });
      return;
    }

    if (isEditing) {
      for (let i = 0; i < pasos.length; i += 1) {
        const stepErrs = validateBySchema(pasos[i].campos, mergedDraft);
        if (stepErrs.length) {
          setUiState({ interviewDraft: mergedDraft, interviewStep: i });
          onToast(`Revisa el paso ${i + 1}: ${stepErrs[0]}`, true);
          return;
        }
      }
    }

    if (timerInterval) clearInterval(timerInterval);
    if (!isEditing) {
      mergedDraft.duracionSegundos = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      delete mergedDraft.id;
    } else {
      mergedDraft.id = targetProfile.id;
      mergedDraft.duracionSegundos = targetProfile.duracionSegundos;
      delete mergedDraft.macroId;
      delete mergedDraft.macroNombre;
    }

    const markAsMine = !isEditing || targetProfile.id === state.myProfileId;
    const result = await store.saveMyInterview(mergedDraft, { markAsMine });
    if (result.remoteError) {
      onToast(`Guardado local OK. Nota nube: ${result.remoteError}`, true);
    } else if (isEditing) {
      onToast(`Ficha de ${result.profile.nombre} actualizada.`);
    } else {
      onToast(`Entrevista registrada en ${formatDuration(mergedDraft.duracionSegundos)}.`);
    }

    setUiState({
      interviewMode: 'new',
      editingProfileId: null,
      interviewDraft: null,
      interviewStep: 0,
      interviewStartedAt: null,
      interviewCompletedProfileId: result.profile.id,
      selectedNodeId: result.profile.id
    });
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submitInterview(false);
  });

  return el('div', { className: 'card interview-card' }, [topMeta, stepper, bubble, formEl]);
}

function renderInterviewSuccess(profile, allProfiles, modelo, setUiState, onToast, onNavigate, onStartEncounter) {
  const matches = suggestMatches(profile, allProfiles).filter((m) => m.analysis.score > 0).slice(0, 4);
  const shareUrl = buildShareUrl(profile);

  return el('div', { className: 'card success-card' }, [
    el('span', {
      className: 'pill pill--gold',
      text: `Entrevista completada${profile.duracionSegundos ? ` en ${formatDuration(profile.duracionSegundos)}` : ''}`
    }),
    el('h2', { text: `¡Gracias, ${profile.nombre}!` }),
    el('p', {
      className: 'muted',
      text: 'Tus respuestas ya aparecen en el Mapa SinergIA y en la vista sobre el Organigrama UCM.'
    }),
    el('div', { className: 'success-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn--primary',
        text: 'Ver en el Mapa SinergIA',
        onClick: () => {
          setUiState({ interviewCompletedProfileId: null });
          onNavigate('mapa');
        }
      }),
      el('button', {
        type: 'button',
        className: 'btn btn--secondary',
        text: '+ Entrevistar a otro colega',
        onClick: () =>
          setUiState({
            interviewCompletedProfileId: null,
            interviewMode: 'new',
            interviewStep: 0,
            interviewDraft: null,
            interviewStartedAt: Date.now()
          })
      }),
      el('button', {
        type: 'button',
        className: 'btn btn--ghost',
        text: 'Descargar JSON',
        onClick: () => {
          const slug = profile.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          downloadTextFile(`${slug}.json`, JSON.stringify(profile, null, 2), 'application/json;charset=utf-8');
          onToast('Archivo JSON descargado.');
        }
      }),
      el('button', {
        type: 'button',
        className: 'btn btn--ghost',
        text: 'Copiar enlace ficha',
        onClick: async () => {
          await navigator.clipboard?.writeText(shareUrl);
          onToast('Enlace de ficha copiado al portapapeles.');
        }
      })
    ]),
    el('div', { className: 'inspector-section' }, [
      el('h3', { text: 'Conexiones interáreas descubiertas hoy' }),
      matches.length
        ? el(
            'div',
            { className: 'cards-grid' },
            matches.map((m) =>
              el('div', { className: 'match-card' }, [
                el('strong', { text: m.profile.nombre }),
                el('p', { className: 'muted-sm', text: `${m.profile.cargo} · ${m.profile.area}` }),
                el('p', { className: 'match-reasons', text: m.analysis.reasons.join(' · ') }),
                createActionButtonsForColleague(m.profile, profile, modelo, onToast, onStartEncounter)
              ])
            )
          )
        : el('p', {
            className: 'muted-sm',
            text: 'A medida que respondan más funcionarios de otras unidades, sus cruces aparecerán aquí y en el Mapa.'
          })
    ])
  ]);
}

/**
 * Vista 3: Conectar Áreas — Tarjetas verticales 1-a-1 deslizables para descubrir apoyo entre colegas.
 */
export function renderCrucesView({
  state,
  modelo,
  uiState,
  setUiState,
  store,
  onToast,
  onNavigate,
  onStartEncounter,
  onEditProfile
}) {
  const myProfile = state.profiles.find((p) => p.id === state.myProfileId) || null;
  const savedIds = Array.isArray(state.savedIds) ? state.savedIds : [];
  const canManageLocal = canManageLocalProfiles();

  const others = myProfile ? state.profiles.filter((p) => p.id !== myProfile.id) : state.profiles;
  const isSoloSelfPreview = Boolean(myProfile && state.profiles.length === 1);
  const basePool = isSoloSelfPreview ? state.profiles : others;

  const filteredPool = basePool.filter((p) => {
    if (uiState.deckFilterMacro && p.macroId !== uiState.deckFilterMacro) return false;
    if (uiState.deckSavedOnly && !savedIds.includes(p.id)) return false;
    return true;
  });

  const deckItems = filteredPool
    .map((p) => ({
      profile: p,
      synergy: myProfile && p.id !== myProfile.id ? analyzePairSynergy(myProfile, p) : null
    }))
    .sort((a, b) => {
      if (a.synergy && b.synergy && b.synergy.score !== a.synergy.score) {
        return b.synergy.score - a.synergy.score;
      }
      return (b.profile.updatedAt || '').localeCompare(a.profile.updatedAt || '') ||
        a.profile.nombre.localeCompare(b.profile.nombre);
    });

  const rawIndex = Math.max(0, uiState.deckIndex || 0);
  const isCompletedDeck = deckItems.length > 0 && rawIndex >= deckItems.length;
  const currentItem = !isCompletedDeck && deckItems.length ? deckItems[rawIndex] : null;
  const current = currentItem?.profile || null;
  const currentSavedCount = savedIds.filter((id) => basePool.some((p) => p.id === id)).length;

  const macroSelect = el(
    'select',
    {
      className: 'deck-select',
      'aria-label': 'Filtrar por Facultad o Vicerrectoría',
      onChange: (e) =>
        setUiState({ deckFilterMacro: e.target.value, deckIndex: 0, deckConnectedId: null })
    },
    [
      el('option', { value: '', text: 'Todas las áreas UCM' }),
      ...(modelo.organigramaUCM || []).map((g) =>
        el('option', {
          value: g.macroId,
          text: g.macroNombre,
          selected: uiState.deckFilterMacro === g.macroId
        })
      )
    ]
  );

  const savedFilterBtn = el('button', {
    type: 'button',
    className: uiState.deckSavedOnly ? 'btn btn--secondary btn--sm' : 'btn btn--ghost btn--sm',
    text: `Guardados (${currentSavedCount})`,
    onClick: () =>
      setUiState({
        deckSavedOnly: !uiState.deckSavedOnly,
        deckIndex: 0,
        deckConnectedId: null
      })
  });

  const topbar = el('div', { className: 'card deck-topbar' }, [
    el('div', { className: 'deck-topbar__filters' }, [macroSelect, savedFilterBtn]),
    el('div', { className: 'deck-topbar__progress' }, [
      rawIndex > 0 && deckItems.length
        ? el('button', {
            type: 'button',
            className: 'btn btn--ghost btn--sm',
            text: '← Anterior',
            onClick: () =>
              setUiState({ deckIndex: Math.max(0, Math.min(rawIndex, deckItems.length) - 1), deckConnectedId: null })
          })
        : null,
      el('span', {
        text: deckItems.length
          ? isCompletedDeck
            ? `${deckItems.length} de ${deckItems.length}`
            : `${rawIndex + 1} de ${deckItems.length}`
          : '0 fichas'
      })
    ])
  ]);

  const stage = el('div', { className: 'deck-stage' });

  const advanceDeck = () => {
    setUiState({ deckIndex: rawIndex + 1, deckConnectedId: null });
  };

  if (isSoloSelfPreview) {
    stage.appendChild(
      el('div', { className: 'info-banner' }, [
        el('strong', { text: 'Vista previa con tu propia ficha' }),
        el('p', {
          text: 'Aún eres el primer registro en vivo. Cuando tus colegas respondan la encuesta, verás aquí sus tarjetas para explorar y conectar.'
        })
      ])
    );
  }

  if (!deckItems.length) {
    const emptyMsg = !state.profiles.length
      ? modelo.programa.guiaVacio
      : uiState.deckSavedOnly
        ? 'Todavía no guardas colegas en favoritos. Usa el ícono central de guardar en cualquier tarjeta para revisarlo más tarde.'
        : 'No hay funcionarios registrados en esa área con los filtros actuales.';
    stage.appendChild(
      el('div', { className: 'card deck-empty' }, [
        el('h3', { text: 'Sin tarjetas para mostrar aquí' }),
        el('p', { className: 'muted', text: emptyMsg }),
        el('div', { className: 'button-row', style: 'justify-content: center;' }, [
          uiState.deckFilterMacro || uiState.deckSavedOnly
            ? el('button', {
                type: 'button',
                className: 'btn btn--secondary',
                text: 'Ver todos los colegas',
                onClick: () => setUiState({ deckFilterMacro: '', deckSavedOnly: false, deckIndex: 0, deckConnectedId: null })
              })
            : el('button', {
                type: 'button',
                className: 'btn btn--cta',
                text: 'Responder Entrevista',
                onClick: () => onNavigate('entrevista')
              })
        ])
      ])
    );
  } else if (isCompletedDeck) {
    stage.appendChild(
      el('div', { className: 'card deck-empty' }, [
        el('h3', { text: 'Recorrido completado' }),
        el('p', {
          className: 'muted',
          text: `Revisaste las ${deckItems.length} fichas disponibles en esta selección.`
        }),
        el('div', { className: 'button-row', style: 'justify-content: center;' }, [
          el('button', {
            type: 'button',
            className: 'btn btn--primary',
            text: 'Volver al inicio',
            onClick: () => setUiState({ deckIndex: 0, deckConnectedId: null })
          }),
          currentSavedCount && !uiState.deckSavedOnly
            ? el('button', {
                type: 'button',
                className: 'btn btn--secondary',
                text: `Ver Guardados (${currentSavedCount})`,
                onClick: () => setUiState({ deckSavedOnly: true, deckIndex: 0, deckConnectedId: null })
              })
            : null
        ])
      ])
    );
  } else if (current) {
    const isSaved = savedIds.includes(current.id);
    const isConnected = uiState.deckConnectedId === current.id;
    const synergy = currentItem.synergy;

    const cardEl = el('article', { className: isConnected ? 'deck-card is-connected' : 'deck-card' }, [
      el('span', { className: 'deck-stamp deck-stamp--right', text: 'Conectar' }),
      el('span', { className: 'deck-stamp deck-stamp--left', text: 'Siguiente' }),
      el('header', { className: 'deck-card__hero' }, [
        el('div', { className: 'deck-avatar', 'aria-hidden': 'true', text: getInitials(current.nombre) }),
        el('div', { className: 'deck-card__identity' }, [
          el('div', { className: 'deck-card__badges' }, [
            el('span', { className: 'deck-pill', text: current.macroNombre }),
            synergy && synergy.score > 0
              ? el('span', {
                  className: 'deck-pill deck-pill--gold',
                  text: synergy.crossMacro ? 'Puente interáreas' : 'Afinidad detectada'
                })
              : null,
            isSaved ? el('span', { className: 'deck-pill', text: 'Guardado' }) : null
          ]),
          el('h3', { text: current.nombre }),
          el('p', { className: 'deck-card__role', text: `${current.cargo} · ${current.area}` })
        ])
      ]),
      el('div', { className: 'deck-card__body' }, [
        el('section', { className: 'deck-section' }, [
          el('span', { className: 'deck-section__title', text: 'En qué puede ayudarte' }),
          renderTagList(current.temasAyudo, 'work'),
          current.detalleAyudo ? el('p', { className: 'deck-section__detail', text: current.detalleAyudo }) : null
        ]),
        el('section', { className: 'deck-section' }, [
          el('span', { className: 'deck-section__title', text: 'Ayudas o temas que necesita' }),
          current.temasBusco?.length
            ? renderTagList(current.temasBusco, 'seek')
            : el('p', { className: 'muted-xs', text: 'Abierto a conversar entre áreas.' }),
          current.detalleBusco ? el('p', { className: 'deck-section__detail', text: current.detalleBusco }) : null
        ]),
        el('section', { className: 'deck-section deck-section--icebreaker' }, [
          el('span', { className: 'deck-section__title', text: 'Gustos personales y dato UCM' }),
          current.interesesComunes?.length
            ? renderTagList(current.interesesComunes, 'human')
            : el('p', { className: 'muted-xs', text: 'Sin gustos registrados.' }),
          current.datoOnboarding ? el('p', { className: 'deck-section__detail', text: current.datoOnboarding }) : null,
          current.disponibilidad
            ? el('p', { className: 'muted-xs', style: 'margin-top: 0.35rem;', text: `Disponibilidad: ${current.disponibilidad}` })
            : null
        ])
      ])
    ]);

    attachHorizontalSwipe(cardEl, {
      onSwipeLeft: advanceDeck,
      onSwipeRight: () => setUiState({ deckConnectedId: current.id }),
      isDisabled: () => isConnected
    });

    stage.appendChild(cardEl);

    const btnSkip = el('button', {
      type: 'button',
      className: 'deck-btn deck-btn--skip',
      'aria-label': 'Pasar al siguiente colega',
      title: 'Pasar al siguiente (flecha izquierda)',
      onClick: advanceDeck
    });
    btnSkip.appendChild(svgIcon(['M18 6L6 18', 'M6 6l12 12'], { strokeWidth: 2.8 }));

    const btnSave = el('button', {
      type: 'button',
      className: isSaved ? 'deck-btn deck-btn--save is-saved' : 'deck-btn deck-btn--save',
      'aria-label': isSaved ? 'Quitar de guardados' : 'Guardar en favoritos para ver después',
      title: isSaved ? 'Quitar de guardados' : 'Guardar para después',
      onClick: () => {
        const added = store.toggleSavedProfile(current.id);
        onToast(added ? `${current.nombre} guardado en tus favoritos.` : `${current.nombre} quitado de favoritos.`);
      }
    });
    btnSave.appendChild(
      svgIcon(['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'], {
        fill: isSaved ? 'currentColor' : 'none',
        strokeWidth: 2.3,
        size: 22
      })
    );

    const btnConnect = el('button', {
      type: 'button',
      className: isConnected ? 'deck-btn deck-btn--connect is-active' : 'deck-btn deck-btn--connect',
      'aria-label': 'Conectar por Teams',
      title: 'Conectar con este colega (flecha derecha)',
      onClick: () => setUiState({ deckConnectedId: current.id })
    });
    btnConnect.appendChild(svgIcon(['M20 6L9 17l-5-5'], { strokeWidth: 3 }));

    stage.appendChild(
      el('div', { className: 'deck-actions' }, [
        el('div', { className: 'deck-action-item' }, [btnSkip, el('span', { className: 'deck-action-label', text: 'Saltar' })]),
        el('div', { className: 'deck-action-item' }, [
          btnSave,
          el('span', { className: 'deck-action-label', text: isSaved ? 'Guardado' : 'Guardar' })
        ]),
        el('div', { className: 'deck-action-item' }, [btnConnect, el('span', { className: 'deck-action-label', text: 'Conectar' })])
      ])
    );

    if (isConnected) {
      const iceTopic = current.interesesComunes?.[0] || current.temasAyudo?.[0] || current.area;
      stage.appendChild(
        el('div', { className: 'deck-connect-panel' }, [
          el('div', { className: 'deck-connect-panel__head' }, [
            el('h4', { text: `Conecta con ${current.nombre}` }),
            el('span', { className: 'pill pill--gold', text: current.correo })
          ]),
          el('p', {
            className: 'muted-sm',
            text: `Tema para romper el hielo: "${iceTopic}". Inicia un chat directo o envía invitación oficial de 15 min por Teams:`
          }),
          createActionButtonsForColleague(current, myProfile, modelo, onToast, onStartEncounter),
          el('div', { className: 'deck-connect-panel__footer' }, [
            el('button', {
              type: 'button',
              className: 'btn btn--ghost btn--sm',
              text: 'Seguir explorando colegas →',
              onClick: advanceDeck
            })
          ])
        ])
      );
    }

    const onKeyDown = (e) => {
      if (!stage.isConnected) {
        window.removeEventListener('keydown', onKeyDown);
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft') {
        window.removeEventListener('keydown', onKeyDown);
        advanceDeck();
      } else if (e.key === 'ArrowRight' && !isConnected) {
        window.removeEventListener('keydown', onKeyDown);
        setUiState({ deckConnectedId: current.id });
      }
    };
    window.addEventListener('keydown', onKeyDown);
  }

  let adminPanel = null;
  if (canManageLocal) {
    const fileInput = el('input', {
      type: 'file',
      accept: '.json,application/json',
      multiple: true,
      onChange: async (e) => {
        const files = [...(e.target.files || [])];
        if (!files.length) return;
        let totalProfiles = 0;
        for (const file of files) {
          try {
            const parsed = JSON.parse(await file.text());
            const res = store.importBundle(parsed);
            totalProfiles += res.importedProfiles;
          } catch (err) {
            onToast(`Error al importar ${file.name}: ${err.message}`, true);
          }
        }
        if (totalProfiles > 0) onToast(`Se importaron ${totalProfiles} ficha(s).`);
        fileInput.value = '';
      }
    });

    const pasteInput = el('input', {
      type: 'text',
      placeholder: 'Pega un enlace #import=...'
    });

    adminPanel = el('details', { className: 'card import-box deck-admin-footer' }, [
      el('summary', { text: 'Herramientas locales de administración (JSON / Edición)' }),
      el('div', { className: 'import-box__body' }, [
        current
          ? el('div', { className: 'import-row' }, [
              onEditProfile
                ? el('button', {
                    type: 'button',
                    className: 'btn btn--ghost btn--sm',
                    text: `Editar ficha actual (${current.nombre})`,
                    onClick: () => onEditProfile(current)
                  })
                : null,
              el('button', {
                type: 'button',
                className: 'btn btn--ghost btn--sm',
                text: 'Quitar de caché local',
                onClick: () => {
                  store.removeProfile(current.id);
                  setUiState({ deckIndex: 0, deckConnectedId: null });
                  onToast(`Ficha de ${current.nombre} eliminada de este navegador.`);
                }
              })
            ])
          : null,
        el('div', { className: 'import-row' }, [el('label', { text: 'Importar JSON:' }), fileInput]),
        el('div', { className: 'import-row' }, [
          pasteInput,
          el('button', {
            type: 'button',
            className: 'btn btn--secondary btn--sm',
            text: 'Importar enlace',
            onClick: () => {
              try {
                const raw = pasteInput.value.trim();
                const token = raw.includes('#import=') ? raw.split('#import=')[1] : raw;
                const res = store.importBundle(decodePayload(token));
                pasteInput.value = '';
                onToast(`Importado correctamente (${res.importedProfiles} ficha).`);
              } catch {
                onToast('Enlace inválido.', true);
              }
            }
          })
        ]),
        el('div', { className: 'import-row' }, [
          el('button', {
            type: 'button',
            className: 'btn btn--ghost btn--sm',
            text: 'Exportar índice JSON',
            onClick: () => {
              downloadTextFile('index.json', JSON.stringify(state.profiles, null, 2), 'application/json;charset=utf-8');
              onToast('index.json descargado.');
            }
          }),
          state.profiles.length
            ? el('button', {
                type: 'button',
                className: 'btn btn--danger btn--sm',
                text: 'Limpiar caché local',
                onClick: () => {
                  if (!window.confirm('¿Vaciar fichas locales de este navegador? (No afecta a Supabase)')) return;
                  store.clearAll();
                  setUiState({ selectedNodeId: null, deckIndex: 0, deckConnectedId: null });
                  onToast('Caché local limpia.');
                }
              })
            : null
        ])
      ])
    ]);
  }

  return el('div', { className: 'deck-shell' }, [topbar, stage, adminPanel]);
}

/**
 * Vista 4: Evidencia BUK y Marco Sintoniza / Susan Long.
 */
export function renderEvidenciaView({ state, modelo, uiState, setUiState, store, onToast }) {
  const myProfile = state.profiles.find((p) => p.id === state.myProfileId) || null;
  const today = new Date().toISOString().slice(0, 10);

  const infoBanner = modelo.programa.guiaBuk
    ? el('div', { className: 'info-banner no-print' }, [
        el('strong', { text: modelo.programa.guiaBuk.titulo }),
        el('p', { text: modelo.programa.guiaBuk.descripcion })
      ])
    : null;

  const initial = {
    fecha: today,
    participanteA: myProfile ? `${myProfile.nombre} — ${myProfile.area}` : '',
    participanteB: uiState.encounterTarget
      ? `${uiState.encounterTarget.nombre} — ${uiState.encounterTarget.area}`
      : '',
    conductaId: 'c1',
    tipoAccion: 'conocernos',
    etapaId: 'transicion',
    responsableRegistro: myProfile ? `${myProfile.nombre} (${myProfile.correo})` : ''
  };

  const formEl = el('form', { className: 'card no-print', noValidate: true }, [
    el('h2', { text: 'Generar comprobante / acta para subir a BUK' }),
    el('p', {
      className: 'muted',
      text: 'Paso 03 del programa Sintoniza: documenta aquí lo implementado y descárgalo en PDF o texto para tu respaldo en BUK.'
    })
  ]);

  formEl.appendChild(buildFormFields(modelo.camposEncuentro, modelo, initial));
  const errorBox = el('div', { className: 'form-errors', hidden: true });
  formEl.appendChild(errorBox);

  formEl.appendChild(
    el('div', { className: 'form-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn--secondary',
        text: 'Imprimir / Guardar PDF para BUK',
        onClick: () => window.print()
      }),
      el('button', { type: 'submit', className: 'btn btn--primary', text: 'Guardar acta de evidencia' })
    ])
  );

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = readFormValues(formEl, modelo.camposEncuentro);
    const errors = validateBySchema(modelo.camposEncuentro, values);
    if (errors.length) {
      errorBox.hidden = false;
      errorBox.replaceChildren(...errors.map((m) => el('p', { text: m })));
      return;
    }
    errorBox.hidden = true;
    store.addEncounter(values);
    setUiState({ encounterTarget: null });
    onToast('Acta guardada. Puedes copiar el texto o imprimir en PDF para subirlo a BUK.');
  });

  const referenceAccordion = el('details', { className: 'card no-print' }, [
    el('summary', { text: 'Referencia rápida: Modelo Susan Long y Conductas Clave (Sintoniza UCM)' }),
    el('div', { className: 'reference-grid' }, [
      el('div', {}, [
        el('h4', { text: 'Etapas de Sinergia (Long y Hording, 2013)' }),
        ...(modelo.etapas || []).map((st) =>
          el('div', { className: 'ref-item' }, [
            el('strong', { text: st.nombre }),
            el('p', { className: 'muted-sm', text: `${st.descripcion} Ej.: "${st.ejemplo}"` })
          ])
        )
      ]),
      el('div', {}, [
        el('h4', { text: 'Las 4 Conductas Clave UCM' }),
        ...(modelo.conductas || []).map((c) =>
          el('div', { className: 'ref-item' }, [
            el('strong', { text: `${c.numero}. ${c.titulo}` }),
            el('p', { className: 'muted-sm', text: c.descripcion })
          ])
        )
      ])
    ])
  ]);

  const logsSection = el('section', { className: 'card print-area' }, [
    el('div', { className: 'print-header' }, [
      el('h2', { text: `Evidencias de Sinergia Organizacional — ${modelo.programa.institucion}` }),
      el('p', { className: 'muted-sm', text: modelo.programa.subtitulo })
    ]),
    state.encounters.length
      ? el(
          'div',
          { className: 'encounters-list' },
          state.encounters.map((enc) =>
            el('article', { className: 'encounter-item' }, [
              el('div', { className: 'encounter-item__head' }, [
                el('strong', { text: `${enc.participanteA} ↔ ${enc.participanteB}` }),
                el('span', { className: 'pill', text: enc.fecha })
              ]),
              el('p', {
                className: 'muted-sm',
                text: `${findModelLabel(modelo, 'tiposAccion', enc.tipoAccion)} · ${findModelLabel(modelo, 'conductas', enc.conductaId)} · Etapa: ${findModelLabel(modelo, 'etapas', enc.etapaId)}`
              }),
              el('p', {}, [el('strong', { text: 'Aprendizaje: ' }), enc.aprendizaje]),
              el('p', {}, [el('strong', { text: 'Acuerdo concreto: ' }), enc.acuerdo]),
              el('p', { className: 'muted-xs', text: `Responsable registro BUK: ${enc.responsableRegistro}` }),
              el('div', { className: 'encounter-item__actions no-print' }, [
                el('button', {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm',
                  text: 'Copiar texto para BUK',
                  onClick: async () => {
                    await navigator.clipboard?.writeText(buildEvidenceMarkdown(enc, modelo));
                    onToast('Acta copiada al portapapeles para pegar en BUK.');
                  }
                }),
                el('button', {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm',
                  text: 'Eliminar',
                  onClick: () => store.removeEncounter(enc.id)
                })
              ])
            ])
          )
        )
      : el('p', { className: 'muted', text: 'Aún no hay actas guardadas. Registra arriba un encuentro realizado para generar tu evidencia PDF/texto.' })
  ]);

  return el('div', { className: 'view-stack' }, [infoBanner, formEl, referenceAccordion, logsSection]);
}

/**
 * Vista 5: ¿Quiénes somos? — Transparencia y propósito institucional de la encuesta SinergIA.
 */
export function renderQuienesSomosView({ modelo, onNavigate }) {
  const qs = modelo.quienesSomos || {};
  const autor = modelo.programa?.autor;

  const heroCard = el('section', { className: 'card about-hero' }, [
    el('span', { className: 'pill', text: `${modelo.programa.institucion} · ${modelo.programa.titulo}` }),
    el('h2', { text: qs.titulo || '¿Quiénes somos y por qué existe esta encuesta?' }),
    el('p', { className: 'about-hero__lead', text: qs.intro || modelo.programa.propositoAcordado }),
    el('div', { className: 'button-row' }, [
      el('button', {
        type: 'button',
        className: 'btn btn--cta',
        text: 'Responder Entrevista ahora',
        onClick: () => onNavigate('entrevista')
      }),
      el('button', {
        type: 'button',
        className: 'btn btn--ghost',
        text: 'Ver Mapa en vivo',
        onClick: () => onNavigate('mapa')
      })
    ])
  ]);

  const pillarsGrid = Array.isArray(qs.pilares) && qs.pilares.length
    ? el(
        'section',
        { className: 'about-pillars' },
        qs.pilares.map((pilar) =>
          el('article', { className: 'card about-pillar' }, [
            el('h3', { text: pilar.titulo }),
            el('p', { className: 'muted', text: pilar.descripcion })
          ])
        )
      )
    : null;

  const trustCard = el('section', { className: 'card' }, [
    el('div', { className: 'about-trust-grid' }, [
      el('div', {}, [
        el('h3', { text: qs.garantiasTitulo || 'Transparencia y tranquilidad al responder' }),
        el(
          'ul',
          { className: 'about-list' },
          (qs.garantias || []).map((item) => el('li', { text: item }))
        ),
        autor?.correo
          ? el('p', { className: 'muted-sm' }, [
              '¿Tienes dudas o comentarios antes de responder? Escríbenos a ',
              el('a', {
                className: 'footer__author',
                href: `mailto:${autor.correo}`,
                text: autor.correo
              }),
              '.'
            ])
          : null
      ]),
      el('div', {}, [
        el('h3', { text: 'Conductas Clave que fortalecemos en la UCM' }),
        ...(modelo.conductas || []).map((c) =>
          el('div', { className: 'ref-item' }, [
            el('strong', { text: `${c.numero}. ${c.titulo}` }),
            el('p', { className: 'muted-sm', text: c.descripcion })
          ])
        )
      ])
    ])
  ]);

  return el('div', { className: 'view-stack' }, [heroCard, pillarsGrid, trustCard]);
}
