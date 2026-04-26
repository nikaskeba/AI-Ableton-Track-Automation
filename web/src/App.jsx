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
const DEFAULT_TEMPLATE_PROMPT = "electronic ambient";

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
  const deviceLabel = track.displayName && track.displayName !== track.name
    ? track.displayName
    : track.primaryDeviceName;

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
        <span className="session-track__title">{track.name}</span>
        {deviceLabel ? (
          <span className="session-track__subtitle">{deviceLabel}</span>
        ) : null}
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

function getVisibleScenes(scenes = [], rowCount = VISIBLE_CLIP_ROWS) {
  const scenesByIndex = new Map(scenes.map((scene) => [scene.index, scene]));
  const visibleCount = Math.max(
    VISIBLE_CLIP_ROWS,
    rowCount,
    ...Array.from(scenesByIndex.keys(), (sceneIndex) => Number(sceneIndex) || 0),
  );

  return Array.from({ length: visibleCount }, (_, index) => {
    const sceneIndex = index + 1;
    return (
      scenesByIndex.get(sceneIndex) || {
        index: sceneIndex,
        name: `Scene ${sceneIndex}`,
        isTriggered: false,
        isEmpty: true,
      }
    );
  });
}

function SessionSceneColumn({ onAddScene, rowCount, scenes = [], selectedSlotIndex }) {
  const visibleScenes = getVisibleScenes(scenes, rowCount);

  return (
    <article className="session-scenes">
      <div className="session-scenes__header">Scenes</div>
      <div className="session-scenes__slots">
        {visibleScenes.map((scene) => (
          <button
            className={`session-scene ${
              selectedSlotIndex === scene.index ? "session-scene--selected" : ""
            } ${scene.isTriggered ? "session-scene--triggered" : ""}`}
            key={scene.index}
            type="button"
          >
            <span>{scene.name || `Scene ${scene.index}`}</span>
          </button>
        ))}
        <button
          className="session-add-scene"
          onClick={onAddScene}
          title="Add scene"
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
                {track.name}
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

function DeviceControls({ aiTarget, selected, onSelectDevice, onSetParameter }) {
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
            <article
              className={`device-control-card ${
                aiTarget?.type === "device" && aiTarget.deviceIndex === device.index
                  ? "device-control-card--targeted"
                  : ""
              }`}
              key={`${device.index}-${device.name}`}
            >
              <div className="device-control-card__header">
                <div>
                  <strong>
                    {device.index}. {device.currentPresetName ? `${device.name} - ${device.currentPresetName}` : device.name}
                  </strong>
                  <p>
                    {device.className} {device.type ? `| ${device.type}` : ""}
                  </p>
                </div>
                <div className="device-control-card__actions">
                  <StatusPill active={device.isActive}>Device On</StatusPill>
                  <button
                    className="secondary-button device-control-card__target"
                    onClick={() => onSelectDevice(device.index)}
                    type="button"
                  >
                    {aiTarget?.type === "device" && aiTarget.deviceIndex === device.index
                      ? "AI Target"
                      : "Target AI"}
                  </button>
                </div>
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

function MidiNotePreview({ clip, isTargeted, onSelect }) {
  const notes = Array.isArray(clip?.notes) ? clip.notes : [];
  const length = Number(clip?.length || 4);
  const pitches = [...new Set(notes.map((note) => note.pitch))]
    .filter((pitch) => Number.isFinite(pitch))
    .sort((a, b) => b - a);
  const beatMarkers = Array.from({ length: Math.max(1, Math.ceil(length)) }, (_, index) => index + 1);

  if (!notes.length || !pitches.length) {
    return (
      <button
        className={`midi-preview midi-preview--empty ${
          isTargeted ? "midi-preview--targeted" : ""
        }`}
        onClick={onSelect}
        type="button"
      >
        No MIDI notes to display.
      </button>
    );
  }

  return (
    <button
      className={`midi-preview ${isTargeted ? "midi-preview--targeted" : ""}`}
      onClick={onSelect}
      style={{ "--beat-count": beatMarkers.length }}
      type="button"
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
    </button>
  );
}

function getTemplateTargetLabel(target) {
  const role =
    target?.mode === "drum"
      ? "drums"
      : target?.instrument?.name || target?.trackName || "clip";
  const preset = target?.instrument?.currentPresetName
    ? ` • ${target.instrument.currentPresetName}`
    : "";

  return `${role}${preset}: ${target?.clipName || "unnamed clip"}`;
}

function TemplateBuilder({
  isRunningStepOne,
  isRunningStepTwo,
  isRunningReferenceAnchor,
  isGeneratingTemplateParts,
  templateGenerationStatus,
  onRunStepOne,
  onRunStepTwo,
  onRunReferenceAnchor,
  onRunTemplateParts,
  referenceAnchorResult,
  templatePartsResult,
  foundationPlan,
  plan,
  prompt,
  setPrompt,
}) {
  const canRunStepTwo = Boolean(prompt.trim());
  const canRunReferenceAnchor = Boolean(prompt.trim());

  return (
    <section className="panel template-builder">
      <div className="template-builder__header">
        <div>
          <span className="field-label">Template Builder</span>
          <strong>Template foundation workflow</strong>
        </div>
        <StatusPill active={Boolean(referenceAnchorResult || foundationPlan)}>
          {referenceAnchorResult ? "Step 3" : foundationPlan ? "Step 2" : plan ? "Step 1" : "Ready"}
        </StatusPill>
      </div>

      <div className="template-builder__body">
        <label>
          <span className="field-label">User Prompt</span>
          <input
            className="template-builder__input"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="electronic ambient"
            type="text"
            value={prompt}
          />
        </label>
        <div className="template-builder__actions">
          <button
            className="secondary-button template-builder__run"
            disabled={isRunningStepOne || !prompt.trim()}
            onClick={onRunStepOne}
            type="button"
          >
            {isRunningStepOne ? "Creating Tracks..." : "Run Step 1 Setup"}
          </button>
          <button
            className="primary-button template-builder__run"
            disabled={isRunningStepTwo || !canRunStepTwo}
            onClick={onRunStepTwo}
            type="button"
          >
            {isRunningStepTwo ? "Naming Scenes..." : "Run Step 2 Foundation"}
          </button>
          <button
            className="primary-button template-builder__run"
            disabled={isRunningReferenceAnchor || !canRunReferenceAnchor}
            onClick={onRunReferenceAnchor}
            type="button"
          >
            {isRunningReferenceAnchor ? "Writing Anchor..." : "Run Step 3 Reference Anchor"}
          </button>
          <button
            className="primary-button template-builder__run"
            disabled={isGeneratingTemplateParts || !canRunReferenceAnchor}
            onClick={onRunTemplateParts}
            type="button"
          >
            {isGeneratingTemplateParts ? "Generating Parts..." : "Run Step 4 Remaining Clips"}
          </button>
        </div>
      </div>

      <div className="template-builder__steps">
        <div className={`template-step ${plan ? "template-step--complete" : "template-step--active"}`}>
          <span>1</span>
          <div>
            <strong>Create skeleton</strong>
            <p>Set tempo and create/rename tracks.</p>
          </div>
        </div>
        <div
          className={`template-step ${
            foundationPlan ? "template-step--complete" : plan ? "template-step--active" : ""
          }`}
        >
          <span>2</span>
          <div>
            <strong>Name foundation</strong>
            <p>Create scene names and placeholder clip names.</p>
          </div>
        </div>
        <div
          className={`template-step ${
            referenceAnchorResult
              ? "template-step--complete"
              : foundationPlan || plan
                ? "template-step--active"
                : ""
          }`}
        >
          <span>3</span>
          <div>
            <strong>Create reference anchor</strong>
            <p>Generate the first harmonic MIDI reference only.</p>
          </div>
        </div>
        <div
          className={`template-step ${
            templatePartsResult
              ? "template-step--complete"
              : referenceAnchorResult
                ? "template-step--active"
                : ""
          }`}
        >
          <span>4</span>
          <div>
            <strong>Generate reference scene</strong>
            <p>Fill only Scene 1 clips from the anchor.</p>
          </div>
        </div>
      </div>

      {plan ? (
        <div className="template-plan">
          <div className="template-plan__summary">
            <span>{plan.style}</span>
            <strong>{plan.bpm} BPM</strong>
          </div>
          <div className="template-plan__tracks">
            {plan.tracks.map((track, index) => (
              <div className="template-plan__track" key={`${track.name}-${index}`}>
                <span>{index + 1}</span>
                <strong>{track.name}</strong>
              </div>
            ))}
          </div>
          <p>{plan.nextStep || "Select sounds manually for each track."}</p>
        </div>
      ) : null}

      {foundationPlan ? (
        <p className="template-builder__compact-status">
          Foundation added: {foundationPlan.scenes?.length ?? 0} scenes prepared.
        </p>
      ) : null}
      {referenceAnchorResult ? (
        <p className="template-builder__compact-status">
          Reference anchor added: Track {referenceAnchorResult.reference?.trackIndex ?? 1} / Slot{" "}
          {referenceAnchorResult.reference?.slotIndex ?? 1}.
        </p>
      ) : null}
      {templatePartsResult ? (
        <p className="template-builder__compact-status">
          Remaining clips: {templatePartsResult.generatedCount ?? 0} /{" "}
          {templatePartsResult.targetCount ?? 0} generated.
        </p>
      ) : null}
      {templateGenerationStatus ? (
        <p className="template-builder__compact-status template-builder__compact-status--live">
          {templateGenerationStatus}
        </p>
      ) : null}
    </section>
  );
}

export function App() {
  const [dashboard, setDashboard] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(1);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(null);
  const [activeView, setActiveView] = useState("session");
  const [aiTarget, setAiTarget] = useState({ type: "clip" });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [isRunningAi, setIsRunningAi] = useState(false);
  const [llmResponse, setLlmResponse] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmExecutionState, setLlmExecutionState] = useState(null);
  const [templatePrompt, setTemplatePrompt] = useState(DEFAULT_TEMPLATE_PROMPT);
  const [templatePlan, setTemplatePlan] = useState(null);
  const [foundationPlan, setFoundationPlan] = useState(null);
  const [referenceAnchorResult, setReferenceAnchorResult] = useState(null);
  const [templatePartsResult, setTemplatePartsResult] = useState(null);
  const [templateGenerationStatus, setTemplateGenerationStatus] = useState("");
  const [isRunningTemplate, setIsRunningTemplate] = useState(false);
  const [isRunningFoundation, setIsRunningFoundation] = useState(false);
  const [isRunningReferenceAnchor, setIsRunningReferenceAnchor] = useState(false);
  const [isGeneratingTemplateParts, setIsGeneratingTemplateParts] = useState(false);
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

  const runTemplateStepOne = useEffectEvent(async () => {
    setIsRunningTemplate(true);
    setError("");
    setActionMessage("");

    try {
      const result = await fetchJson("/api/template/step-one", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: templatePrompt,
        }),
      });

      startTransition(() => {
        setTemplatePlan(result.plan);
        setFoundationPlan(null);
        setReferenceAnchorResult(null);
        setTemplatePartsResult(null);
        setDashboard(result.dashboard);
        setSelectedTrack(1);
        setSelectedSlotIndex(result.dashboard?.selectedTrack?.clipSlots?.[0]?.index ?? null);
      });
      setActionMessage(result.message);
    } finally {
      setIsRunningTemplate(false);
    }
  });

  const runTemplateStepTwo = useEffectEvent(async () => {
    setIsRunningFoundation(true);
    setError("");
    setActionMessage("");

    try {
      const result = await fetchJson("/api/template/step-two", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: templatePrompt,
          style: templatePlan?.style || templatePrompt,
          bpm: templatePlan?.bpm || dashboard?.song?.tempo,
          tracks:
            templatePlan?.tracks ||
            dashboard?.tracks?.map((track) => ({
              index: track.index,
              name: track.name,
              displayName: track.displayName,
            })),
        }),
      });

      startTransition(() => {
        setFoundationPlan(result.plan);
        setReferenceAnchorResult(null);
        setTemplatePartsResult(null);
        setDashboard(result.dashboard);
        setSelectedTrack(1);
        setSelectedSlotIndex(result.plan?.reference?.slotIndex ?? 1);
      });
      setReferenceRows((current) => {
        const referenceTrack = Number(result.plan?.reference?.trackIndex || 1);
        const referenceSlot = Number(result.plan?.reference?.slotIndex || 1);
        const alreadyExists = current.some(
          (reference) =>
            Number(reference.track) === referenceTrack &&
            Number(reference.slot) === referenceSlot,
        );

        if (alreadyExists) {
          return current;
        }

        referenceRowIdRef.current += 1;
        return [
          ...current,
          {
            id: referenceRowIdRef.current,
            track: String(referenceTrack),
            slot: String(referenceSlot),
          },
        ];
      });

      setActionMessage(
        result.skipped?.length
          ? `${result.message} ${result.skipped.length} slots were skipped.`
          : result.message,
      );
    } finally {
      setIsRunningFoundation(false);
    }
  });

  const runTemplateReferenceAnchor = useEffectEvent(async () => {
    const fallbackReference = referenceRows[0]
      ? {
          trackIndex: Number(referenceRows[0].track || 1),
          slotIndex: Number(referenceRows[0].slot || 1),
        }
      : null;
    const reference = foundationPlan?.reference || fallbackReference || {
      trackIndex: 1,
      slotIndex: 1,
      clipName: "pad_warm_intro_reference",
    };

    setIsRunningReferenceAnchor(true);
    setError("");
    setActionMessage("Writing the reference anchor into Track 1 / Slot 1...");

    try {
      const result = await fetchJson("/api/template/reference-anchor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: templatePrompt,
          style: templatePlan?.style || foundationPlan?.style || templatePrompt,
          bpm: templatePlan?.bpm || foundationPlan?.bpm || dashboard?.song?.tempo,
          reference,
          anchorPriority: ["harmonic", "melodic", "bass", "rhythmic", "texture"],
        }),
      });

      startTransition(() => {
        setReferenceAnchorResult({
          reference: result.reference,
          anchorPriority: result.anchorPriority,
        });
        setTemplatePartsResult(null);
        setDashboard(result.dashboard);
        setSelectedTrack(result.reference?.trackIndex ?? 1);
        setSelectedSlotIndex(result.reference?.slotIndex ?? 1);
      });
      setLlmResponse(result.message || "");
      setLlmModel(result.model || "");
      setLlmExecutionState(result.execution || null);
      if (result.execution?.ok) {
        setActionMessage(result.execution.message || "Reference anchor created.");
      } else {
        setActionMessage("");
        setError(result.execution?.error || "Reference anchor could not be applied.");
      }
    } finally {
      setIsRunningReferenceAnchor(false);
    }
  });

  const runTemplatePartsFromReference = useEffectEvent(async () => {
    const fallbackReference =
      referenceAnchorResult?.reference ||
      foundationPlan?.reference ||
      (referenceRows[0]
        ? {
            trackIndex: Number(referenceRows[0].track || 1),
            slotIndex: Number(referenceRows[0].slot || 1),
          }
        : {
            trackIndex: 1,
            slotIndex: 1,
            clipName: "pad_warm_intro_reference",
          });

    setIsGeneratingTemplateParts(true);
    setError("");
    setTemplateGenerationStatus("Finding empty clips in the reference scene...");
    setActionMessage("Finding empty clips in the reference scene...");

    try {
      const targetPayload = await fetchJson("/api/template/part-targets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference: fallbackReference,
          overwrite: false,
          onlyReferenceScene: true,
        }),
      });
      const targets = targetPayload.targets || [];
      const reference = {
        trackIndex: targetPayload.reference?.track?.index || fallbackReference.trackIndex || 1,
        slotIndex: targetPayload.reference?.slot?.index || fallbackReference.slotIndex || 1,
        clipName: targetPayload.reference?.clip?.name || fallbackReference.clipName,
      };
      const results = [];
      let latestDashboard = dashboard;

      if (!targets.length) {
        const emptyResult = {
          ok: true,
          step: 4,
          message: "No empty reference scene clips need generation.",
          reference,
          generatedCount: 0,
          targetCount: 0,
          results,
          dashboard,
        };
        setTemplatePartsResult(emptyResult);
        setTemplateGenerationStatus("No empty reference scene clips need generation.");
        setActionMessage(emptyResult.message);
        return;
      }

      for (const [index, target] of targets.entries()) {
        const label = getTemplateTargetLabel(target);
        const progress = `Generating ${label} (${index + 1}/${targets.length})`;
        setTemplateGenerationStatus(progress);
        setActionMessage(progress);
        startTransition(() => {
          setSelectedTrack(target.trackIndex);
          setSelectedSlotIndex(target.slotIndex);
        });

        const generated = await fetchJson("/api/template/generate-part", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: templatePrompt,
            style: templatePlan?.style || foundationPlan?.style || templatePrompt,
            bpm: templatePlan?.bpm || foundationPlan?.bpm || dashboard?.song?.tempo,
            reference,
            target,
            anchorPriority: ["harmonic", "melodic", "bass", "rhythmic", "texture"],
          }),
        });

        results.push(generated.result);
        latestDashboard = generated.dashboard || latestDashboard;
        startTransition(() => {
          setDashboard(latestDashboard);
        });
      }

      const generatedCount = results.filter((item) => item.ok).length;
      const result = {
        ok: results.every((item) => item.ok),
        step: 4,
        message: `Generated ${generatedCount} of ${targets.length} reference scene clips from the reference anchor.`,
        reference,
        generatedCount,
        targetCount: targets.length,
        results,
        dashboard: latestDashboard,
      };

      startTransition(() => {
        setTemplatePartsResult(result);
        setDashboard(latestDashboard);
        setSelectedTrack(result.reference?.trackIndex ?? 1);
        setSelectedSlotIndex(result.reference?.slotIndex ?? 1);
      });

      if (result.generatedCount === result.targetCount) {
        setActionMessage(result.message);
      } else {
        const failedCount = (result.results || []).filter((item) => !item.ok).length;
        setActionMessage(
          `${result.message}${failedCount ? ` ${failedCount} clips need review.` : ""}`,
        );
      }
      setLlmResponse(JSON.stringify(result.results || [], null, 2));
      setLlmModel("template-loop");
      setLlmExecutionState({
        ok: result.ok,
        message: result.message,
        generatedCount: result.generatedCount,
        targetCount: result.targetCount,
      });
    } finally {
      setIsGeneratingTemplateParts(false);
      setTemplateGenerationStatus("");
    }
  });

  const runAiOnTarget = useEffectEvent(async () => {
    if (aiTarget.type === "clip" && !selectedSlot?.index) {
      throw new Error("Select a clip slot first.");
    }

    if (aiTarget.type === "device" && !aiTarget.deviceIndex) {
      throw new Error("Select a device control target first.");
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
      const result =
        aiTarget.type === "device"
          ? await fetchJson("/api/llm/run-device", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: commandDraft,
                trackIndex: selectedTrack,
                deviceIndex: aiTarget.deviceIndex,
              }),
            })
          : await fetchJson("/api/llm/run", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: commandDraft,
                trackIndex: selectedTrack,
                slotIndex: selectedSlot?.index,
                references,
              }),
            });

      setLlmResponse(result.message);
      setLlmModel(result.model || "");
      setLlmExecutionState(result.execution || null);

      if (result.execution?.ok) {
        setActionMessage(result.execution.message);
        if (aiTarget.type === "clip") {
          setSelectedSlotIndex(result.execution.plan.slotIndex);
        }
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

  useEffect(() => {
    if (
      aiTarget.type === "device" &&
      selected?.devices &&
      !selected.devices.some((device) => device.index === aiTarget.deviceIndex)
    ) {
      setAiTarget({ type: "clip" });
    }
  }, [aiTarget, selected?.devices]);

  const selectedVisibleSlots = getVisibleClipSlots(selected?.clipSlots);
  const selectedSlot =
    selectedVisibleSlots.find((slot) => slot.index === selectedSlotIndex) ?? null;
  const selectedDevice =
    aiTarget.type === "device"
      ? selected?.devices?.find((device) => device.index === aiTarget.deviceIndex) ?? null
      : null;
  const aiTargetLabel =
    aiTarget.type === "device" && selectedDevice
      ? `Device • ${selectedDevice.name}`
      : `MIDI Clip • Slot ${selectedSlot?.index ?? "--"}`;
  const workspaceTracks =
    dashboard?.tracks?.map((track) =>
      track.index === selected?.track?.index
        ? {
            ...track,
            clipSlots: getVisibleClipSlots(track.clipSlots, selected.clipSlots),
          }
        : track,
    ) ?? [];
  const sessionRowCount = Math.max(
    VISIBLE_CLIP_ROWS,
    ...(workspaceTracks.flatMap((track) =>
      getVisibleClipSlots(track.clipSlots).map((slot) => slot.index),
    )),
    ...((dashboard?.scenes ?? []).map((scene) => scene.index)),
  );

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

      <TemplateBuilder
        foundationPlan={foundationPlan}
        isGeneratingTemplateParts={isGeneratingTemplateParts}
        isRunningReferenceAnchor={isRunningReferenceAnchor}
        isRunningStepOne={isRunningTemplate}
        isRunningStepTwo={isRunningFoundation}
        onRunTemplateParts={() => {
          runTemplatePartsFromReference().catch((templateError) => {
            setError(
              templateError instanceof Error
                ? templateError.message
                : String(templateError),
            );
          });
        }}
        onRunStepOne={() => {
          runTemplateStepOne().catch((templateError) => {
            setError(
              templateError instanceof Error
                ? templateError.message
                : String(templateError),
            );
          });
        }}
        onRunReferenceAnchor={() => {
          runTemplateReferenceAnchor().catch((templateError) => {
            setError(
              templateError instanceof Error
                ? templateError.message
                : String(templateError),
            );
          });
        }}
        onRunStepTwo={() => {
          runTemplateStepTwo().catch((templateError) => {
            setError(
              templateError instanceof Error
                ? templateError.message
                : String(templateError),
            );
          });
        }}
        plan={templatePlan}
        prompt={templatePrompt}
        referenceAnchorResult={referenceAnchorResult}
        setPrompt={setTemplatePrompt}
        templateGenerationStatus={templateGenerationStatus}
        templatePartsResult={templatePartsResult}
      />

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
            <SessionSceneColumn
              onAddScene={() => {
                addClipRow(selectedTrack).catch((actionError) => {
                  setError(
                    actionError instanceof Error
                      ? actionError.message
                      : String(actionError),
                  );
                });
              }}
              rowCount={sessionRowCount}
              scenes={dashboard?.scenes}
              selectedSlotIndex={selectedSlotIndex}
            />
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
              <div
                className={`selected-clip-panel ${
                  aiTarget.type === "clip" ? "selected-clip-panel--targeted" : ""
                }`}
              >
                <div className="selected-clip-panel__header">
                  <div>
                    <span className="field-label">Selected Clip</span>
                    <strong>
                      {selected?.track?.name
                        ? `${selected.track.name} • Slot ${selectedSlot?.index ?? "--"}`
                      : "No track selected"}
                    </strong>
                  </div>
                  <button
                    className="secondary-button selected-clip-panel__target"
                    onClick={() => setAiTarget({ type: "clip" })}
                    type="button"
                  >
                    {aiTarget.type === "clip" ? "AI Target" : "Target AI"}
                  </button>
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
                        <MidiNotePreview
                          clip={selectedSlot.clip}
                          isTargeted={aiTarget.type === "clip"}
                          onSelect={() => setAiTarget({ type: "clip" })}
                        />
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
            aiTarget={aiTarget}
            onSelectDevice={(deviceIndex) => setAiTarget({ type: "device", deviceIndex })}
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
            <p>AI Target: {aiTargetLabel}</p>
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
              disabled={
                isRunningAi ||
                (aiTarget.type === "clip" && !selectedSlot) ||
                (aiTarget.type === "device" && !selectedDevice)
              }
              onClick={() => {
                runAiOnTarget().catch((actionError) => {
                  setError(
                    actionError instanceof Error
                      ? actionError.message
                      : String(actionError),
                  );
                });
              }}
              type="button"
            >
              {isRunningAi ? "Generating And Applying..." : `Run AI On ${aiTarget.type === "device" ? "Device" : "Selected Slot"}`}
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
