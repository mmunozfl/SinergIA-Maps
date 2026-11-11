import { el, buildFormFields, readFormValues } from './dom.js';
import { renderSynergyDiagram } from './graph.js';
import { validateBySchema, decodePayload } from '../core/store.js';
import { buildSynergyNetwork, filterProfiles, suggestMatches, computeMetrics, collectCommunityTags } from '../core/matcher.js';
import {
  buildTeamsChatUrl,
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
    'aria-label': 'Fecha y hora para invitación de calendario'
  });

  const btnTeams = el('a', {
    className: 'btn btn--primary btn--sm',
    href: buildTeamsChatUrl(colleague, myProfile),
    target: '_blank',
    rel: 'noopener noreferrer',
    text: 'Chat Teams'
  });

  const btnCalendar = el('button', {
    type: 'button',
    className: 'btn btn--secondary btn--sm',
    text: `Agendar ${modelo.duracionReunionMinutos}m (.ics)`,
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
        onToast('Invitación .ics descargada para Outlook / Teams.');
      } catch (err) {
        onToast(err.message, true);
      }
    }
  });

  const btnEvidence = el('button', {
    type: 'button',
    className: 'btn btn--ghost btn--sm',
    text: 'Acta BUK',
    onClick: () => onStartEncounter(colleague)
  });

  return el('div', { className: 'colleague-actions' }, [
    el('div', { className: 'colleague-actions__row' }, [btnTeams, btnCalendar, btnEvidence]),
    el('div', { className: 'colleague-actions__schedule' }, [
      el('span', { className: 'muted-xs', text: 'Hora sugerida para .ics:' }),
      dateInput
    ])
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

  const diagramPanel = el('section', { className: 'card' }, [
    el('div', { className: 'card__header' }, [
      el('div', {}, [
        el('h2', { text: 'Mapa Interactivo de Sinergia vs. Organigrama UCM' }),
        el('p', {
          className: 'muted',
          text: 'Alterna entre la Red de Sinergia y el Organigrama oficial UCM (mayo 2026) para ver dónde se ubica cada colega y sus cruces.'
        })
      ]),
      el('button', {
        type: 'button',
        className: 'btn btn--primary',
        text: 'Nueva Entrevista SinergIA',
        onClick: () => onNavigate('entrevista')
      })
    ]),
    renderSynergyDiagram({
      network,
      modelo,
      mode: uiState.diagramMode || 'red',
      selectedId: uiState.selectedNodeId,
      myProfileId: state.myProfileId,
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

  return el('div', { className: 'view-stack' }, [metricsBar, layout]);
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
 * Vista 3: Directorio y Cruces + Importador/Exportador.
 */
export function renderCrucesView({ state, modelo, uiState, setUiState, store, onToast, onStartEncounter, onEditProfile }) {
  const myProfile = state.profiles.find((p) => p.id === state.myProfileId) || null;
  const filters = uiState.filters || { query: '', macroId: '', conductaId: '', onlyOtherAreas: false };
  const canManageLocal = canManageLocalProfiles();

  const filtered = filterProfiles(state.profiles, { ...filters, myProfile });

  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Buscar por nombre, facultad, unidad o tema...',
    value: filters.query,
    onInput: (e) => setUiState({ filters: { ...filters, query: e.target.value } })
  });

  const macroSelect = el(
    'select',
    {
      onChange: (e) => setUiState({ filters: { ...filters, macroId: e.target.value } })
    },
    [
      el('option', { value: '', text: 'Todas las Vicerrectorías / Facultades' }),
      ...(modelo.organigramaUCM || []).map((g) =>
        el('option', { value: g.macroId, text: g.macroNombre, selected: filters.macroId === g.macroId })
      )
    ]
  );

  const conductaSelect = el(
    'select',
    {
      onChange: (e) => setUiState({ filters: { ...filters, conductaId: e.target.value } })
    },
    [
      el('option', { value: '', text: 'Todas las Conductas Clave' }),
      ...(modelo.conductas || []).map((c) =>
        el('option', { value: c.id, text: `${c.numero}. ${c.titulo}`, selected: filters.conductaId === c.id })
      )
    ]
  );

  const onlyOtherCheckbox = el('label', { className: 'checkbox-inline' }, [
    el('input', {
      type: 'checkbox',
      checked: Boolean(filters.onlyOtherAreas),
      onChange: (e) => setUiState({ filters: { ...filters, onlyOtherAreas: e.target.checked } })
    }),
    ' Solo mostrar otras unidades'
  ]);

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
      if (totalProfiles > 0) onToast(`Se importaron ${totalProfiles} ficha(s) al directorio.`);
      fileInput.value = '';
    }
  });

  const pasteInput = el('input', {
    type: 'text',
    placeholder: 'Pega aquí un enlace #import=... compartido por un colega'
  });

  const importPanel = el('details', { className: 'card import-box' }, [
    el('summary', { text: 'Importar o respaldar respuestas reales (JSON / Enlace)' }),
    el('div', { className: 'import-box__body' }, [
      el('div', { className: 'import-row' }, [
        el('label', { text: 'Cargar uno o varios archivos .json:' }),
        fileInput
      ]),
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
              const payload = decodePayload(token);
              const res = store.importBundle(payload);
              pasteInput.value = '';
              onToast(`Importado correctamente (${res.importedProfiles} ficha).`);
            } catch {
              onToast('El enlace pegado no tiene un formato válido.', true);
            }
          }
        })
      ]),
      el('div', { className: 'import-row' }, [
        el('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          text: 'Exportar índice JSON (para respaldo en GitHub)',
          onClick: () => {
            downloadTextFile('index.json', JSON.stringify(state.profiles, null, 2), 'application/json;charset=utf-8');
            onToast('Archivo index.json descargado con todas las fichas reales.');
          }
        }),
        canManageLocal && state.profiles.length
          ? el('button', {
              type: 'button',
              className: 'btn btn--danger btn--sm',
              text: 'Limpiar fichas locales de prueba',
              title: 'Borra únicamente los datos guardados en este navegador (no elimina filas en Supabase).',
              onClick: () => {
                if (!window.confirm('¿Vaciar todas las fichas guardadas en este navegador? (No afecta a Supabase)')) return;
                store.clearAll();
                setUiState({ selectedNodeId: null });
                onToast('Fichas locales eliminadas. La app quedó limpia.');
              }
            })
          : null
      ])
    ])
  ]);

  const listNode = filtered.length
    ? el(
        'div',
        { className: 'cards-grid' },
        filtered.map((p) =>
          el('article', { className: 'card profile-card' }, [
            el('div', { className: 'profile-card__head' }, [
              el('span', { className: 'pill', text: p.macroNombre }),
              el('div', { className: 'profile-card__meta' }, [
                p.duracionSegundos
                  ? el('span', { className: 'muted-xs', text: `⏱ ${formatDuration(p.duracionSegundos)}` })
                  : null,
                canManageLocal && onEditProfile
                  ? el('button', {
                      type: 'button',
                      className: 'btn btn--ghost btn--sm',
                      text: 'Editar',
                      title: 'Editar unidad o respuestas de esta ficha',
                      onClick: () => onEditProfile(p)
                    })
                  : null,
                canManageLocal
                  ? el('button', {
                      type: 'button',
                      className: 'btn btn--ghost btn--sm',
                      text: 'Eliminar',
                      title: 'Eliminar esta ficha de prueba del navegador',
                      onClick: () => {
                        store.removeProfile(p.id);
                        if (uiState.selectedNodeId === p.id) setUiState({ selectedNodeId: null });
                        onToast(`Ficha de ${p.nombre} eliminada de este navegador.`);
                      }
                    })
                  : null
              ])
            ]),
            el('h3', { text: p.nombre }),
            el('p', { className: 'muted', text: `${p.cargo} · ${p.area}` }),
            el('p', { className: 'profile-card__desc', text: p.queHace }),
            el('div', { className: 'profile-card__tags' }, [
              el('span', { className: 'muted-xs', text: 'Puede apoyar en:' }),
              renderTagList(p.temasAyudo, 'work')
            ]),
            p.interesesComunes?.length
              ? el('div', { className: 'profile-card__tags' }, [
                  el('span', { className: 'muted-xs', text: 'Afinidades:' }),
                  renderTagList(p.interesesComunes, 'human')
                ])
              : null,
            createActionButtonsForColleague(p, myProfile, modelo, onToast, onStartEncounter)
          ])
        )
      )
    : el('div', { className: 'card empty-box' }, [
        el('p', { text: state.profiles.length ? 'No hay resultados con los filtros actuales.' : modelo.programa.guiaVacio })
      ]);

  return el('div', { className: 'view-stack' }, [
    el('div', { className: 'card filters-bar' }, [searchInput, macroSelect, conductaSelect, onlyOtherCheckbox]),
    importPanel,
    listNode
  ]);
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
