import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Ableton } from "./index.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.ABLETON_WEB_API_PORT || 3030);
const ENV_PATH = path.join(process.cwd(), ".env");

loadEnvFile();

const LLM_BASE_URL =
  process.env.ABLETON_LLM_BASE_URL || "https://ollama.skeba.info/v1/chat/completions";
const LLM_MODEL = process.env.ABLETON_LLM_MODEL || "gpt-oss-20b";
const LLM_API_KEY = process.env.ABLETON_LLM_API_KEY || "";
const MIN_SESSION_SCENES = Number(process.env.ABLETON_MIN_SESSION_SCENES || 8);

let queue = Promise.resolve();

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withAbleton(task) {
  const ableton = new Ableton({
    commandTimeoutMs: 10000,
    commandWarnMs: 5000,
  });
  try {
    await ableton.start(5000);
    return await task(ableton);
  } finally {
    if (ableton.isConnected()) {
      await ableton.close();
    }
  }
}

async function retryAbleton(fn, attempts = 3, delayMs = 250) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function makeNote(pitch, time, duration, velocity) {
  return { pitch, time, duration, velocity, muted: false };
}

function buildStarterDrumPattern() {
  return [
    makeNote(36, 0, 0.2, 118),
    makeNote(36, 1, 0.2, 108),
    makeNote(36, 2, 0.2, 108),
    makeNote(36, 3, 0.2, 108),
    makeNote(38, 1, 0.2, 112),
    makeNote(38, 3, 0.2, 112),
    makeNote(39, 1, 0.15, 84),
    makeNote(39, 3, 0.15, 84),
    makeNote(42, 0, 0.1, 72),
    makeNote(42, 0.5, 0.1, 62),
    makeNote(42, 1, 0.1, 72),
    makeNote(42, 1.5, 0.1, 62),
    makeNote(42, 2, 0.1, 72),
    makeNote(42, 2.5, 0.1, 62),
    makeNote(42, 3, 0.1, 72),
    makeNote(42, 3.5, 0.1, 62),
    makeNote(46, 1.5, 0.18, 82),
    makeNote(46, 3.5, 0.18, 88),
    makeNote(37, 2.75, 0.1, 68),
  ];
}

async function getTrackByIndex(ableton, trackIndex) {
  const tracks = await ableton.song.get("tracks");
  const track = tracks[trackIndex - 1];

  if (!track) {
    throw new Error(`Track ${trackIndex} does not exist. Found ${tracks.length} tracks.`);
  }

  return track;
}

async function summarizeClip(clip) {
  const length = await retryAbleton(() => clip.get("length"));
  const [looping, notes] = await Promise.all([
    retryAbleton(() => clip.get("looping")),
    retryAbleton(() => clip.getNotes(0, 0, length, 128)),
  ]);
  const uniquePitches = [...new Set(notes.map((note) => note.pitch))].sort((a, b) => a - b);
  const velocities = notes.map((note) => note.velocity).filter((value) => Number.isFinite(value));

  return {
    name: clip.raw.name || "(unnamed clip)",
    length,
    looping,
    noteCount: notes.length,
    uniquePitches,
    lowestPitch: uniquePitches.length ? uniquePitches[0] : null,
    highestPitch: uniquePitches.length ? uniquePitches[uniquePitches.length - 1] : null,
    averageVelocity: velocities.length
      ? Number((velocities.reduce((sum, value) => sum + value, 0) / velocities.length).toFixed(1))
      : null,
  };
}

function normalizeDrumPads(rawPads) {
  if (!Array.isArray(rawPads)) {
    return [];
  }

  return rawPads
    .map((pad, index) => {
      if (!pad || typeof pad !== "object" || Array.isArray(pad)) {
        return null;
      }

      const parsedNote =
        Number.isFinite(pad.note) || typeof pad.note === "number"
          ? Number(pad.note)
          : Number.parseInt(String(pad.note ?? ""), 10);
      const parsedChainCount =
        Number.isFinite(pad.chain_count) || typeof pad.chain_count === "number"
          ? Number(pad.chain_count)
          : Number.parseInt(String(pad.chain_count ?? ""), 10);
      const name = typeof pad.name === "string" ? pad.name.trim() : "";

      const normalized = {
        index: index + 1,
        id: typeof pad.id === "string" ? pad.id : null,
        name: name || `Pad ${index + 1}`,
        note: Number.isFinite(parsedNote) ? parsedNote : null,
        chainCount: Number.isFinite(parsedChainCount) ? parsedChainCount : 0,
      };

      const hasUsefulData =
        normalized.chainCount > 0 ||
        normalized.note !== null ||
        (name && normalized.name !== `Pad ${index + 1}`);

      return hasUsefulData ? normalized : null;
    })
    .filter(Boolean);
}

function deviceSupportsPresets(device) {
  return device?.raw?.class_name === "PluginDevice";
}

async function summarizeTrack(track, index) {
  const [mute, solo, canBeArmed, arm, devices, clipSlots] = await Promise.all([
    track.get("mute"),
    track.get("solo"),
    track.get("can_be_armed"),
    track.get("arm").catch(() => false),
    track.get("devices"),
    track.get("clip_slots"),
  ]);

  const deviceSummaries = await Promise.all(
    devices.map(async (device, deviceIndex) => {
      const supportsPresets = deviceSupportsPresets(device);
      const [
        isActive,
        canHaveDrumPads,
        parameters,
        rawDrumPads,
        pluginPresets,
        selectedPresetIndex,
      ] = await Promise.all([
        device.get("is_active"),
        device.get("can_have_drum_pads"),
        device.get("parameters"),
        device.get("drum_pads").catch(() => []),
        supportsPresets ? device.get("presets").catch(() => []) : [],
        supportsPresets ? device.get("selected_preset_index").catch(() => null) : null,
      ]);
      const drumPads = canHaveDrumPads ? normalizeDrumPads(rawDrumPads) : [];
      const hasPluginPresets = Array.isArray(pluginPresets) && pluginPresets.length > 0;
      const currentPresetName =
        hasPluginPresets && Number.isInteger(selectedPresetIndex)
          ? pluginPresets[selectedPresetIndex] ?? null
          : null;

      const parameterSummaries = await Promise.all(
        parameters.slice(0, 16).map(async (parameter, parameterIndex) => {
          const [min, max] = await Promise.all([parameter.get("min"), parameter.get("max")]);
          return {
            index: parameterIndex + 1,
            name: parameter.raw.name,
            value: parameter.raw.value,
            min,
            max,
            isQuantized: parameter.raw.is_quantized,
          };
        }),
      );

      return {
        index: deviceIndex + 1,
        name: device.raw.name,
        className: device.raw.class_name,
        type: device.raw.type,
        isActive,
        canHaveDrumPads,
        drumPads,
        presetCount: hasPluginPresets ? pluginPresets.length : 0,
        selectedPresetIndex:
          Number.isInteger(selectedPresetIndex) && selectedPresetIndex >= 0
            ? selectedPresetIndex
            : null,
        currentPresetName,
        parameters: parameterSummaries,
      };
    }),
  );

  const clipSlotSummaries = await Promise.all(
    clipSlots.slice(0, 12).map(async (slot, slotIndex) => {
      const [hasClip, isPlaying, isTriggered] = await Promise.all([
        slot.get("has_clip"),
        slot.get("is_playing"),
        slot.get("is_triggered"),
      ]);

      let clip = null;
      if (hasClip) {
        const rawClip = await slot.get("clip", false);
        if (rawClip && rawClip.raw.is_midi_clip) {
          clip = await summarizeClip(rawClip);
        } else if (rawClip) {
          clip = {
            name: rawClip.raw.name || "(audio clip)",
            length: rawClip.raw.end_time - rawClip.raw.start_time,
            looping: false,
            noteCount: 0,
            uniquePitches: [],
          };
        }
      }

      return {
        index: slotIndex + 1,
        hasClip,
        isPlaying,
        isTriggered,
        clip,
      };
    }),
  );

  return {
    track: {
      index,
      name: track.raw.name,
      mute,
      solo,
      arm: canBeArmed ? arm : false,
      canBeArmed,
    },
    devices: deviceSummaries,
    clipSlots: clipSlotSummaries,
  };
}

async function summarizeTrackListItem(track, index) {
  const [devices, clipSlots] = await Promise.all([
    track.get("devices").catch(() => []),
    track.get("clip_slots").catch(() => []),
  ]);
  const primaryDevice =
    devices.find((device) => device.raw?.type === "instrument") ?? devices[0] ?? null;

  const clipSlotSummaries = await Promise.all(
    clipSlots.slice(0, 12).map(async (slot, slotIndex) => {
      const [reportedHasClip, isPlaying, isTriggered, clip] = await Promise.all([
        slot.get("has_clip").catch(() => false),
        slot.get("is_playing").catch(() => false),
        slot.get("is_triggered").catch(() => false),
        slot.get("clip", false).catch(() => null),
      ]);
      const hasClip = Boolean(reportedHasClip || clip);

      return {
        index: slotIndex + 1,
        hasClip,
        isPlaying,
        isTriggered,
        clip: clip
          ? {
              name: clip.raw?.name || `Clip ${slotIndex + 1}`,
            }
          : null,
      };
    }),
  );

  if (!primaryDevice) {
    return {
      index,
      name: track.raw.name,
      displayName: track.raw.name,
      primaryDeviceName: null,
      currentPresetName: null,
      clipSlots: clipSlotSummaries,
    };
  }

  const supportsPresets = deviceSupportsPresets(primaryDevice);
  const [pluginPresets, selectedPresetIndex] = await Promise.all([
    supportsPresets ? primaryDevice.get("presets").catch(() => []) : [],
    supportsPresets ? primaryDevice.get("selected_preset_index").catch(() => null) : null,
  ]);

  const currentPresetName =
    Array.isArray(pluginPresets) && Number.isInteger(selectedPresetIndex)
      ? pluginPresets[selectedPresetIndex] ?? null
      : null;
  const primaryDeviceName = primaryDevice.raw?.name || null;

  return {
    index,
    name: track.raw.name,
    displayName:
      primaryDeviceName && currentPresetName
        ? `${primaryDeviceName} - ${currentPresetName}`
        : primaryDeviceName || track.raw.name,
    primaryDeviceName,
    currentPresetName,
    clipSlots: clipSlotSummaries,
  };
}

function inferTrackMode(trackSummary) {
  const devices = trackSummary?.devices || [];
  const drumDevice = devices.find((device) => device.canHaveDrumPads);

  if (drumDevice) {
    return {
      mode: "drum",
      primaryDevice: {
        index: drumDevice.index,
        name: drumDevice.name,
        className: drumDevice.className,
        type: drumDevice.type,
      },
      soundPalette: drumDevice.drumPads?.length
        ? drumDevice.drumPads.map((pad) => ({
            name: pad.name,
            note: pad.note,
            chainCount: pad.chainCount,
          }))
        : [],
    };
  }

  const instrumentDevice = devices.find((device) => device.type === "instrument") || devices[0] || null;
  return {
    mode: "melodic",
    primaryDevice: instrumentDevice
      ? {
          index: instrumentDevice.index,
          name: instrumentDevice.name,
          className: instrumentDevice.className,
          type: instrumentDevice.type,
          currentPresetName: instrumentDevice.currentPresetName || null,
          presetCount: instrumentDevice.presetCount || 0,
          parameterCount: instrumentDevice.parameters?.length || 0,
          parameters: (instrumentDevice.parameters || []).map((parameter) => ({
            name: parameter.name,
            value: parameter.value,
            min: parameter.min,
            max: parameter.max,
            isQuantized: parameter.isQuantized,
          })),
        }
      : null,
    soundPalette: [],
  };
}

async function getDashboard(trackIndex) {
  const dashboard = await withAbleton(async (ableton) => buildDashboardFromAbleton(ableton, trackIndex));
  const { _tracks, ...publicDashboard } = dashboard;
  return publicDashboard;
}

async function createMidiTrackAndDashboard() {
  return withAbleton(async (ableton) => {
    await ableton.song.createMidiTrack(-1);
    const tracks = await ableton.song.get("tracks");
    const dashboard = await buildDashboardFromAbleton(ableton, tracks.length);
    const { _tracks, ...publicDashboard } = dashboard;

    return publicDashboard;
  });
}

async function createSceneAndDashboard(trackIndex) {
  return withAbleton(async (ableton) => {
    await ableton.song.createScene(-1);
    const dashboard = await buildDashboardFromAbleton(ableton, trackIndex);
    const { _tracks, ...publicDashboard } = dashboard;

    return publicDashboard;
  });
}

async function ensureMinimumScenes(ableton, minimumScenes) {
  let scenes = await ableton.song.get("scenes");

  while (scenes.length < minimumScenes) {
    await ableton.song.createScene(-1);
    scenes = await ableton.song.get("scenes");
  }

  return scenes;
}

async function buildDashboardFromAbleton(ableton, trackIndex) {
  const [tempo, isPlaying, currentSongTime, tracks, scenes] = await Promise.all([
    ableton.song.get("tempo"),
    ableton.song.get("is_playing"),
    ableton.song.get("current_song_time"),
    ableton.song.get("tracks"),
    ensureMinimumScenes(ableton, MIN_SESSION_SCENES),
  ]);

  const selectedTrackIndex =
    Number.isInteger(trackIndex) && trackIndex > 0 ? trackIndex : 1;
  const selectedTrack = tracks[selectedTrackIndex - 1];

  if (!selectedTrack) {
    throw new Error(`Track ${selectedTrackIndex} does not exist. Found ${tracks.length} tracks.`);
  }

  return {
    connected: true,
    song: {
      tempo,
      isPlaying,
      currentSongTime,
      sceneCount: scenes.length,
    },
    tracks: await Promise.all(
      tracks.map((track, index) => summarizeTrackListItem(track, index + 1)),
    ),
    selectedTrack: await summarizeTrack(selectedTrack, selectedTrackIndex),
    _tracks: tracks,
  };
}

async function summarizeReferenceClipFromTrack(track, trackIndex, slotIndex) {
  if (!Number.isInteger(slotIndex) || slotIndex <= 0) {
    return null;
  }

  const slots = await track.get("clip_slots");
  const slot = slots[slotIndex - 1];

  if (!slot) {
    throw new Error(
      `Reference slot ${slotIndex} does not exist on track "${track.raw.name}". Found ${slots.length} slots.`,
    );
  }

  if (!(await slot.get("has_clip"))) {
    throw new Error(`Reference track ${trackIndex} slot ${slotIndex} does not contain a clip.`);
  }

  const clip = await slot.get("clip", false);
  const summary = clip.raw.is_midi_clip
    ? await summarizeClip(clip)
    : {
        name: clip.raw.name || "(audio clip)",
        length: clip.raw.end_time - clip.raw.start_time,
        looping: false,
        noteCount: 0,
        uniquePitches: [],
        lowestPitch: null,
        highestPitch: null,
        averageVelocity: null,
      };

  const noteEvents = clip.raw.is_midi_clip
    ? await clip.getNotes(0, 0, summary.length, 128).then((notes) =>
        notes.slice(0, 48).map((note) => ({
          pitch: note.pitch,
          time: Number(note.time.toFixed(3)),
          duration: Number(note.duration.toFixed(3)),
          velocity: note.velocity,
        })),
      )
    : [];

  return {
    track: {
      index: trackIndex,
      name: track.raw.name,
    },
    slot: {
      index: slotIndex,
    },
    clip: summary,
    noteEvents,
  };
}

function buildLlmContext(dashboard, referenceClips = []) {
  const trackContext = inferTrackMode(dashboard.selectedTrack);

  return {
    song: dashboard.song,
    tracks: dashboard.tracks,
    selectedTrack: dashboard.selectedTrack,
    trackContext,
    referenceClips,
  };
}

function buildLlmPromptSummary(prompt, context) {
  const selectedTrack = context.selectedTrack?.track;
  const primaryDevice = context.trackContext?.primaryDevice;
  const referenceSummary = Array.isArray(context.referenceClips) && context.referenceClips.length
    ? context.referenceClips
        .map(
          (reference, index) =>
            `${index + 1}. track ${reference.track.index} (${reference.track.name}) slot ${reference.slot.index} clip "${reference.clip.name}" with ${reference.clip.noteCount} notes across pitches ${reference.clip.uniquePitches.join(", ") || "none"}`,
        )
        .join("\n")
    : "None";

  return [
    `User request: ${prompt}`,
    selectedTrack
      ? `Target track: ${selectedTrack.index} - ${selectedTrack.name}`
      : "Target track: unknown",
    primaryDevice
      ? `Target instrument: ${primaryDevice.name} (${primaryDevice.className}, ${primaryDevice.type})`
      : "Target instrument: unknown",
    primaryDevice?.currentPresetName
      ? `Target preset: ${primaryDevice.currentPresetName}`
      : "Target preset: none exposed",
    `Track mode: ${context.trackContext?.mode || "unknown"}`,
    context.trackContext?.mode === "drum"
      ? "IMPORTANT: The selected target track is a drum track. Generate drum MIDI only for this target."
      : "IMPORTANT: The selected target track is not a drum track. Generate melodic or harmonic MIDI only. References may be drums, but they must not turn the target into a drum pattern.",
    `Reference clips:\n${referenceSummary}`,
    "Structured context JSON follows.",
  ].join("\n");
}

async function runLlmCommand(prompt, trackIndex, options = {}) {
  if (!LLM_API_KEY) {
    throw new Error("Missing ABLETON_LLM_API_KEY in .env or process environment.");
  }

  const referenceInputs = Array.isArray(options.references)
    ? options.references
    : Number.isInteger(options.referenceTrackIndex) &&
        Number.isInteger(options.referenceSlotIndex)
      ? [
          {
            trackIndex: options.referenceTrackIndex,
            slotIndex: options.referenceSlotIndex,
          },
        ]
      : [];
  const { dashboard, referenceClips } = await withAbleton(async (ableton) => {
    const dashboardWithTracks = await buildDashboardFromAbleton(ableton, trackIndex);
    const referenceClips = (
      await Promise.all(
        referenceInputs.map(async (reference) => {
          const referenceTrackIndex = Number.isInteger(reference.trackIndex)
            ? reference.trackIndex
            : null;
          const referenceSlotIndex = Number.isInteger(reference.slotIndex)
            ? reference.slotIndex
            : null;

          if (!referenceTrackIndex || !referenceSlotIndex) {
            return null;
          }

          const track = dashboardWithTracks._tracks?.[referenceTrackIndex - 1];
          if (!track) {
            throw new Error(
              `Reference track ${referenceTrackIndex} does not exist. Found ${dashboardWithTracks._tracks?.length || 0} tracks.`,
            );
          }

          return summarizeReferenceClipFromTrack(track, referenceTrackIndex, referenceSlotIndex);
        }),
      )
    ).filter(Boolean);

    const { _tracks, ...publicDashboard } = dashboardWithTracks;
    return {
      dashboard: publicDashboard,
      referenceClips,
    };
  });
  const context = buildLlmContext(dashboard, referenceClips);
  const promptSummary = buildLlmPromptSummary(prompt, context);

  const response = await fetch(LLM_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      stream: false,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are helping control Ableton Live from a local app. Use the provided song and track context. Be concise and practical. Only the selected target track determines whether the result should be drums or melodic MIDI. Reference clips never change the target instrument type. If `trackContext.mode` is `drum`, treat any `soundPalette` pads as the available drum sounds and generate a drum groove for that target only. If `trackContext.mode` is `melodic`, do not answer with a drum loop unless the user explicitly asks for percussion on that same target track. Instead, create a single-instrument MIDI idea that suits the selected instrument: bassline, stab pattern, chord progression, arp, lead, or riff depending on the prompt and device context. For melodic tracks, keep the note set coherent for one playable instrument, avoid drum-lane style mappings, and prefer a focused register and contour over widely scattered percussive pitches. If plugin parameters are sparse, acknowledge that the synth internals are not fully exposed and rely on the track name, device name, preset name, and prompt for style. If `referenceClips` is present, use those clips only as optional context for rhythm, energy, density, syncopation, and arrangement contrast, but do not copy their exact notes unless the user explicitly asks. Synthesize across multiple references when helpful instead of mirroring just one. Whenever execution would help, include a compact JSON block under a heading called PLAN_JSON.",
        },
        {
          role: "user",
          content: `${promptSummary}\n\n${JSON.stringify({ request: prompt, context }, null, 2)}`,
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || "LLM request failed.");
  }

  const message = payload.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error("LLM response did not include a message.");
  }

  return {
    ok: true,
    model: payload.model || LLM_MODEL,
    message,
    context,
  };
}

function applyPlanOverrides(plan, overrides = {}) {
  return {
    ...plan,
    trackIndex:
      Number.isInteger(overrides.trackIndex) && overrides.trackIndex > 0
        ? overrides.trackIndex
        : plan.trackIndex,
    slotIndex:
      Number.isInteger(overrides.slotIndex) && overrides.slotIndex > 0
        ? overrides.slotIndex
        : plan.slotIndex,
  };
}

async function createStarterDrumLoop(trackIndex, slotIndex) {
  return withAbleton(async (ableton) => {
    const track = await getTrackByIndex(ableton, trackIndex);
    const slots = await track.get("clip_slots");
    const slot = slots[slotIndex - 1];

    if (!slot) {
      throw new Error(
        `Slot ${slotIndex} does not exist on track "${track.raw.name}". Found ${slots.length} slots.`,
      );
    }

    if (await slot.get("has_clip")) {
      throw new Error(`Track ${trackIndex} slot ${slotIndex} already has a clip.`);
    }

    await slot.createClip(4);
    const clip = await slot.get("clip", false);
    await clip.set("name", "Starter Drum Groove");
    await clip.setNotes(buildStarterDrumPattern());

    return {
      ok: true,
      trackIndex,
      slotIndex,
      clip: await summarizeClip(clip),
      message: "Starter drum groove created.",
    };
  });
}

function extractJsonFromText(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Expected LLM response text.");
  }

  function sanitizeJsonLike(input) {
    return input
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^\s*#.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\/\/.*$/gm, "")
      .trim();
  }

  function parseJsonLike(input) {
    return JSON.parse(sanitizeJsonLike(input));
  }

  const planBlockMatch = text.match(/PLAN_JSON[\s\S]*?```json\s*([\s\S]*?)```/i);
  if (planBlockMatch) {
    return parseJsonLike(planBlockMatch[1]);
  }

  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return parseJsonLike(fencedMatch[1]);
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return parseJsonLike(text.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Could not find JSON plan in the response.");
}

function normalizePlan(input) {
  const source = typeof input === "string" ? extractJsonFromText(input) : input;

  if (!source || typeof source !== "object") {
    throw new Error("Plan must be an object.");
  }

  if (Array.isArray(source.actions)) {
    const normalizedActions = source.actions.map((action) => ({
      ...action,
      type:
        action.type === "createClip"
          ? "create_clip"
          : action.type === "addNote"
            ? "add_note"
            : action.type,
    }));

    const createClip = normalizedActions.find((action) => action.type === "create_clip");
    const noteActions = normalizedActions.filter((action) => action.type === "add_note");

    if (!createClip) {
      throw new Error("Plan actions did not include a create_clip action.");
    }

    return {
      action: "create_clip",
      trackIndex: Number(createClip.trackIndex),
      slotIndex: Number(createClip.slotIndex),
      clipName: createClip.clipName || createClip.name || "LLM MIDI Clip",
      lengthBars: Number(
        createClip.lengthBars || createClip.lengthInBars || createClip.length || 4,
      ),
      looping: createClip.looping !== false,
      notes: noteActions.map((noteAction) => ({
        note: Number(noteAction.note),
        time: Number(
          noteAction.time ?? noteAction.startBeat ?? noteAction.start_time ?? 0,
        ),
        duration: Number(noteAction.duration || 0.1),
        velocity: Number(noteAction.velocity || 100),
      })),
    };
  }

  const clipBlock = source.clip && typeof source.clip === "object" ? source.clip : null;

  return {
    action:
      source.action === "createClip"
        ? "create_clip"
        : source.action || "create_clip",
    trackIndex: Number(source.trackIndex),
    slotIndex: Number(source.slotIndex ?? source.clipSlotIndex),
    clipName: source.clipName || source.name || clipBlock?.name || "LLM MIDI Clip",
    lengthBars: Number(
      source.lengthBars ||
        source.lengthInBars ||
        source.length ||
        source.clipLength ||
        clipBlock?.lengthBars ||
        clipBlock?.lengthInBars ||
        clipBlock?.length ||
        4,
    ),
    looping: (clipBlock?.looping ?? source.looping) !== false,
    notes: Array.isArray(source.notes || source.noteEvents || clipBlock?.notes || clipBlock?.noteEvents)
      ? (source.notes || source.noteEvents || clipBlock?.notes || clipBlock?.noteEvents).map((note) => ({
          note: Number(note.note ?? note.pitch),
          time: Number(
            note.time ?? note.start ?? note.startBeat ?? note.start_time ?? 0,
          ),
          duration: Number(note.duration || 0.1),
          velocity: Number(note.velocity || 100),
        }))
      : [],
  };
}

function validatePlan(plan) {
  if (plan.action !== "create_clip") {
    throw new Error(`Unsupported plan action: ${plan.action}`);
  }

  if (!Number.isInteger(plan.trackIndex) || plan.trackIndex <= 0) {
    throw new Error("Plan trackIndex must be a positive integer.");
  }

  if (!Number.isInteger(plan.slotIndex) || plan.slotIndex <= 0) {
    throw new Error("Plan slotIndex must be a positive integer.");
  }

  if (!Number.isFinite(plan.lengthBars) || plan.lengthBars <= 0) {
    throw new Error("Plan lengthBars must be a positive number.");
  }

  if (!Array.isArray(plan.notes) || !plan.notes.length) {
    throw new Error("Plan must include at least one note.");
  }

  for (const note of plan.notes) {
    if (!Number.isFinite(note.note) || !Number.isFinite(note.time) || !Number.isFinite(note.duration)) {
      throw new Error("Each note must include numeric note, time, and duration values.");
    }
  }
}

async function executeClipPlan(planInput) {
  const plan = normalizePlan(planInput);
  validatePlan(plan);

  return withAbleton(async (ableton) => {
    const track = await getTrackByIndex(ableton, plan.trackIndex);
    const slots = await retryAbleton(() => track.get("clip_slots"));
    const slot = slots[plan.slotIndex - 1];

    if (!slot) {
      throw new Error(
        `Slot ${plan.slotIndex} does not exist on track "${track.raw.name}". Found ${slots.length} slots.`,
      );
    }

    let clip;
    if (await retryAbleton(() => slot.get("has_clip"))) {
      clip = await retryAbleton(() => slot.get("clip", false));
      const currentLength = await retryAbleton(() => clip.get("length"));
      await retryAbleton(() =>
        clip.removeNotesExtended(0, 0, Math.max(currentLength, plan.lengthBars), 128),
      );
    } else {
      await retryAbleton(() => slot.createClip(plan.lengthBars));
      clip = await retryAbleton(() => slot.get("clip", false));
    }

    await retryAbleton(() => clip.set("name", plan.clipName));
    await retryAbleton(() => clip.set("looping", Boolean(plan.looping)));
    await retryAbleton(() => clip.set("loop_start", 0));
    await retryAbleton(() => clip.set("loop_end", plan.lengthBars));
    await retryAbleton(() =>
      clip.setNotes(
        plan.notes.map((note) =>
          makeNote(note.note, note.time, note.duration, note.velocity || 100),
        ),
      ),
    );

    return {
      ok: true,
      message: `Executed plan into track ${plan.trackIndex} slot ${plan.slotIndex}.`,
      plan,
      clip: await summarizeClip(clip),
    };
  });
}

async function runAndExecuteLlmCommand(prompt, trackIndex, slotIndex, options = {}) {
  const llmResult = await runLlmCommand(prompt, trackIndex, options);
  let executionResult;

  try {
    const normalizedPlan = normalizePlan(llmResult.message);
    const overriddenPlan = applyPlanOverrides(normalizedPlan, { trackIndex, slotIndex });
    executionResult = await executeClipPlan(overriddenPlan);
  } catch (error) {
    executionResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      message: "LLM responded, but the plan could not be applied.",
    };
  }

  return {
    ok: executionResult.ok,
    model: llmResult.model,
    message: llmResult.message,
    context: llmResult.context,
    execution: executionResult,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      const trackIndex = Number(url.searchParams.get("track") || "1");
      const payload = await enqueue(() => getDashboard(trackIndex));
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tracks/midi") {
      const payload = await enqueue(() => createMidiTrackAndDashboard());
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scenes") {
      const body = await readJsonBody(req);
      const trackIndex = Number(body.trackIndex || 1);
      const payload = await enqueue(() => createSceneAndDashboard(trackIndex));
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/llm/command") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();
      const trackIndex = Number(body.trackIndex || 1);
      const references = Array.isArray(body.references)
        ? body.references.map((reference) => ({
            trackIndex: Number(reference.trackIndex || 0),
            slotIndex: Number(reference.slotIndex || 0),
          }))
        : [];
      const referenceTrackIndex = Number(body.referenceTrackIndex || 0);
      const referenceSlotIndex = Number(body.referenceSlotIndex || 0);

      if (!prompt) {
        sendJson(res, 400, { error: "Prompt is required." });
        return;
      }

      const payload = await enqueue(() =>
        runLlmCommand(prompt, trackIndex, {
          references:
            references.length > 0
              ? references
              : Number.isInteger(referenceTrackIndex) &&
                  referenceTrackIndex > 0 &&
                  Number.isInteger(referenceSlotIndex) &&
                  referenceSlotIndex > 0
                ? [{ trackIndex: referenceTrackIndex, slotIndex: referenceSlotIndex }]
                : [],
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/llm/run") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();
      const trackIndex = Number(body.trackIndex || 1);
      const slotIndex = Number(body.slotIndex || 1);
      const references = Array.isArray(body.references)
        ? body.references.map((reference) => ({
            trackIndex: Number(reference.trackIndex || 0),
            slotIndex: Number(reference.slotIndex || 0),
          }))
        : [];
      const referenceTrackIndex = Number(body.referenceTrackIndex || 0);
      const referenceSlotIndex = Number(body.referenceSlotIndex || 0);

      if (!prompt) {
        sendJson(res, 400, { error: "Prompt is required." });
        return;
      }

      const payload = await enqueue(() =>
        runAndExecuteLlmCommand(prompt, trackIndex, slotIndex, {
          references:
            references.length > 0
              ? references
              : Number.isInteger(referenceTrackIndex) &&
                  referenceTrackIndex > 0 &&
                  Number.isInteger(referenceSlotIndex) &&
                  referenceSlotIndex > 0
                ? [{ trackIndex: referenceTrackIndex, slotIndex: referenceSlotIndex }]
                : [],
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/llm/execute-plan") {
      const body = await readJsonBody(req);
      const planSource = body.plan ?? body.text ?? body.response;
      if (!planSource) {
        sendJson(res, 400, { error: "Plan, text, or response is required." });
        return;
      }

      const payload = await enqueue(() => executeClipPlan(planSource));
      sendJson(res, 200, payload);
      return;
    }

    const loopMatch = url.pathname.match(/^\/api\/tracks\/(\d+)\/starter-drum-loop$/);
    if (req.method === "POST" && loopMatch) {
      const trackIndex = Number(loopMatch[1]);
      const body = await readJsonBody(req);
      const slotIndex = Number(body.slotIndex || 1);
      const payload = await enqueue(() => createStarterDrumLoop(trackIndex, slotIndex));
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[ableton-web-api] listening on http://${HOST}:${PORT}`);
});
