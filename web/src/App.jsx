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

function TrackButton({ track, selected, onClick }) {
  return (
    <button
      className={`track-button ${selected ? "track-button--selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="track-button__index">{track.index}</span>
      <span className="track-button__name">{track.displayName || track.name}</span>
    </button>
  );
}

function ParameterMeter({ parameter }) {
  const range = parameter.max - parameter.min || 1;
  const percentage = ((parameter.value - parameter.min) / range) * 100;

  return (
    <div className="parameter-row">
      <div>
        <div className="parameter-row__name">{parameter.name}</div>
        <div className="parameter-row__value">
          {parameter.value.toFixed(2)} / {parameter.max}
        </div>
      </div>
      <div className="parameter-row__bar">
        <span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />
      </div>
    </div>
  );
}

function ClipSlotCard({ slot, selected, onSelect }) {
  return (
    <button
      className={`slot-card ${slot.hasClip ? "slot-card--filled" : ""} ${
        selected ? "slot-card--selected" : ""
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="slot-card__topline">
        <span>Slot {slot.index}</span>
        <StatusPill active={slot.isPlaying}>
          {slot.isPlaying ? "Playing" : slot.hasClip ? "Ready" : "Empty"}
        </StatusPill>
      </div>

      {slot.clip ? (
        <>
          <h4>{slot.clip.name}</h4>
          <p>
            {slot.clip.noteCount} notes across{" "}
            {slot.clip.uniquePitches.length || 0} pitches
          </p>
          <p>Length: {slot.clip.length} beats</p>
        </>
      ) : (
        <>
          <h4>Blank canvas</h4>
          <p>Click to target this slot for generation or execution.</p>
        </>
      )}
    </button>
  );
}

export function App() {
  const [dashboard, setDashboard] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(1);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(null);
  const [expandedDevices, setExpandedDevices] = useState({});
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
  const previousTrackIndexRef = useRef(null);
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
    const nextTrackIndex = selected?.track?.index ?? null;
    if (nextTrackIndex === null) {
      return;
    }

    if (previousTrackIndexRef.current !== nextTrackIndex) {
      previousTrackIndexRef.current = nextTrackIndex;
      setExpandedDevices({});
    }
  }, [selected?.track?.index]);

  useEffect(() => {
    const slots = selected?.clipSlots ?? [];
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

  const selectedSlot = selected?.clipSlots?.find((slot) => slot.index === selectedSlotIndex) ?? null;

  function toggleDevice(trackIndex, deviceIndex) {
    const key = `${trackIndex}-${deviceIndex}`;
    setExpandedDevices((current) => ({
      ...current,
      [key]: !current[key],
    }));
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
          <p>Live-scoped values from the current set</p>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">Scenes</span>
          <strong>{dashboard?.song.sceneCount ?? "--"}</strong>
          <p>Quick visual overview for session planning</p>
        </article>
      </section>

      <section className="content-grid">
        <aside className="panel track-list-panel">
          <div className="panel__header">
            <h2>Tracks</h2>
            <p>Select a track to inspect devices and clip slots.</p>
          </div>

          <div className="track-list">
            {dashboard?.tracks.map((track) => (
              <TrackButton
                key={track.index}
                track={track}
                selected={track.index === selectedTrack}
                onClick={() => {
                  startTransition(() => setSelectedTrack(track.index));
                }}
              />
            ))}
          </div>
        </aside>

        <section className="panel detail-panel">
          <div className="detail-panel__section">
            <div className="device-grid">
              {selected?.devices.map((device) => {
                const deviceKey = `${selected.track.index}-${device.index}`;
                const isExpanded = Boolean(expandedDevices[deviceKey]);

                return (
                  <article className="device-card" key={`${device.index}-${device.name}`}>
                    <button
                      className="device-card__toggle"
                      onClick={() => toggleDevice(selected.track.index, device.index)}
                      type="button"
                    >
                      <div className="device-card__topline">
                        <span>
                          {device.index}.{" "}
                          {device.currentPresetName
                            ? `${device.name} - ${device.currentPresetName}`
                            : device.name}
                        </span>
                        <StatusPill active={device.isActive}>{device.className}</StatusPill>
                      </div>

                      <div className="device-card__summary">
                        <p className="device-card__meta">
                          {device.type} {device.canHaveDrumPads ? "| drum rack capable" : ""}
                        </p>
                        {device.currentPresetName ? (
                          <p className="device-card__meta">
                            Preset: {device.currentPresetName}
                          </p>
                        ) : null}
                        <span className="device-card__chevron">
                          {isExpanded ? "Hide" : `Show ${Math.min(device.parameters.length, 8)} params`}
                        </span>
                      </div>
                    </button>

                    {isExpanded ? (
                      <div className="parameter-list">
                        {device.parameters.slice(0, 8).map((parameter) => (
                          <ParameterMeter
                            key={`${device.index}-${parameter.index}`}
                            parameter={parameter}
                          />
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          <div className="detail-panel__section">
            <h3>Clip Slots</h3>
            <div className="slots-grid">
              {selected?.clipSlots.map((slot) => (
                <ClipSlotCard
                  key={slot.index}
                  slot={slot}
                  selected={slot.index === selectedSlotIndex}
                  onSelect={() => setSelectedSlotIndex(slot.index)}
                />
              ))}
            </div>
          </div>
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
