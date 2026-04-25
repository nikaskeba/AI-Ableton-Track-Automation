import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

function createReferenceRow(id) {
  return {
    id,
    track: "",
    slot: "",
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function StatusPill({ active, children }) {
  return (
    <span className={`status-pill ${active ? "status-pill--active" : ""}`}>
      {children}
    </span>
  );
}

const TRACK_PALETTE = [
  { strong: "#5c7bde", soft: "#d8e1ff", muted: "#b9c3ea" },
  { strong: "#1693d8", soft: "#d2efff", muted: "#a8d6ef" },
  { strong: "#d1a121", soft: "#f6e39b", muted: "#ead07a" },
  { strong: "#d56f3c", soft: "#f8d4bf", muted: "#ebc0aa" },
  { strong: "#4d9a63", soft: "#d5efd8", muted: "#b9dcbf" },
  { strong: "#a06bc9", soft: "#ebdcfa", muted: "#d2b9eb" },
];
const VISIBLE_CLIP_ROWS = 8;
const VIEW_TABS = [
  { id: "session", label: "Session View" },
  { id: "arrangement", label: "Arrangement View" },
];

function getTrackPalette(trackIndex) {
  return TRACK_PALETTE[(trackIndex - 1) % TRACK_PALETTE.length];
}

function getVisibleClipSlots(trackSlots = [], richSlots = []) {
  const slotsByIndex = new Map();

  for (const slot of trackSlots) {
    slotsByIndex.set(slot.index, slot);
  }

  for (const slot of richSlots) {
    slotsByIndex.set(slot.index, {
      ...slotsByIndex.get(slot.index),
      ...slot,
    });
  }

  const rowCount = Math.max(
    VISIBLE_CLIP_ROWS,
    ...Array.from(slotsByIndex.keys(), (slotIndex) => Number(slotIndex) || 0),
  );

  return Array.from({ length: rowCount }, (_, index) => {
    const slotIndex = index + 1;
    const slot =
      slotsByIndex.get(slotIndex) || {
        index: slotIndex,
        hasClip: false,
        isPlaying: false,
        isTriggered: false,
        clip: null,
      };

    return {
      ...slot,
      hasClip: Boolean(slot.hasClip || slot.clip),
    };
  });
}

function SessionTrackColumn({
  track,
  richClipSlots = [],
  isSelectedTrack,
  selectedSlotIndex,
  onSelectTrack,
  onSelectSlot,
  onAddClipRow,
}) {
  const palette = getTrackPalette(track.index);
  const visibleSlots = getVisibleClipSlots(track.clipSlots, richClipSlots);

  return (
    <article
      className={`session-track ${isSelectedTrack ? "session-track--selected" : ""}`}
      style={{
        "--track-strong": palette.strong,
        "--track-soft": palette.soft,
        "--track-muted": palette.muted,
      }}
    >
      <button
        className="session-track__header"
        onClick={onSelectTrack}
        type="button"
      >
        <span className="session-track__title">
          {track.displayName || track.primaryDeviceName || track.name}
        </span>
      </button>

      <div className="session-track__slots">
        {visibleSlots.map((slot) => {
          const isSelectedSlot = isSelectedTrack && selectedSlotIndex === slot.index;
          const clipName = slot.clip?.name || "";
          const hasClip = Boolean(slot.hasClip || slot.clip);

          return (
            <button
              key={slot.index}
              className={`session-slot ${
                hasClip ? "session-slot--filled" : "session-slot--empty"
              } ${slot.isPlaying ? "session-slot--playing" : ""} ${
                isSelectedSlot ? "session-slot--selected" : ""
              }`}
              onClick={() => onSelectSlot(slot.index)}
              type="button"
            >
              {hasClip ? (
                <span className="session-slot__name">{clipName || `Clip ${slot.index}`}</span>
              ) : null}
            </button>
          );
        })}
        <button
          className="session-add-clip"
          onClick={onAddClipRow}
          title={`Add clip row for ${track.displayName || track.name}`}
          type="button"
        >
          +
        </button>
      </div>
    </article>
  );
}

function ArrangementView({ tracks = [], selectedTrackIndex, selectedSlotIndex, onSelectSlot }) {
  const visibleRows = Math.max(
    VISIBLE_CLIP_ROWS,
    ...tracks.flatMap((track) =>
      getVisibleClipSlots(track.clipSlots).map((slot) => slot.index),
    ),
  );
  const timelineRows = Array.from({ length: visibleRows }, (_, index) => index + 1);

  return (
    <section className="panel arrangement-panel">
      <div className="arrangement-panel__header">
        <div>
          <span className="field-label">Arrangement Sketch</span>
          <strong>Structure clips into song sections</strong>
        </div>
        <p>Session clips are shown as building blocks. The next step is writing these blocks into Ableton Arrangement.</p>
      </div>

      <div
        className="arrangement-board"
        style={{ "--arrangement-columns": timelineRows.length }}
      >
        <div className="arrangement-ruler">
          <span />
          {timelineRows.map((slotIndex) => (
            <span key={slotIndex}>Slot {slotIndex}</span>
          ))}
        </div>

        {tracks.map((track) => {
          const palette = getTrackPalette(track.index);
          const visibleSlots = getVisibleClipSlots(track.clipSlots);

          return (
            <div
              className="arrangement-lane"
              key={track.index}
              style={{
                "--track-strong": palette.strong,
                "--track-soft": palette.soft,
              }}
            >
              <button
                className="arrangement-lane__label"
                onClick={() => onSelectSlot(track.index, selectedSlotIndex || 1)}
                type="button"
              >
                {track.displayName || track.primaryDeviceName || track.name}
              </button>
              {timelineRows.map((slotIndex) => {
                const slot = visibleSlots.find((item) => item.index === slotIndex);
                const hasClip = Boolean(slot?.hasClip || slot?.clip);
                const isSelected =
                  selectedTrackIndex === track.index && selectedSlotIndex === slotIndex;

                return (
                  <button
                    className={`arrangement-cell ${
                      hasClip ? "arrangement-cell--filled" : "arrangement-cell--empty"
                    } ${isSelected ? "arrangement-cell--selected" : ""}`}
                    key={slotIndex}
                    onClick={() => onSelectSlot(track.index, slotIndex)}
                    type="button"
                  >
                    {hasClip ? (
                      <span>{slot.clip?.name || `Clip ${slotIndex}`}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatParameterValue(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function getParameterPercent(parameter, value) {
  const min = Number(parameter.min);
  const max = Number(parameter.max);
  const current = Number(value);
  const range = max - min || 1;

  if (!Number.isFinite(current) || !Number.isFinite(range)) {
    return 0;
  }

  return Math.max(0, Math.min(100, ((current - min) / range) * 100));
}

function ParameterKnob({ device, parameter, onCommit }) {
  const [draftValue, setDraftValue] = useState(Number(parameter.value));

  useEffect(() => {
    setDraftValue(Number(parameter.value));
  }, [parameter.value]);

  const min = Number(parameter.min);
  const max = Number(parameter.max);
  const step = parameter.isQuantized ? 1 : Math.max((max - min) / 100, 0.001);
  const percent = getParameterPercent(parameter, draftValue);

  function commitValue() {
    if (Number.isFinite(draftValue)) {
      onCommit(device.index, parameter.index, draftValue);
    }
  }

  return (
    <div className="parameter-knob">
      <div
        aria-hidden="true"
        className="parameter-knob__dial"
        style={{ "--knob-percent": `${percent}%` }}
      >
        <span />
      </div>
      <div className="parameter-knob__body">
        <div className="parameter-knob__topline">
          <span title={parameter.name}>{parameter.name}</span>
          <strong>{formatParameterValue(draftValue)}</strong>
        </div>
        <input
          aria-label={`${device.name} ${parameter.name}`}
          className="parameter-knob__range"
          max={max}
          min={min}
          onBlur={commitValue}
          onChange={(event) => setDraftValue(Number(event.target.value))}
          onKeyUp={(event) => {
            if (event.key === "Enter") {
              commitValue();
            }
          }}
          onPointerUp={commitValue}
          step={step}
          type="range"
          value={Number.isFinite(draftValue) ? draftValue : min}
        />
      </div>
    </div>
  );
}

function DeviceControls({ selected, onSetParameter }) {
  const devices = selected?.devices?.filter((device) => device.parameters?.length) ?? [];

  return (
    <section className="panel device-control-panel">
      <div className="device-control-panel__header">
        <div>
          <span className="field-label">Device Controls</span>
          <strong>{selected?.track?.name || "No track selected"}</strong>
        </div>
        <p>Showing the first exposed controls for each device on the selected track.</p>
      </div>

      {devices.length ? (
        <div className="device-control-stack">
          {devices.map((device) => (
            <article className="device-control-card" key={`${device.index}-${device.name}`}>
              <div className="device-control-card__header">
                <div>
                  <strong>
                    {device.index}. {device.currentPresetName ? `${device.name} - ${device.currentPresetName}` : device.name}
                  </strong>
                  <p>
                    {device.className} {device.type ? `| ${device.type}` : ""}
                  </p>
                </div>
                <StatusPill active={device.isActive}>Device On</StatusPill>
              </div>
              <div className="parameter-knob-grid">
                {device.parameters.map((parameter) => (
                  <ParameterKnob
                    device={device}
                    key={`${device.index}-${parameter.index}`}
                    onCommit={onSetParameter}
                    parameter={parameter}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="device-control-panel__empty">
          No exposed device parameters found on this track yet.
        </p>
      )}
    </section>
  );
}

function MidiNotePreview({ clip }) {
  const notes = Array.isArray(clip?.notes) ? clip.notes : [];
  const length = Number(clip?.length || 4);
  const pitches = [...new Set(notes.map((note) => note.pitch))]
    .filter((pitch) => Number.isFinite(pitch))
    .sort((a, b) => b - a);
  const beatMarkers = Array.from({ length: Math.max(1, Math.ceil(length)) }, (_, index) => index + 1);

  if (!notes.length || !pitches.length) {
    return (
      <div className="midi-preview midi-preview--empty">
        No MIDI notes to display.
      </div>
    );
  }

  return (
    <div
      className="midi-preview"
      style={{ "--beat-count": beatMarkers.length }}
    >
      <div className="midi-preview__ruler">
        <span />
        <div>
          {beatMarkers.map((beat) => (
            <span key={beat}>{beat}</span>
          ))}
        </div>
      </div>
      <div className="midi-preview__grid">
        {pitches.map((pitch) => (
          <div className="midi-preview__row" key={pitch}>
            <span className="midi-preview__pitch">{pitch}</span>
            <div className="midi-preview__lane">
              {notes
                .filter((note) => note.pitch === pitch)
                .map((note, noteIndex) => {
                  const left = Math.max(0, Math.min(100, (note.time / length) * 100));
                  const width = Math.max(1.8, Math.min(100 - left, (note.duration / length) * 100));

                  return (
                    <span
                      className="midi-preview__note"
                      key={`${pitch}-${note.time}-${noteIndex}`}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        opacity: Math.max(0.45, Math.min(1, (note.velocity || 90) / 127)),
                      }}
                      title={`Pitch ${pitch} | beat ${formatParameterValue(note.time)} | duration ${formatParameterValue(note.duration)}`}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [dashboard, setDashboard] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(1);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(null);
  const [activeView, setActiveView] = useState("session");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [isRunningAi, setIsRunningAi] = useState(false);
  const [llmResponse, setLlmResponse] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmExecutionState, setLlmExecutionState] = useState(null);
  const [commandDraft, setCommandDraft] = useState(
    "Create a MIDI idea that fits the selected track and instrument.",
  );
  const [referenceRows, setReferenceRows] = useState([]);
  const selectedTrackRef = useRef(1);
  const refreshRequestIdRef = useRef(0);
  const referenceRowIdRef = useRef(0);

  useEffect(() => {
    selectedTrackRef.current = selectedTrack;
  }, [selectedTrack]);

  const refreshDashboard = useEffectEvent(async (trackIndex, preserveMessage = true) => {
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;

    if (!preserveMessage) {
      setActionMessage("");
    }

    setError("");
    const data = await fetchJson(`/api/dashboard?track=${trackIndex}`);

    if (
      refreshRequestIdRef.current !== requestId ||
      selectedTrackRef.current !== trackIndex
    ) {
      return null;
    }

    startTransition(() => {
      setDashboard(data);
    });

    return data;
  });

  const addMidiTrack = useEffectEvent(async () => {
    setError("");
    const data = await fetchJson("/api/tracks/midi", {
      method: "POST",
    });

    startTransition(() => {
      setDashboard(data);
      setSelectedTrack(data.selectedTrack.track.index);
      setSelectedSlotIndex(data.selectedTrack.clipSlots?.[0]?.index ?? null);
    });
  });

  const addClipRow = useEffectEvent(async (trackIndex = selectedTrack) => {
    setError("");
    const data = await fetchJson("/api/scenes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trackIndex }),
    });

    startTransition(() => {
      setDashboard(data);
      setSelectedTrack(data.selectedTrack.track.index);
      setSelectedSlotIndex(data.selectedTrack.clipSlots?.at(-1)?.index ?? null);
    });
  });

  const setDeviceParameter = useEffectEvent(async (deviceIndex, parameterIndex, value) => {
    setError("");
    const data = await fetchJson("/api/device-parameter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trackIndex: selectedTrack,
        deviceIndex,
        parameterIndex,
        value,
      }),
    });

    startTransition(() => {
      setDashboard(data);
    });
  });

  const runAiToSelectedSlot = useEffectEvent(async () => {
    if (!selectedSlot?.index) {
      throw new Error("Select a clip slot first.");
    }
    const references = referenceRows
      .map((reference) => ({
        trackIndex: Number(reference.track || 0),
        slotIndex: Number(reference.slot || 0),
      }))
      .filter(
        (reference) =>
          Number.isInteger(reference.trackIndex) &&
          reference.trackIndex > 0 &&
          Number.isInteger(reference.slotIndex) &&
          reference.slotIndex > 0,
      );

    setIsRunningAi(true);
    setError("");
    setActionMessage("");

    try {
      const result = await fetchJson("/api/llm/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: commandDraft,
          trackIndex: selectedTrack,
          slotIndex: selectedSlot.index,
          references,
        }),
      });

      setLlmResponse(result.message);
      setLlmModel(result.model || "");
      setLlmExecutionState(result.execution || null);

      if (result.execution?.ok) {
        setActionMessage(result.execution.message);
        setSelectedSlotIndex(result.execution.plan.slotIndex);
        await refreshDashboard(selectedTrack, true);
      } else if (result.execution?.error) {
        setError(result.execution.error);
      }
    } finally {
      setIsRunningAi(false);
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await refreshDashboard(selectedTrack, true);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    const intervalId = window.setInterval(() => {
      refreshDashboard(selectedTrack, true).catch((pollError) => {
        setError(pollError instanceof Error ? pollError.message : String(pollError));
      });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshDashboard, selectedTrack]);

  const selected = dashboard?.selectedTrack;
  const normalizedReferences = referenceRows.map((reference) => {
    const trackIndex = Number(reference.track || 0);
    const slotIndex = Number(reference.slot || 0);
    const trackInfo = dashboard?.tracks?.find((item) => item.index === trackIndex) ?? null;

    return {
      ...reference,
      trackIndex,
      slotIndex,
      trackInfo,
      isComplete:
        Number.isInteger(trackIndex) &&
        trackIndex > 0 &&
        Number.isInteger(slotIndex) &&
        slotIndex > 0,
    };
  });

  useEffect(() => {
    const slots = getVisibleClipSlots(selected?.clipSlots);
    if (!slots.length) {
      setSelectedSlotIndex(null);
      return;
    }

    const hasSelectedSlot = selectedSlotIndex
      ? slots.some((slot) => slot.index === selectedSlotIndex)
      : false;

    if (!hasSelectedSlot) {
      const preferredSlot =
        slots.find((slot) => slot.isPlaying) ??
        slots.find((slot) => slot.hasClip) ??
        slots[0];

      setSelectedSlotIndex(preferredSlot.index);
    }
  }, [selected?.clipSlots, selectedSlotIndex]);

  const selectedVisibleSlots = getVisibleClipSlots(selected?.clipSlots);
  const selectedSlot =
    selectedVisibleSlots.find((slot) => slot.index === selectedSlotIndex) ?? null;
  const workspaceTracks =
    dashboard?.tracks?.map((track) =>
      track.index === selected?.track?.index
        ? {
            ...track,
            clipSlots: getVisibleClipSlots(track.clipSlots, selected.clipSlots),
          }
        : track,
    ) ?? [];

  function selectClipSlot(trackIndex, slotIndex) {
    startTransition(() => {
      setSelectedTrack(trackIndex);
      setSelectedSlotIndex(slotIndex);
    });
  }

  function addReferenceRow() {
    referenceRowIdRef.current += 1;
    setReferenceRows((current) => [...current, createReferenceRow(referenceRowIdRef.current)]);
  }

  function updateReferenceRow(id, field, value) {
    setReferenceRows((current) =>
      current.map((reference) =>
        reference.id === id ? { ...reference, [field]: value } : reference,
      ),
    );
  }

  function removeReferenceRow(id) {
    setReferenceRows((current) => current.filter((reference) => reference.id !== id));
  }

  return (
    <main className="app-shell">
      <div className="backdrop backdrop--left" />
      <div className="backdrop backdrop--right" />

      <header className="hero">
        <div className="hero__status">
          <StatusPill active={Boolean(dashboard?.connected)}>Bridge Online</StatusPill>
          <button
            className="secondary-button"
            onClick={() => {
              setIsLoading(true);
              refreshDashboard(selectedTrack, true)
                .catch((refreshError) => {
                  setError(
                    refreshError instanceof Error
                      ? refreshError.message
                      : String(refreshError),
                  );
                })
                .finally(() => setIsLoading(false));
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="stats-grid">
        <article className="panel stat-card">
          <span className="stat-card__label">Transport</span>
          <strong>{dashboard?.song.isPlaying ? "Playing" : "Stopped"}</strong>
          <p>Song time: {dashboard?.song.currentSongTime ?? "--"}</p>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">Tempo</span>
          <strong>{dashboard?.song.tempo ?? "--"} BPM</strong>
          <p>{dashboard?.song.sceneCount ?? "--"} scenes ready</p>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">Selected Track</span>
          <strong>{selected?.track?.name || "No track"}</strong>
          <p>
            Slot {selectedSlot?.index ?? "--"}
            {selectedSlot?.clip ? ` • ${selectedSlot.clip.name}` : " • Empty"}
          </p>
        </article>
      </section>

      <div className="view-tabs">
        {VIEW_TABS.map((tab) => (
          <button
            className={`view-tab ${activeView === tab.id ? "view-tab--active" : ""}`}
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeView === "session" ? (
        <section className="panel session-panel">
          <div className="session-board">
            {workspaceTracks.map((track) => (
              <SessionTrackColumn
                key={track.index}
                track={track}
                isSelectedTrack={track.index === selectedTrack}
                onSelectTrack={() => {
                  startTransition(() => setSelectedTrack(track.index));
                }}
                onSelectSlot={(slotIndex) => selectClipSlot(track.index, slotIndex)}
                onAddClipRow={() => {
                  addClipRow(track.index).catch((actionError) => {
                    setError(
                      actionError instanceof Error
                        ? actionError.message
                        : String(actionError),
                    );
                  });
                }}
                selectedSlotIndex={selectedSlotIndex}
              />
            ))}
            <article className="session-add-track-column">
              <button
                className="session-add-track"
                onClick={() => {
                  addMidiTrack().catch((actionError) => {
                    setError(
                      actionError instanceof Error
                        ? actionError.message
                        : String(actionError),
                    );
                  });
                }}
                title="Add MIDI track"
                type="button"
              >
                +
              </button>
            </article>
          </div>
        </section>
      ) : (
        <ArrangementView
          tracks={workspaceTracks}
          selectedTrackIndex={selectedTrack}
          selectedSlotIndex={selectedSlotIndex}
          onSelectSlot={selectClipSlot}
        />
      )}

      <section className="content-grid">
        <section className="workspace-column">
          <section className="panel detail-panel">
            <div className="detail-panel__section detail-panel__section--selected">
              <div className="selected-clip-panel">
                <div className="selected-clip-panel__header">
                  <div>
                    <span className="field-label">Selected Clip</span>
                    <strong>
                      {selected?.track?.name
                        ? `${selected.track.name} • Slot ${selectedSlot?.index ?? "--"}`
                        : "No track selected"}
                    </strong>
                  </div>
                </div>
                {selectedSlot ? (
                  <>
                    <p>
                      {selectedSlot.clip
                        ? `${selectedSlot.clip.name} • ${selectedSlot.clip.noteCount} notes • ${selectedSlot.clip.length} beats`
                        : "Empty slot"}
                    </p>
                    {selectedSlot.clip ? (
                      <>
                        <p>
                          Pitches: {selectedSlot.clip.uniquePitches.join(", ") || "none"}
                        </p>
                        <MidiNotePreview clip={selectedSlot.clip} />
                      </>
                    ) : null}
                  </>
                ) : (
                  <p>No slot selected.</p>
                )}
              </div>
            </div>
          </section>

          <DeviceControls
            selected={selected}
            onSetParameter={(deviceIndex, parameterIndex, value) => {
              setDeviceParameter(deviceIndex, parameterIndex, value).catch((actionError) => {
                setError(
                  actionError instanceof Error
                    ? actionError.message
                    : String(actionError),
                );
              });
            }}
          />
        </section>

        <aside className="panel command-panel">
          <div className="selected-slot-card selected-slot-card--hero">
            <span className="field-label">Working Context</span>
            <strong>
              {selected?.track?.name ? `Track ${selected.track.index} • ${selected.track.name}` : "No track selected"}
            </strong>
            {selectedSlot ? (
              <p>
                Slot {selectedSlot.index}
                {selectedSlot.clip
                  ? ` • ${selectedSlot.clip.name} • ${selectedSlot.clip.noteCount} notes • ${selectedSlot.clip.length} beats`
                  : " • Empty slot selected"}
              </p>
            ) : (
              <p>No slot selected.</p>
            )}
          </div>

          <div className="command-panel__actions">
            <div className="selected-slot-card">
              <div className="reference-panel__header">
                <span className="field-label">Reference Clips</span>
                <button
                  className="secondary-button reference-panel__add-button"
                  onClick={addReferenceRow}
                  type="button"
                >
                  Add Reference
                </button>
              </div>
              {normalizedReferences.length ? (
                <div className="reference-stack">
                  {normalizedReferences.map((reference, index) => (
                    <div className="reference-row-card" key={reference.id}>
                      <div className="reference-grid">
                        <label>
                          <span className="field-label">Track</span>
                          <input
                            className="slot-input"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            onChange={(event) =>
                              updateReferenceRow(reference.id, "track", event.target.value)
                            }
                            type="text"
                            value={reference.track}
                          />
                        </label>
                        <label>
                          <span className="field-label">Slot</span>
                          <input
                            className="slot-input"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            onChange={(event) =>
                              updateReferenceRow(reference.id, "slot", event.target.value)
                            }
                            type="text"
                            value={reference.slot}
                          />
                        </label>
                      </div>
                      <div className="reference-row-card__footer">
                        <p>
                          {reference.isComplete
                            ? `Reference ${index + 1}: track ${reference.trackIndex}${reference.trackInfo ? ` • ${reference.trackInfo.displayName || reference.trackInfo.name}` : ""} • slot ${reference.slotIndex}`
                            : "Fill in both track and slot to use this reference."}
                        </p>
                        <button
                          className="secondary-button reference-panel__remove-button"
                          onClick={() => removeReferenceRow(reference.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No reference clips selected. Generate from the selected track only.</p>
              )}
            </div>

            <label className="field-label" htmlFor="command">
              Prompt
            </label>
            <textarea
              id="command"
              className="prompt-input"
              value={commandDraft}
              onChange={(event) => setCommandDraft(event.target.value)}
              rows={6}
            />

            <button
              className="secondary-button command-panel__llm-button"
              disabled={isRunningAi || !selectedSlot}
              onClick={() => {
                runAiToSelectedSlot().catch((actionError) => {
                  setError(
                    actionError instanceof Error
                      ? actionError.message
                      : String(actionError),
                  );
                });
              }}
              type="button"
            >
              {isRunningAi ? "Generating And Applying..." : "Run AI On Selected Slot"}
            </button>
          </div>

          <div className="llm-response">
            <div className="llm-response__header">
              <strong>LLM Response</strong>
              <div className="llm-response__meta">
                {llmExecutionState ? (
                  <span>
                    {llmExecutionState.ok ? "Applied" : "Response Only"}
                  </span>
                ) : (
                  <span>Awaiting Run</span>
                )}
                {llmModel ? <span>{llmModel}</span> : null}
              </div>
            </div>
            {llmExecutionState?.error ? (
              <div className="llm-response__status llm-response__status--error">
                {llmExecutionState.error}
              </div>
            ) : null}
            {llmExecutionState?.message ? (
              <div className="llm-response__status">{llmExecutionState.message}</div>
            ) : null}
            <pre>{llmResponse || "No AI response yet. Run the selected slot to inspect the raw model output here."}</pre>
          </div>

          {actionMessage ? <div className="success-banner">{actionMessage}</div> : null}
        </aside>
      </section>
    </main>
  );
}
