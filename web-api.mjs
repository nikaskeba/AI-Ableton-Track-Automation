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
const LLM_MAX_TOKENS = Number(process.env.ABLETON_LLM_MAX_TOKENS || 20000);
const LLM_CONTEXT_TOKENS = Number(process.env.ABLETON_LLM_CONTEXT_TOKENS || 20000);
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
    notes: notes.slice(0, 256).map((note) => ({
      pitch: note.pitch,
      time: note.time,
      duration: note.duration,
      velocity: note.velocity,
    })),
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
        parameters.slice(0, 24).map(async (parameter, parameterIndex) => {
          const [value, min, max] = await Promise.all([
            parameter.get("value").catch(() => parameter.raw.value),
            parameter.get("min"),
            parameter.get("max"),
          ]);
          return {
            index: parameterIndex + 1,
            name: parameter.raw.name,
            value,
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

async function setDeviceParameterAndDashboard(trackIndex, deviceIndex, parameterIndex, value) {
  return withAbleton(async (ableton) => {
    const track = await getTrackByIndex(ableton, trackIndex);
    const devices = await track.get("devices");
    const device = devices[deviceIndex - 1];

    if (!device) {
      throw new Error(
        `Device ${deviceIndex} does not exist on track "${track.raw.name}". Found ${devices.length} devices.`,
      );
    }

    const parameters = await device.get("parameters");
    const parameter = parameters[parameterIndex - 1];

    if (!parameter) {
      throw new Error(
        `Parameter ${parameterIndex} does not exist on device "${device.raw.name}". Found ${parameters.length} parameters.`,
      );
    }

    const [min, max] = await Promise.all([parameter.get("min"), parameter.get("max")]);
    const boundedValue = Math.max(min, Math.min(max, value));
    await parameter.set("value", boundedValue);

    const dashboard = await buildDashboardFromAbleton(ableton, trackIndex);
    const { _tracks, ...publicDashboard } = dashboard;

    return publicDashboard;
  });
}

function buildFallbackTemplatePlan(prompt) {
  const normalizedPrompt = String(prompt || "").trim() || "electronic ambient";
  const isAmbient = /ambient|drone|space|cinematic|texture/i.test(normalizedPrompt);

  return {
    style: normalizedPrompt,
    bpm: isAmbient ? 84 : 124,
    tracks: [
      { role: "pad", name: "pad: warm analog slow" },
      { role: "texture", name: "texture: noisy vinyl wide" },
      { role: "bass", name: "bass: sub soft sparse" },
      { role: "motif", name: "motif: bell ambient repetitive" },
      { role: "fx", name: "fx: airy reversed riser" },
      { role: "perc", name: "perc: light organic irregular" },
    ],
    nextStep: "Select sounds manually for each track.",
  };
}

function normalizeTemplatePlan(input, fallbackPrompt) {
  const source = typeof input === "string" ? extractJsonFromText(input) : input;
  const fallback = buildFallbackTemplatePlan(fallbackPrompt);
  const tracks = Array.isArray(source?.tracks)
    ? source.tracks
        .map((track, index) => {
          const fallbackTrack = fallback.tracks[index] || {
            role: `track ${index + 1}`,
            name: `track ${index + 1}: sound placeholder`,
          };
          const role = String(track.role || fallbackTrack.role).trim();
          const name = String(track.name || `${role}: ${track.description || fallbackTrack.name}`).trim();

          return {
            role,
            name: name.includes(":") ? name : `${role}: ${name}`,
          };
        })
        .slice(0, 8)
    : fallback.tracks;

  return {
    style: String(source?.style || fallback.style),
    bpm:
      Number.isFinite(Number(source?.bpm)) && Number(source.bpm) >= 40 && Number(source.bpm) <= 220
        ? Number(source.bpm)
        : fallback.bpm,
    tracks: tracks.length ? tracks : fallback.tracks,
    nextStep: String(source?.nextStep || fallback.nextStep),
  };
}

async function generateTemplatePlan(prompt) {
  if (!LLM_API_KEY) {
    return buildFallbackTemplatePlan(prompt);
  }

  try {
    const response = await fetch(LLM_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        stream: false,
        temperature: 0.35,
        max_tokens: 2500,
        max_input_tokens: LLM_CONTEXT_TOKENS,
        context_window: LLM_CONTEXT_TOKENS,
        options: {
          num_ctx: LLM_CONTEXT_TOKENS,
        },
        messages: [
          {
            role: "system",
            content:
              "You create Ableton Live song template starter plans. Return strict JSON only, no markdown. The JSON shape must be {\"style\":\"...\",\"bpm\":84,\"tracks\":[{\"role\":\"pad\",\"name\":\"pad: warm analog slow\"}],\"nextStep\":\"Select sounds manually for each track.\"}. For step 1, only choose tempo and track names. Do not choose plugins, presets, notes, clips, devices, automation, or arrangement yet. Create 6 tracks unless the prompt strongly requires otherwise.",
          },
          {
            role: "user",
            content: `Create step 1 template plan for: ${prompt}`,
          },
        ],
      }),
    });
    const payload = await response.json();
    const message = payload.choices?.[0]?.message?.content;

    if (!response.ok || !message) {
      return buildFallbackTemplatePlan(prompt);
    }

    return normalizeTemplatePlan(message, prompt);
  } catch {
    return buildFallbackTemplatePlan(prompt);
  }
}

async function applyTemplateStepOne(prompt) {
  const plan = await generateTemplatePlan(prompt);

  return withAbleton(async (ableton) => {
    await ableton.song.set("tempo", plan.bpm);
    let tracks = await ableton.song.get("tracks");

    while (tracks.length < plan.tracks.length) {
      await ableton.song.createMidiTrack(-1);
      tracks = await ableton.song.get("tracks");
    }

    for (const [index, templateTrack] of plan.tracks.entries()) {
      await tracks[index].set("name", templateTrack.name);
    }

    const dashboard = await buildDashboardFromAbleton(ableton, 1);
    const { _tracks, ...publicDashboard } = dashboard;

    return {
      ok: true,
      message: `Template step 1 applied: ${plan.tracks.length} tracks named at ${plan.bpm} BPM.`,
      step: 1,
      plan,
      dashboard: publicDashboard,
    };
  });
}

function normalizeRoleName(value, fallbackRole = "track") {
  const normalized = String(value || fallbackRole)
    .trim()
    .toLowerCase()
    .replace(/^[0-9]+[\s.-]+/, "")
    .replace(/:.*$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallbackRole;
}

function getTemplateTrackRole(trackName, fallbackIndex) {
  const rawName = String(trackName || "").trim();
  const beforeColon = rawName.includes(":") ? rawName.split(":")[0] : rawName;
  return normalizeRoleName(beforeColon, `track_${fallbackIndex + 1}`);
}

function normalizeClipName(role, value, sceneName) {
  const rawValue = String(value || "").trim();
  if (rawValue) {
    return rawValue
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  return `${role}_${normalizeRoleName(sceneName, "scene")}`;
}

function getReferenceClipName(role) {
  return role === "pad" ? "pad_warm_intro_reference" : `${role}_reference`;
}

function getReferenceSceneClipName(role, isPrimaryReference = false) {
  if (isPrimaryReference) {
    return getReferenceClipName(role);
  }

  const referenceNames = {
    texture: "texture_reference_air",
    bass: "bass_reference_root",
    motif: "motif_reference_phrase",
    fx: "fx_reference_transition",
    perc: "perc_reference_groove",
  };

  return referenceNames[role] || `${role}_reference`;
}

function getDefaultFoundationScenes() {
  return [
    {
      name: "Reference",
      clips: {},
    },
    {
      name: "Intro",
      clips: {
        pad: "pad_warm_intro",
        texture: "texture_sparse_air",
        bass: null,
        motif: null,
        fx: "fx_riser_intro",
        perc: null,
      },
    },
    {
      name: "Build 1",
      clips: {
        pad: "pad_warm_main",
        texture: "texture_noise_wide",
        bass: null,
        motif: "motif_soft_repeat",
        fx: null,
        perc: "perc_light_pulse",
      },
    },
    {
      name: "Build 2",
      clips: {
        pad: "pad_warm_main",
        texture: "texture_movement",
        bass: "bass_sub_root",
        motif: "motif_soft_repeat",
        fx: null,
        perc: "perc_light_pulse",
      },
    },
    {
      name: "Main",
      clips: {
        pad: "pad_bright_open",
        texture: "texture_movement",
        bass: "bass_sub_variation",
        motif: "motif_high_variant",
        fx: null,
        perc: "perc_busier_pattern",
      },
    },
    {
      name: "Breakdown",
      clips: {
        pad: "pad_dark_break",
        texture: "texture_sparse_air",
        bass: null,
        motif: "motif_sparse",
        fx: "fx_swell_transition",
        perc: null,
      },
    },
    {
      name: "Return",
      clips: {
        pad: "pad_bright_open",
        texture: "texture_movement",
        bass: "bass_sub_root",
        motif: "motif_soft_repeat",
        fx: "fx_impact_hit",
        perc: "perc_light_pulse",
      },
    },
    {
      name: "Outro",
      clips: {
        pad: "pad_fade_out",
        texture: "texture_sparse_air",
        bass: null,
        motif: null,
        fx: "fx_reverse_tail",
        perc: null,
      },
    },
  ];
}

function buildFallbackFoundationPlan({ style, bpm, tracks }) {
  const roles = tracks.map((track, index) => track.role || getTemplateTrackRole(track.name, index));
  const defaultScenes = getDefaultFoundationScenes();
  const referenceRole = roles[0] || "pad";
  const referenceClipName = getReferenceClipName(referenceRole);

  return {
    style: String(style || "electronic ambient"),
    bpm: Number.isFinite(Number(bpm)) ? Number(bpm) : 84,
    scenes: defaultScenes.map((scene) => ({
      name: scene.name,
      clips: Object.fromEntries(
        roles.map((role) => {
          if (scene.name === "Reference") {
            return [role, getReferenceSceneClipName(role, role === referenceRole)];
          }

          if (Object.hasOwn(scene.clips, role)) {
            return [role, scene.clips[role]];
          }

          if (["Intro", "Build 2", "Main", "Return", "Outro"].includes(scene.name)) {
            return [role, `${role}_${normalizeRoleName(scene.name, "scene")}`];
          }

          return [role, null];
        }),
      ),
    })),
    reference: {
      trackIndex: 1,
      slotIndex: 1,
      role: referenceRole,
      clipName: referenceClipName,
    },
    nextStep: "Select sounds manually, then generate musical parts track by track.",
  };
}

function normalizeTemplateTracksForFoundation(tracks) {
  return tracks
    .map((track, index) => {
      const name = String(track?.name || track?.displayName || `track ${index + 1}`).trim();
      const role = normalizeRoleName(track?.role || getTemplateTrackRole(name, index), `track_${index + 1}`);

      return {
        index: Number.isInteger(track?.index) ? track.index : index + 1,
        role,
        name,
      };
    })
    .filter((track) => track.name)
    .slice(0, 12);
}

function normalizeTemplateFoundationPlan(input, fallbackContext) {
  const source = typeof input === "string" ? extractJsonFromText(input) : input;
  const fallback = buildFallbackFoundationPlan(fallbackContext);
  const roles = new Set(fallbackContext.tracks.map((track) => track.role));

  function normalizeScene(scene, sceneIndex) {
    const fallbackScene = fallback.scenes[sceneIndex] || {
      name: `Scene ${sceneIndex + 1}`,
      clips: {},
    };
    const isReferenceScene = sceneIndex === 0;
    const name = isReferenceScene ? "Reference" : String(scene?.name || fallbackScene.name).trim();
    const rawClips = scene?.clips && typeof scene.clips === "object" ? scene.clips : {};
    const clips = {};

    for (const role of roles) {
      if (isReferenceScene) {
        clips[role] = fallbackScene.clips?.[role] ?? null;
        continue;
      }

      const matchingClipKey = Object.keys(rawClips).find(
        (key) => normalizeRoleName(key) === role,
      );
      const value =
        matchingClipKey !== undefined ? rawClips[matchingClipKey] : fallbackScene.clips?.[role] ?? null;
      clips[role] =
        value === null || value === false || String(value).trim() === ""
          ? null
          : normalizeClipName(role, value, name);
    }

    return { name, clips };
  }

  const rawLlmScenes = Array.isArray(source?.scenes) ? source.scenes : [];
  const firstSceneName = normalizeRoleName(rawLlmScenes[0]?.name || "");
  const llmScenes = firstSceneName === "reference" ? rawLlmScenes : [null, ...rawLlmScenes];
  const sceneCount = Math.max(fallback.scenes.length, llmScenes.length);
  const scenes = Array.from({ length: sceneCount }, (_, sceneIndex) =>
    normalizeScene(llmScenes[sceneIndex], sceneIndex),
  )
    .filter((scene) => scene.name)
    .slice(0, 12);

  return {
    style: String(source?.style || fallback.style),
    bpm:
      Number.isFinite(Number(source?.bpm)) && Number(source.bpm) >= 40 && Number(source.bpm) <= 220
        ? Number(source.bpm)
        : fallback.bpm,
    scenes: scenes.length ? scenes : fallback.scenes,
    reference: fallback.reference,
    nextStep: String(source?.nextStep || fallback.nextStep),
  };
}

async function generateTemplateFoundationPlan(context) {
  const fallback = buildFallbackFoundationPlan(context);
  const requiredSceneShape = fallback.scenes.map((scene) => ({
    name: scene.name,
    clips: Object.fromEntries(context.tracks.map((track) => [track.role, scene.clips[track.role] ?? null])),
  }));

  if (!LLM_API_KEY) {
    return fallback;
  }

  try {
    const response = await fetch(LLM_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        stream: false,
        temperature: 0.3,
        max_tokens: 3500,
        max_input_tokens: LLM_CONTEXT_TOKENS,
        context_window: LLM_CONTEXT_TOKENS,
        options: {
          num_ctx: LLM_CONTEXT_TOKENS,
        },
        messages: [
          {
            role: "system",
            content:
              "You create Ableton Live template foundations. Return strict JSON only, no markdown. This is step 2 only: create scene names and clip names for a full song structure. Do not create notes, automation, devices, presets, arrangement lanes, or parameter changes. Scene 1 is reserved as Reference and must keep only the first track role active as the reusable reference clip. After Reference, return scenes covering intro, builds, main, breakdown, return, and outro. Every scene must include every provided track role as a clip key. Use string clip names when that instrument should participate in the scene, or null when it should stay empty. Keep clip names short, lowercase, underscore_separated.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Create step 2 foundation scene and clip names.",
              style: context.style,
              bpm: context.bpm,
              tracks: context.tracks,
              instruction:
                "Generate the Reference scene first, then all scenes for the song. Scene 1 must stay Reference with Track 1 Slot 1 as the reusable reference clip. Each scene must include all track role keys. Vary clip names by scene and role. Use null where an instrument should not be pulled into that scene.",
              requiredShape: {
                style: context.style,
                bpm: context.bpm,
                scenes: requiredSceneShape,
                reference: fallback.reference,
                nextStep: "Select sounds manually, then generate musical parts track by track.",
              },
            }),
          },
        ],
      }),
    });
    const payload = await response.json();
    const message = payload.choices?.[0]?.message?.content;

    if (!response.ok || !message) {
      return fallback;
    }

    return normalizeTemplateFoundationPlan(message, context);
  } catch {
    return fallback;
  }
}

async function applyTemplateStepTwo({ prompt, style, bpm, tracks: requestedTracks }) {
  return withAbleton(async (ableton) => {
    const [songTempo, abletonTracks] = await Promise.all([
      ableton.song.get("tempo").catch(() => bpm),
      ableton.song.get("tracks"),
    ]);
    const trackContext = normalizeTemplateTracksForFoundation(
      Array.isArray(requestedTracks) && requestedTracks.length
        ? requestedTracks
        : abletonTracks.map((track, index) => ({
            index: index + 1,
            name: track.raw.name,
          })),
    );
    const foundationContext = {
      style: String(style || prompt || "current template"),
      bpm: Number.isFinite(Number(bpm)) ? Number(bpm) : songTempo,
      tracks: trackContext,
    };
    const plan = await generateTemplateFoundationPlan(foundationContext);
    let scenes = await ensureMinimumScenes(ableton, Math.max(MIN_SESSION_SCENES, plan.scenes.length));
    const skipped = [];

    for (const [sceneIndex, scene] of plan.scenes.entries()) {
      if (!scenes[sceneIndex]) {
        await ableton.song.createScene(-1);
        scenes = await ableton.song.get("scenes");
      }

      await scenes[sceneIndex].set("name", scene.name);
    }

    for (const [trackIndex, trackContextItem] of trackContext.entries()) {
      const track = abletonTracks[trackIndex];
      if (!track) {
        continue;
      }

      const slots = await track.get("clip_slots");

      for (const [sceneIndex, scene] of plan.scenes.entries()) {
        const clipName = scene.clips?.[trackContextItem.role] ?? null;
        if (!clipName) {
          continue;
        }

        const slot = slots[sceneIndex];
        if (!slot) {
          skipped.push({
            trackIndex: trackContextItem.index,
            sceneIndex: sceneIndex + 1,
            reason: "Clip slot does not exist.",
          });
          continue;
        }

        try {
          const hasClip = await slot.get("has_clip").catch(() => false);
          if (!hasClip) {
            await retryAbleton(() => slot.createClip(4));
          }

          const clip = await retryAbleton(() => slot.get("clip", false));
          await retryAbleton(() => clip.set("name", clipName));
        } catch (error) {
          skipped.push({
            trackIndex: trackContextItem.index,
            sceneIndex: sceneIndex + 1,
            clipName,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const dashboard = await buildDashboardFromAbleton(ableton, 1);
    const { _tracks, ...publicDashboard } = dashboard;

    return {
      ok: true,
      message: `Template step 2 applied: ${plan.scenes.length} scenes named and foundation clips prepared.`,
      step: 2,
      plan,
      skipped,
      dashboard: publicDashboard,
    };
  });
}

async function getClipNameAtSlot(trackIndex, slotIndex, fallbackName) {
  return withAbleton(async (ableton) => {
    const track = await getTrackByIndex(ableton, trackIndex);
    const slots = await track.get("clip_slots");
    const slot = slots[slotIndex - 1];

    if (!slot) {
      return fallbackName;
    }

    if (!(await slot.get("has_clip").catch(() => false))) {
      return fallbackName;
    }

    const clip = await slot.get("clip", false).catch(() => null);
    return clip?.raw?.name || fallbackName;
  });
}

function buildReferenceAnchorPrompt({ prompt, style, bpm, clipName, anchorPriority }) {
  return [
    `Template style: ${style || prompt || "current template"}`,
    `Tempo: ${Number.isFinite(Number(bpm)) ? Number(bpm) : "current"} BPM`,
    `Reserved reference clip: ${clipName}`,
    `Anchor priority: ${anchorPriority.join(" > ")}`,
    "Create only the first reference anchor MIDI clip for this template.",
    "Follow the anchor priority by making the harmonic identity the first decision unless the selected instrument is clearly not harmonic.",
    "This clip should act as the reusable musical reference for the rest of the template: key center, major/minor/modal mood, chord color, note density, and phrase length.",
    "Do not create drums unless the selected target track is actually a drum rack.",
    "Do not create clips for other tracks or scenes yet.",
    "Return a PLAN_JSON block for one create_clip action only.",
  ].join("\n");
}

async function applyTemplateReferenceAnchor({ prompt, style, bpm, reference, anchorPriority }) {
  const referenceTrackIndex = Number(reference?.trackIndex || 1);
  const referenceSlotIndex = Number(reference?.slotIndex || 1);
  const priority = Array.isArray(anchorPriority) && anchorPriority.length
    ? anchorPriority.map((item) => normalizeRoleName(item)).filter(Boolean)
    : ["harmonic", "melodic", "bass", "rhythmic", "texture"];
  const clipName = await getClipNameAtSlot(
    referenceTrackIndex,
    referenceSlotIndex,
    reference?.clipName || getReferenceClipName("pad"),
  );
  const anchorPrompt = buildReferenceAnchorPrompt({
    prompt,
    style,
    bpm,
    clipName,
    anchorPriority: priority,
  });
  const result = await runAndExecuteLlmCommand(
    anchorPrompt,
    referenceTrackIndex,
    referenceSlotIndex,
    {
      clipName,
    },
  );
  const dashboard = await getDashboard(referenceTrackIndex);

  return {
    ...result,
    step: 3,
    anchorPriority: priority,
    reference: {
      trackIndex: referenceTrackIndex,
      slotIndex: referenceSlotIndex,
      clipName,
    },
    dashboard,
  };
}

async function collectTemplatePartTargets({
  referenceTrackIndex = 1,
  referenceSlotIndex = 1,
  overwrite = false,
  onlyReferenceScene = true,
}) {
  return withAbleton(async (ableton) => {
    const [tempo, tracks, scenes] = await Promise.all([
      ableton.song.get("tempo"),
      ableton.song.get("tracks"),
      ensureMinimumScenes(ableton, MIN_SESSION_SCENES),
    ]);
    const referenceTrack = tracks[referenceTrackIndex - 1];

    if (!referenceTrack) {
      throw new Error(`Reference track ${referenceTrackIndex} does not exist.`);
    }

    const referenceSummary = await summarizeReferenceClipFromTrack(
      referenceTrack,
      referenceTrackIndex,
      referenceSlotIndex,
    );

    if (!referenceSummary.clip.noteCount) {
      throw new Error(
        `Reference track ${referenceTrackIndex} slot ${referenceSlotIndex} has no MIDI notes yet. Run Step 3 first.`,
      );
    }

    const sceneSummaries = await Promise.all(
      scenes.map((scene, index) => summarizeSceneListItem(scene, index + 1)),
    );
    const targets = [];

    for (const [trackIndex, track] of tracks.entries()) {
      const trackSummary = await summarizeTrack(track, trackIndex + 1);
      const trackContext = inferTrackMode(trackSummary);
      const primaryDevice = trackContext.primaryDevice;

      if (onlyReferenceScene) {
        const isReferenceTrack = trackIndex + 1 === referenceTrackIndex;
        if (isReferenceTrack) {
          continue;
        }

        const slots = await track.get("clip_slots");
        const slot = slots[referenceSlotIndex - 1];
        if (!slot) {
          continue;
        }

        let clipSummary = null;
        const hasClip = await slot.get("has_clip").catch(() => false);

        if (!hasClip) {
          const role = getTemplateTrackRole(trackSummary.track.name, trackIndex);
          const clipName = getReferenceSceneClipName(role, false);

          try {
            await retryAbleton(() => slot.createClip(4));
            const createdClip = await retryAbleton(() => slot.get("clip", false));
            await retryAbleton(() => createdClip.set("name", clipName));
            clipSummary = await summarizeClip(createdClip);
          } catch {
            continue;
          }
        } else {
          const rawClip = await slot.get("clip", false).catch(() => null);
          if (!rawClip || !rawClip.raw?.is_midi_clip) {
            continue;
          }
          clipSummary = await summarizeClip(rawClip);
        }

        if (!clipSummary || (!overwrite && clipSummary.noteCount > 0)) {
          continue;
        }

        targets.push({
          trackIndex: trackIndex + 1,
          slotIndex: referenceSlotIndex,
          trackName: trackSummary.track.name,
          sceneName: sceneSummaries[referenceSlotIndex - 1]?.name || `Scene ${referenceSlotIndex}`,
          clipName: clipSummary.name || `Clip ${referenceSlotIndex}`,
          mode: trackContext.mode,
          instrument: primaryDevice
            ? {
                name: primaryDevice.name,
                className: primaryDevice.className,
                type: primaryDevice.type,
                currentPresetName: primaryDevice.currentPresetName || null,
              }
            : null,
          drumPads:
            trackContext.mode === "drum" && Array.isArray(trackContext.soundPalette)
              ? trackContext.soundPalette
              : [],
        });
        continue;
      }

      for (const slot of trackSummary.clipSlots) {
        const isReferenceSlot =
          trackIndex + 1 === referenceTrackIndex && slot.index === referenceSlotIndex;

        if (isReferenceSlot || !slot.hasClip || !slot.clip) {
          continue;
        }

        if (!overwrite && slot.clip.noteCount > 0) {
          continue;
        }

        targets.push({
          trackIndex: trackIndex + 1,
          slotIndex: slot.index,
          trackName: trackSummary.track.name,
          sceneName: sceneSummaries[slot.index - 1]?.name || `Scene ${slot.index}`,
          clipName: slot.clip.name || `Clip ${slot.index}`,
          mode: trackContext.mode,
          instrument: primaryDevice
            ? {
                name: primaryDevice.name,
                className: primaryDevice.className,
                type: primaryDevice.type,
                currentPresetName: primaryDevice.currentPresetName || null,
              }
            : null,
          drumPads:
            trackContext.mode === "drum" && Array.isArray(trackContext.soundPalette)
              ? trackContext.soundPalette
              : [],
        });
      }
    }

    return {
      song: { tempo },
      reference: referenceSummary,
      targets,
    };
  });
}

function buildTemplatePartPrompt({ prompt, style, bpm, target, reference }) {
  const instrumentText = target.instrument
    ? `${target.instrument.name} (${target.instrument.className}, ${target.instrument.type})${
        target.instrument.currentPresetName ? ` preset ${target.instrument.currentPresetName}` : ""
      }`
    : "unknown instrument";
  const drumText = target.drumPads?.length
    ? [
        "Target drum rack instruments:",
        ...target.drumPads.map(
          (pad) => `- ${pad.name}${pad.note !== null ? ` note ${pad.note}` : ""}`,
        ),
      ].join("\n")
    : "";

  return [
    `Template style: ${style || prompt || "current template"}`,
    `Tempo: ${Number.isFinite(Number(bpm)) ? Number(bpm) : "current"} BPM`,
    `Reference anchor: Track ${reference.track.index} "${reference.track.name}" Slot ${reference.slot.index} "${reference.clip.name}"`,
    `Reference anchor notes: ${reference.clip.noteCount} notes, pitches ${reference.clip.uniquePitches.join(", ") || "none"}`,
    `Target scene: ${target.sceneName}`,
    `Target track: ${target.trackIndex} "${target.trackName}"`,
    `Target clip: Slot ${target.slotIndex} "${target.clipName}"`,
    `Target instrument: ${instrumentText}`,
    `Target mode: ${target.mode}`,
    drumText,
    "Generate this one target clip only, using the reference anchor for key, mood, phrase length, density, and energy.",
    target.mode === "drum"
      ? "Because this target is drums, use the listed drum rack instruments/notes and create a complementary rhythmic part. Do not invent melodic pitches outside the drum pads."
      : "Because this target is melodic/harmonic, write a part that fits the reference anchor without copying it exactly.",
    "Respect the clip name and scene role when deciding density and purpose.",
    "Return a PLAN_JSON block for one create_clip action only.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getTemplateReferenceSummary(referenceTrackIndex, referenceSlotIndex) {
  return withAbleton(async (ableton) => {
    const referenceTrack = await getTrackByIndex(ableton, referenceTrackIndex);
    return summarizeReferenceClipFromTrack(referenceTrack, referenceTrackIndex, referenceSlotIndex);
  });
}

function normalizeAnchorPriority(anchorPriority) {
  return Array.isArray(anchorPriority) && anchorPriority.length
    ? anchorPriority.map((item) => normalizeRoleName(item)).filter(Boolean)
    : ["harmonic", "melodic", "bass", "rhythmic", "texture"];
}

async function generateTemplatePartFromTarget({
  prompt,
  style,
  bpm,
  reference,
  target,
  anchorPriority,
}) {
  const referenceTrackIndex = Number(reference?.trackIndex || reference?.track?.index || 1);
  const referenceSlotIndex = Number(reference?.slotIndex || reference?.slot?.index || 1);
  const priority = normalizeAnchorPriority(anchorPriority);
  const referenceSummary = await getTemplateReferenceSummary(
    referenceTrackIndex,
    referenceSlotIndex,
  );

  const targetPrompt = buildTemplatePartPrompt({
    prompt: `${prompt || ""}\nAnchor priority: ${priority.join(" > ")}`,
    style,
    bpm,
    target,
    reference: referenceSummary,
  });

  let result;
  try {
    result = await runAndExecuteLlmCommand(
      targetPrompt,
      Number(target.trackIndex),
      Number(target.slotIndex),
      {
        clipName: target.clipName,
        references: [
          {
            trackIndex: referenceTrackIndex,
            slotIndex: referenceSlotIndex,
          },
        ],
      },
    );
  } catch (error) {
    result = {
      ok: false,
      model: LLM_MODEL,
      message: "",
      execution: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Template part could not be generated.",
      },
    };
  }

  const dashboard = await getDashboard(Number(target.trackIndex) || referenceTrackIndex);
  const summary = {
    ok: Boolean(result.execution?.ok),
    trackIndex: Number(target.trackIndex),
    slotIndex: Number(target.slotIndex),
    trackName: target.trackName,
    sceneName: target.sceneName,
    clipName: target.clipName,
    instrument: target.instrument,
    mode: target.mode,
    error: result.execution?.ok ? null : result.execution?.error || "Execution failed.",
  };

  return {
    ok: summary.ok,
    model: result.model,
    message: result.message,
    execution: result.execution,
    result: summary,
    reference: {
      trackIndex: referenceTrackIndex,
      slotIndex: referenceSlotIndex,
      clipName: referenceSummary.clip.name,
    },
    dashboard,
  };
}

async function applyTemplatePartsFromReference({
  prompt,
  style,
  bpm,
  reference,
  anchorPriority,
  overwrite = false,
}) {
  const referenceTrackIndex = Number(reference?.trackIndex || 1);
  const referenceSlotIndex = Number(reference?.slotIndex || 1);
  const priority = normalizeAnchorPriority(anchorPriority);
  const collected = await collectTemplatePartTargets({
    referenceTrackIndex,
    referenceSlotIndex,
    overwrite,
  });
  const results = [];

  for (const target of collected.targets) {
    const generated = await generateTemplatePartFromTarget({
      prompt,
      style,
      bpm: bpm || collected.song.tempo,
      reference: {
        trackIndex: referenceTrackIndex,
        slotIndex: referenceSlotIndex,
      },
      target,
      anchorPriority: priority,
    });

    results.push(generated.result);
  }

  const dashboard = await getDashboard(referenceTrackIndex);
  const generatedCount = results.filter((result) => result.ok).length;

  return {
    ok: results.every((result) => result.ok),
    step: 4,
    message: `Generated ${generatedCount} of ${collected.targets.length} reference scene clips from the reference anchor.`,
    reference: {
      trackIndex: referenceTrackIndex,
      slotIndex: referenceSlotIndex,
      clipName: collected.reference.clip.name,
    },
    anchorPriority: priority,
    generatedCount,
    targetCount: collected.targets.length,
    results,
    dashboard,
  };
}

async function ensureMinimumScenes(ableton, minimumScenes) {
  let scenes = await ableton.song.get("scenes");

  while (scenes.length < minimumScenes) {
    await ableton.song.createScene(-1);
    scenes = await ableton.song.get("scenes");
  }

  return scenes;
}

async function summarizeSceneListItem(scene, index) {
  const [name, isTriggered, isEmpty] = await Promise.all([
    scene.get("name").catch(() => scene.raw.name || ""),
    scene.get("is_triggered").catch(() => false),
    scene.get("is_empty").catch(() => false),
  ]);

  return {
    index,
    name: name || `Scene ${index}`,
    isTriggered,
    isEmpty,
  };
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
    scenes: await Promise.all(
      scenes.map((scene, index) => summarizeSceneListItem(scene, index + 1)),
    ),
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
      max_tokens: LLM_MAX_TOKENS,
      max_input_tokens: LLM_CONTEXT_TOKENS,
      context_window: LLM_CONTEXT_TOKENS,
      options: {
        num_ctx: LLM_CONTEXT_TOKENS,
      },
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
    clipName:
      typeof overrides.clipName === "string" && overrides.clipName.trim()
        ? overrides.clipName.trim()
        : plan.clipName,
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

  function repairJsonLike(input) {
    return input
      .replace(/}\s*(?={)/g, "},")
      .replace(
        /([}\]"0-9])\s+("(?:action|trackIndex|deviceIndex|slotIndex|clipSlotIndex|parameters|parameterChanges|changes|index|parameterIndex|name|parameterName|value|reason|notes|noteEvents|clipName|lengthBars|length|looping)"\s*:)/g,
        "$1,$2",
      )
      .replace(/,\s*([}\]])/g, "$1");
  }

  function balanceJsonLike(input) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (const char of input) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = inString;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" && stack.at(-1) === "{") {
        stack.pop();
      } else if (char === "]" && stack.at(-1) === "[") {
        stack.pop();
      }
    }

    const suffix = stack
      .reverse()
      .map((char) => (char === "{" ? "}" : "]"))
      .join("");

    return `${input}${suffix}`;
  }

  function parseJsonLike(input) {
    const sanitized = sanitizeJsonLike(input);
    const candidates = [
      sanitized,
      repairJsonLike(sanitized),
      balanceJsonLike(repairJsonLike(sanitized)),
    ];
    let lastError;

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
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
    const overriddenPlan = applyPlanOverrides(normalizedPlan, {
      trackIndex,
      slotIndex,
      clipName: options.clipName,
    });
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

function buildDeviceLlmPromptSummary(prompt, context, targetDevice) {
  const selectedTrack = context.selectedTrack;
  const parameterSummary = targetDevice.parameters
    .map(
      (parameter) =>
        `${parameter.index}. "${parameter.name}": current=${parameter.value}, min=${parameter.min}, max=${parameter.max}${parameter.isQuantized ? ", quantized/integer-like" : ""}`,
    )
    .join("\n");

  return [
    `User request: ${prompt}`,
    selectedTrack
      ? `Target track: ${selectedTrack.index} - ${selectedTrack.name}`
      : "Target track: unknown",
    `Target device: ${targetDevice.index}. ${targetDevice.name} (${targetDevice.className}, ${targetDevice.type})`,
    targetDevice.currentPresetName
      ? `Target preset: ${targetDevice.currentPresetName}`
      : "Target preset: none exposed",
    `Available parameters:\n${parameterSummary}`,
    "Only use parameters from this list. Include both index and exact name for every changed parameter.",
    "Return a compact PLAN_JSON block to set only useful changed parameters.",
  ].join("\n");
}

function buildDeviceLlmContext(dashboard, targetDevice) {
  const selectedTrack = dashboard.selectedTrack?.track;

  return {
    song: dashboard.song,
    selectedTrack: selectedTrack
      ? {
          index: selectedTrack.index,
          name: selectedTrack.name,
        }
      : null,
    targetDevice: {
      index: targetDevice.index,
      name: targetDevice.name,
      className: targetDevice.className,
      type: targetDevice.type,
      currentPresetName: targetDevice.currentPresetName,
      parameters: targetDevice.parameters,
    },
  };
}

async function runDeviceLlmCommand(prompt, trackIndex, deviceIndex) {
  if (!LLM_API_KEY) {
    throw new Error("Missing ABLETON_LLM_API_KEY in .env or process environment.");
  }

  const dashboard = await withAbleton(async (ableton) => {
    const dashboardWithTracks = await buildDashboardFromAbleton(ableton, trackIndex);
    const { _tracks, ...publicDashboard } = dashboardWithTracks;
    return publicDashboard;
  });
  const targetDevice = dashboard.selectedTrack.devices.find((device) => device.index === deviceIndex);

  if (!targetDevice) {
    throw new Error(`Device ${deviceIndex} does not exist on track ${trackIndex}.`);
  }

  const context = buildDeviceLlmContext(dashboard, targetDevice);
  const promptSummary = buildDeviceLlmPromptSummary(prompt, context, targetDevice);
  const response = await fetch(LLM_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      stream: false,
      temperature: 0.2,
      max_tokens: LLM_MAX_TOKENS,
      max_input_tokens: LLM_CONTEXT_TOKENS,
      context_window: LLM_CONTEXT_TOKENS,
      options: {
        num_ctx: LLM_CONTEXT_TOKENS,
      },
      messages: [
        {
          role: "system",
          content:
            "You are helping control Ableton Live device parameters. Only adjust the selected target device. Use only the provided parameter names, indexes, min, max, and current values. Do not invent controls such as randomness, wetness, filter, resonance, or macro names unless they appear in the provided parameter list. Return a brief explanation and a PLAN_JSON block. The PLAN_JSON block must contain strict valid JSON only: double-quoted keys/strings, commas between every object and field, no comments, no trailing commas, no markdown inside the JSON. The JSON must be shaped like {\"action\":\"set_device_parameters\",\"trackIndex\":1,\"deviceIndex\":1,\"parameters\":[{\"index\":1,\"name\":\"Device On\",\"value\":1,\"reason\":\"short reason\"}]}. Include the exact parameter name with every index. Keep values within min/max. For quantized parameters, use whole-number values. If no listed parameter is relevant, return an empty parameters array and explain why. Do not create MIDI notes in this mode.",
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
    targetDevice,
  };
}

function normalizeDeviceParameterPlan(input) {
  const source =
    typeof input === "string"
      ? extractDeviceParameterPlanFromText(input)
      : input;

  if (!source || typeof source !== "object") {
    throw new Error("Device parameter plan must be an object.");
  }

  const parameters = source.parameters || source.parameterChanges || source.changes;

  return {
    action:
      source.action === "setDeviceParameters"
        ? "set_device_parameters"
        : source.action || "set_device_parameters",
    trackIndex: Number(source.trackIndex),
    deviceIndex: Number(source.deviceIndex),
    parameters: Array.isArray(parameters)
      ? parameters.map((parameter) => ({
          index:
            Number.isInteger(Number(parameter.index ?? parameter.parameterIndex))
              ? Number(parameter.index ?? parameter.parameterIndex)
              : null,
          name: parameter.name || parameter.parameterName || null,
          value: Number(parameter.value),
          reason: parameter.reason || "",
        }))
      : [],
  };
}

function extractDeviceParameterPlanFromText(text) {
  try {
    return extractJsonFromText(text);
  } catch {
    const trackIndex = Number(text.match(/"trackIndex"\s*:\s*(\d+)/)?.[1]);
    const deviceIndex = Number(text.match(/"deviceIndex"\s*:\s*(\d+)/)?.[1]);
    const parameterObjects = [...text.matchAll(/\{[^{}]*"(?:index|parameterIndex)"\s*:\s*\d+[^{}]*\}/g)];
    const parameters = parameterObjects
      .map((match) => {
        const raw = match[0];
        const index = Number(raw.match(/"(?:index|parameterIndex)"\s*:\s*(\d+)/)?.[1]);
        const name = raw.match(/"(?:name|parameterName)"\s*:\s*"([^"]+)"/)?.[1] || null;
        const value = Number(raw.match(/"value"\s*:\s*(-?\d+(?:\.\d+)?)/)?.[1]);
        const reason = raw.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] || "";

        return Number.isInteger(index) && Number.isFinite(value)
          ? {
              index,
              name,
              value,
              reason,
            }
          : null;
      })
      .filter(Boolean);

    if (!parameters.length) {
      throw new Error("Could not find JSON plan in the response.");
    }

    return {
      action: "set_device_parameters",
      trackIndex,
      deviceIndex,
      parameters,
    };
  }
}

function normalizeParameterName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function executeDeviceParameterPlan(planInput, overrides = {}) {
  const plan = normalizeDeviceParameterPlan(planInput);
  const trackIndex =
    Number.isInteger(overrides.trackIndex) && overrides.trackIndex > 0
      ? overrides.trackIndex
      : plan.trackIndex;
  const deviceIndex =
    Number.isInteger(overrides.deviceIndex) && overrides.deviceIndex > 0
      ? overrides.deviceIndex
      : plan.deviceIndex;

  if (plan.action !== "set_device_parameters") {
    throw new Error(`Unsupported device plan action: ${plan.action}`);
  }

  if (!Number.isInteger(trackIndex) || trackIndex <= 0) {
    throw new Error("Device plan trackIndex must be a positive integer.");
  }

  if (!Number.isInteger(deviceIndex) || deviceIndex <= 0) {
    throw new Error("Device plan deviceIndex must be a positive integer.");
  }

  if (!Array.isArray(plan.parameters) || !plan.parameters.length) {
    throw new Error("Device plan must include at least one parameter change.");
  }

  return withAbleton(async (ableton) => {
    const track = await getTrackByIndex(ableton, trackIndex);
    const devices = await track.get("devices");
    const device = devices[deviceIndex - 1];

    if (!device) {
      throw new Error(
        `Device ${deviceIndex} does not exist on track "${track.raw.name}". Found ${devices.length} devices.`,
      );
    }

    const parameters = await device.get("parameters");
    const applied = [];
    const skipped = [];

    for (const change of plan.parameters) {
      const namedParameterIndex = change.name
        ? parameters.findIndex(
            (parameter) =>
              normalizeParameterName(parameter.raw.name) === normalizeParameterName(change.name),
          ) + 1
        : 0;
      const parameterIndex = change.index || namedParameterIndex;
      const parameter = parameters[parameterIndex - 1];

      if (!parameter || !Number.isFinite(change.value)) {
        skipped.push({
          index: change.index,
          name: change.name,
          reason: "Parameter was not found or value was invalid.",
        });
        continue;
      }

      if (
        change.name &&
        normalizeParameterName(parameter.raw.name) !== normalizeParameterName(change.name)
      ) {
        skipped.push({
          index: change.index,
          name: change.name,
          matchedName: parameter.raw.name,
          reason: "Parameter index/name mismatch.",
        });
        continue;
      }

      const [min, max] = await Promise.all([parameter.get("min"), parameter.get("max")]);
      const isQuantized = Boolean(parameter.raw.is_quantized);
      const requestedValue = isQuantized ? Math.round(change.value) : change.value;
      const boundedValue = Math.max(min, Math.min(max, requestedValue));
      await parameter.set("value", boundedValue);
      const nextValue = await parameter.get("value");
      applied.push({
        index: parameterIndex,
        name: parameter.raw.name,
        value: nextValue,
        reason: change.reason,
      });
    }

    if (!applied.length) {
      throw new Error("No valid parameter changes could be applied.");
    }

    return {
      ok: true,
      message: `Applied ${applied.length} parameter change${applied.length === 1 ? "" : "s"} to ${device.raw.name}.`,
      plan: {
        ...plan,
        trackIndex,
        deviceIndex,
      },
      applied,
      skipped,
    };
  });
}

async function runAndExecuteDeviceLlmCommand(prompt, trackIndex, deviceIndex) {
  const llmResult = await runDeviceLlmCommand(prompt, trackIndex, deviceIndex);
  let executionResult;

  try {
    executionResult = await executeDeviceParameterPlan(llmResult.message, {
      trackIndex,
      deviceIndex,
    });
  } catch (error) {
    executionResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      message: "LLM responded, but the device parameter plan could not be applied.",
    };
  }

  return {
    ok: executionResult.ok,
    model: llmResult.model,
    message: llmResult.message,
    context: llmResult.context,
    targetDevice: llmResult.targetDevice,
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

    if (req.method === "POST" && url.pathname === "/api/template/step-one") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();

      if (!prompt) {
        sendJson(res, 400, { error: "Template prompt is required." });
        return;
      }

      const payload = await enqueue(() => applyTemplateStepOne(prompt));
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/template/step-two") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();

      const payload = await enqueue(() =>
        applyTemplateStepTwo({
          prompt,
          style: body.style,
          bpm: body.bpm,
          tracks: body.tracks,
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/template/reference-anchor") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();

      const payload = await enqueue(() =>
        applyTemplateReferenceAnchor({
          prompt,
          style: body.style,
          bpm: body.bpm,
          reference: body.reference,
          anchorPriority: body.anchorPriority,
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/template/generate-parts") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();

      const payload = await enqueue(() =>
        applyTemplatePartsFromReference({
          prompt,
          style: body.style,
          bpm: body.bpm,
          reference: body.reference,
          anchorPriority: body.anchorPriority,
          overwrite: body.overwrite === true,
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/template/part-targets") {
      const body = await readJsonBody(req);
      const referenceTrackIndex = Number(body.reference?.trackIndex || 1);
      const referenceSlotIndex = Number(body.reference?.slotIndex || 1);
      const payload = await enqueue(() =>
        collectTemplatePartTargets({
          referenceTrackIndex,
          referenceSlotIndex,
          overwrite: body.overwrite === true,
          onlyReferenceScene: body.onlyReferenceScene !== false,
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/template/generate-part") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();

      if (!body.target || typeof body.target !== "object") {
        sendJson(res, 400, { error: "target is required." });
        return;
      }

      const payload = await enqueue(() =>
        generateTemplatePartFromTarget({
          prompt,
          style: body.style,
          bpm: body.bpm,
          reference: body.reference,
          target: body.target,
          anchorPriority: body.anchorPriority,
        }),
      );
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/device-parameter") {
      const body = await readJsonBody(req);
      const trackIndex = Number(body.trackIndex || 0);
      const deviceIndex = Number(body.deviceIndex || 0);
      const parameterIndex = Number(body.parameterIndex || 0);
      const value = Number(body.value);

      if (
        !Number.isInteger(trackIndex) ||
        trackIndex <= 0 ||
        !Number.isInteger(deviceIndex) ||
        deviceIndex <= 0 ||
        !Number.isInteger(parameterIndex) ||
        parameterIndex <= 0 ||
        !Number.isFinite(value)
      ) {
        sendJson(res, 400, {
          error: "trackIndex, deviceIndex, parameterIndex, and numeric value are required.",
        });
        return;
      }

      const payload = await enqueue(() =>
        setDeviceParameterAndDashboard(trackIndex, deviceIndex, parameterIndex, value),
      );
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

    if (req.method === "POST" && url.pathname === "/api/llm/run-device") {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt || "").trim();
      const trackIndex = Number(body.trackIndex || 1);
      const deviceIndex = Number(body.deviceIndex || 0);

      if (!prompt) {
        sendJson(res, 400, { error: "Prompt is required." });
        return;
      }

      if (!Number.isInteger(deviceIndex) || deviceIndex <= 0) {
        sendJson(res, 400, { error: "deviceIndex is required." });
        return;
      }

      const payload = await enqueue(() =>
        runAndExecuteDeviceLlmCommand(prompt, trackIndex, deviceIndex),
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
