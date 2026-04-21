import { Ableton } from "./index.js";

const withPrefix = (method) => (...args) => method("[ableton-cli]", ...args);

const verboseLogger = {
  log: withPrefix(console.log),
  info: withPrefix(console.info),
  warn: withPrefix(console.warn),
  debug: withPrefix(console.debug),
  error: withPrefix(console.error),
};

function printHelp() {
  console.log(`Usage:
  node ableton-cli.mjs status
  node ableton-cli.mjs play
  node ableton-cli.mjs stop
  node ableton-cli.mjs stop-clips
  node ableton-cli.mjs tempo
  node ableton-cli.mjs tempo 128
  node ableton-cli.mjs tap
  node ableton-cli.mjs tracks
  node ableton-cli.mjs devices "1-707 Core Kit"
  node ableton-cli.mjs drum-pads "1-707 Core Kit" "707 Core Kit"
  node ableton-cli.mjs params "1-707 Core Kit" "707 Core Kit"
  node ableton-cli.mjs param "1-707 Core Kit" "707 Core Kit" "Glue"
  node ableton-cli.mjs param "1-707 Core Kit" "707 Core Kit" "Glue" 50
  node ableton-cli.mjs clip-notes "1-707 Core Kit" 1
  node ableton-cli.mjs make-drum "1-707 Core Kit" 1
  node ableton-cli.mjs scenes
  node ableton-cli.mjs scene 2

Commands:
  status       Show playback status, tempo, and project counts
  play         Start playback safely
  stop         Stop playback safely
  stop-clips   Stop all playing clips
  tempo        Show the current tempo, or set it when given a number
  tap          Send one tap-tempo trigger
  tracks       List tracks and a few key states
  devices      List devices on a track
  drum-pads    List named drum pads and MIDI notes on a drum rack
  params       List parameters on a device
  param        Read or set a device parameter by name or number
  clip-notes   List MIDI notes in a clip slot
  make-drum    Create a starter 1-bar drum groove in an empty clip slot
  scenes       List scenes
  scene N      Launch scene N (zero-based index)

Examples:
  npm run ableton:cli -- status
  npm run ableton:cli -- tempo 124
  npm run ableton:cli -- devices "1-707 Core Kit"
  npm run ableton:cli -- drum-pads "1-707 Core Kit" "707 Core Kit"
  npm run ableton:cli -- param "1-707 Core Kit" "707 Core Kit" "Glue" 35
  npm run ableton:cli -- make-drum "1-707 Core Kit" 1
  npm run ableton:cli -- scene 0`);
}

function formatBool(value) {
  return value ? "yes" : "no";
}

function formatIndex(value) {
  return value >= 0 ? String(value) : "-";
}

function normalizeName(value) {
  return String(value).trim().toLowerCase();
}

function parseSceneIndex(rawValue) {
  const index = Number(rawValue);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Scene index must be a non-negative integer.");
  }
  return index;
}

function parsePositiveIndex(rawValue, label) {
  const index = Number(rawValue);
  if (!Number.isInteger(index) || index <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return index;
}

async function getTracks(ableton) {
  return ableton.song.get("tracks");
}

async function resolveTrack(ableton, rawSpecifier) {
  if (!rawSpecifier) {
    throw new Error("Track is required.");
  }

  const tracks = await getTracks(ableton);
  const numeric = Number(rawSpecifier);
  if (Number.isInteger(numeric)) {
    const track = tracks[numeric - 1];
    if (!track) {
      throw new Error(`Track ${numeric} does not exist. Found ${tracks.length} tracks.`);
    }
    return { track, displayIndex: numeric };
  }

  const targetName = normalizeName(rawSpecifier);
  const index = tracks.findIndex((track) => normalizeName(track.raw.name) === targetName);
  if (index === -1) {
    throw new Error(`Track "${rawSpecifier}" was not found.`);
  }

  return { track: tracks[index], displayIndex: index + 1 };
}

async function resolveDevice(track, rawSpecifier) {
  if (!rawSpecifier) {
    throw new Error("Device is required.");
  }

  const devices = await track.get("devices");
  const numeric = Number(rawSpecifier);
  if (Number.isInteger(numeric)) {
    const device = devices[numeric - 1];
    if (!device) {
      throw new Error(
        `Device ${numeric} does not exist on track "${track.raw.name}". Found ${devices.length} devices.`,
      );
    }
    return { device, displayIndex: numeric };
  }

  const targetName = normalizeName(rawSpecifier);
  const index = devices.findIndex(
    (device) =>
      normalizeName(device.raw.name) === targetName ||
      normalizeName(device.raw.class_name) === targetName,
  );
  if (index === -1) {
    throw new Error(`Device "${rawSpecifier}" was not found on track "${track.raw.name}".`);
  }

  return { device: devices[index], displayIndex: index + 1 };
}

async function resolveParameter(device, rawSpecifier) {
  if (!rawSpecifier) {
    throw new Error("Parameter is required.");
  }

  const parameters = await device.get("parameters");
  const numeric = Number(rawSpecifier);
  if (Number.isInteger(numeric)) {
    const parameter = parameters[numeric - 1];
    if (!parameter) {
      throw new Error(
        `Parameter ${numeric} does not exist on device "${device.raw.name}". Found ${parameters.length} parameters.`,
      );
    }
    return { parameter, displayIndex: numeric };
  }

  const targetName = normalizeName(rawSpecifier);
  const index = parameters.findIndex(
    (parameter) => normalizeName(parameter.raw.name) === targetName,
  );
  if (index === -1) {
    throw new Error(`Parameter "${rawSpecifier}" was not found on device "${device.raw.name}".`);
  }

  return { parameter: parameters[index], displayIndex: index + 1 };
}

async function resolveClipSlot(track, rawSpecifier) {
  const slotIndex = parsePositiveIndex(rawSpecifier, "Clip slot");
  const slots = await track.get("clip_slots");
  const slot = slots[slotIndex - 1];
  if (!slot) {
    throw new Error(
      `Clip slot ${slotIndex} does not exist on track "${track.raw.name}". Found ${slots.length} slots.`,
    );
  }

  return { slot, displayIndex: slotIndex };
}

function inferDrumRole(name) {
  const normalized = normalizeName(name);

  if (/kick|bd|bass drum/.test(normalized)) return "kick";
  if (/snare|sd/.test(normalized)) return "snare";
  if (/clap/.test(normalized)) return "clap";
  if (/closed|chh|closed hh|closed hat/.test(normalized)) return "closedHat";
  if (/open|ohh|open hh|open hat/.test(normalized)) return "openHat";
  if (/rim/.test(normalized)) return "rim";
  if (/shaker/.test(normalized)) return "shaker";
  if (/tom/.test(normalized)) return "tom";
  if (/crash/.test(normalized)) return "crash";
  if (/ride/.test(normalized)) return "ride";

  return null;
}

async function getDrumPads(ableton, trackSpecifier, deviceSpecifier) {
  const { track, displayIndex: trackIndex } = await resolveTrack(ableton, trackSpecifier);
  const { device, displayIndex: deviceIndex } = await resolveDevice(track, deviceSpecifier);
  const pads = await ableton.getProp("device", device.raw.id, "drum_pads", false);
  const normalizedPads = pads
    .filter((pad) => pad && (pad.chain_count > 0 || String(pad.name || "").trim()))
    .map((pad) => ({
      ...pad,
      role: inferDrumRole(pad.name),
    }));

  return { track, trackIndex, device, deviceIndex, pads: normalizedPads };
}

function makeNote(pitch, time, duration, velocity) {
  return { pitch, time, duration, velocity, muted: false };
}

function choosePadByRole(pads, role, fallbackNote, fallbackName) {
  const match = pads.find((pad) => pad.role === role);
  if (match) return match;
  return { note: fallbackNote, name: fallbackName, fallback: true };
}

function buildStarterDrumPattern(pads) {
  const kick = choosePadByRole(pads, "kick", 36, "Kick");
  const snare = choosePadByRole(pads, "snare", 38, "Snare");
  const clap = choosePadByRole(pads, "clap", 39, "Clap");
  const closedHat = choosePadByRole(pads, "closedHat", 42, "Closed Hat");
  const openHat = choosePadByRole(pads, "openHat", 46, "Open Hat");
  const rim = choosePadByRole(pads, "rim", 37, "Rim");

  const notes = [];

  for (const time of [0, 1, 2, 3]) {
    notes.push(makeNote(kick.note, time, 0.2, time === 0 ? 118 : 108));
  }

  for (const time of [1, 3]) {
    notes.push(makeNote(snare.note, time, 0.2, 112));
  }

  if (clap.note !== snare.note) {
    for (const time of [1, 3]) {
      notes.push(makeNote(clap.note, time, 0.15, 84));
    }
  }

  for (const [index, time] of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].entries()) {
    notes.push(makeNote(closedHat.note, time, 0.1, index % 2 === 0 ? 72 : 62));
  }

  notes.push(makeNote(openHat.note, 1.5, 0.18, 82));
  notes.push(makeNote(openHat.note, 3.5, 0.18, 88));
  notes.push(makeNote(rim.note, 2.75, 0.1, 68));

  return {
    notes,
    parts: { kick, snare, clap, closedHat, openHat, rim },
  };
}

async function printStatus(ableton) {
  const [isPlaying, tempo, currentSongTime, tracks, scenes] = await Promise.all([
    ableton.song.get("is_playing"),
    ableton.song.get("tempo"),
    ableton.song.get("current_song_time"),
    ableton.song.get("tracks"),
    ableton.song.get("scenes"),
  ]);

  console.log(`Playing: ${formatBool(isPlaying)}`);
  console.log(`Tempo: ${tempo}`);
  console.log(`Song Time: ${currentSongTime}`);
  console.log(`Tracks: ${tracks.length}`);
  console.log(`Scenes: ${scenes.length}`);
}

async function printTracks(ableton) {
  const tracks = await ableton.song.get("tracks");
  const rows = await Promise.all(
    tracks.map(async (track, index) => {
      const [mute, solo, playingSlotIndex, canBeArmed, arm] = await Promise.all([
        track.get("mute"),
        track.get("solo"),
        track.get("playing_slot_index"),
        track.get("can_be_armed"),
        track.get("arm").catch(() => false),
      ]);

      return {
        index,
        name: track.raw.name || `Track ${index}`,
        mute,
        solo,
        arm: canBeArmed ? arm : null,
        playingSlotIndex,
      };
    }),
  );

  for (const row of rows) {
    const parts = [
      `${row.index + 1}. ${row.name}`,
      `playing_slot=${formatIndex(row.playingSlotIndex)}`,
      `mute=${formatBool(row.mute)}`,
      `solo=${formatBool(row.solo)}`,
    ];

    if (row.arm !== null) {
      parts.push(`arm=${formatBool(row.arm)}`);
    }

    console.log(parts.join(" | "));
  }
}

async function printDevices(ableton, rawTrackSpecifier) {
  const { track, displayIndex } = await resolveTrack(ableton, rawTrackSpecifier);
  const devices = await track.get("devices");

  console.log(`Track ${displayIndex}: ${track.raw.name}`);
  for (const [index, device] of devices.entries()) {
    console.log(
      `${index + 1}. ${device.raw.name} | class=${device.raw.class_name} | type=${device.raw.type}`,
    );
  }
}

async function printParameters(ableton, rawTrackSpecifier, rawDeviceSpecifier) {
  const { track, displayIndex: trackIndex } = await resolveTrack(ableton, rawTrackSpecifier);
  const { device, displayIndex: deviceIndex } = await resolveDevice(track, rawDeviceSpecifier);
  const parameters = await device.get("parameters");

  console.log(`Track ${trackIndex}: ${track.raw.name}`);
  console.log(`Device ${deviceIndex}: ${device.raw.name}`);

  const rows = await Promise.all(
    parameters.map(async (parameter, index) => {
      const [min, max] = await Promise.all([parameter.get("min"), parameter.get("max")]);
      return {
        index: index + 1,
        name: parameter.raw.name,
        value: parameter.raw.value,
        min,
        max,
        isQuantized: parameter.raw.is_quantized,
      };
    }),
  );

  for (const row of rows) {
    console.log(
      `${row.index}. ${row.name} | value=${row.value} | min=${row.min} | max=${row.max} | quantized=${formatBool(row.isQuantized)}`,
    );
  }
}

async function printOrSetParameter(
  ableton,
  rawTrackSpecifier,
  rawDeviceSpecifier,
  rawParameterSpecifier,
  rawValue,
) {
  const { track } = await resolveTrack(ableton, rawTrackSpecifier);
  const { device } = await resolveDevice(track, rawDeviceSpecifier);
  const { parameter, displayIndex } = await resolveParameter(device, rawParameterSpecifier);

  if (rawValue === undefined) {
    const [value, min, max] = await Promise.all([
      parameter.get("value"),
      parameter.get("min"),
      parameter.get("max"),
    ]);
    console.log(
      `${displayIndex}. ${parameter.raw.name} | value=${value} | min=${min} | max=${max}`,
    );
    return;
  }

  const nextValue = Number(rawValue);
  if (!Number.isFinite(nextValue)) {
    throw new Error("Parameter value must be a valid number.");
  }

  await parameter.set("value", nextValue);
  const value = await parameter.get("value");
  console.log(`${parameter.raw.name} set to ${value}.`);
}

async function printScenes(ableton) {
  const scenes = await ableton.song.get("scenes");
  const rows = await Promise.all(
    scenes.map(async (scene, index) => {
      const isEmpty = await scene.get("is_empty");
      return {
        index,
        name: scene.raw.name || `Scene ${index}`,
        isEmpty,
      };
    }),
  );

  for (const row of rows) {
    console.log(`${row.index}. ${row.name} | empty=${formatBool(row.isEmpty)}`);
  }
}

async function printDrumPads(ableton, rawTrackSpecifier, rawDeviceSpecifier) {
  const { track, trackIndex, device, deviceIndex, pads } = await getDrumPads(
    ableton,
    rawTrackSpecifier,
    rawDeviceSpecifier,
  );

  console.log(`Track ${trackIndex}: ${track.raw.name}`);
  console.log(`Device ${deviceIndex}: ${device.raw.name}`);

  for (const [index, pad] of pads.entries()) {
    const role = pad.role ? ` | role=${pad.role}` : "";
    console.log(
      `${index + 1}. note=${pad.note} | name=${pad.name || "(unnamed)"} | chains=${pad.chain_count}${role}`,
    );
  }
}

async function printClipNotes(ableton, rawTrackSpecifier, rawSlotSpecifier) {
  const { track, displayIndex: trackIndex } = await resolveTrack(ableton, rawTrackSpecifier);
  const { slot, displayIndex: slotIndex } = await resolveClipSlot(track, rawSlotSpecifier);
  const hasClip = await slot.get("has_clip", false);

  if (!hasClip) {
    console.log(`Track ${trackIndex} slot ${slotIndex} is empty.`);
    return;
  }

  const clip = await slot.get("clip", false);
  const length = await clip.get("length");
  const notes = await clip.getNotes(0, 0, length, 128);

  console.log(`Track ${trackIndex}: ${track.raw.name}`);
  console.log(`Slot ${slotIndex}: ${clip.raw.name || "(unnamed clip)"}`);

  for (const note of notes) {
    console.log(
      `pitch=${note.pitch} | time=${note.time} | duration=${note.duration} | velocity=${note.velocity}`,
    );
  }
}

async function makeDrumClip(ableton, rawTrackSpecifier, rawSlotSpecifier) {
  const { track, displayIndex: trackIndex } = await resolveTrack(ableton, rawTrackSpecifier);
  const { slot, displayIndex: slotIndex } = await resolveClipSlot(track, rawSlotSpecifier);
  const hasClip = await slot.get("has_clip", false);

  if (hasClip) {
    throw new Error(`Track ${trackIndex} slot ${slotIndex} already has a clip. Pick an empty slot.`);
  }

  const devices = await track.get("devices");
  const drumDevice =
    devices.find((device) => device.raw.class_name === "DrumGroupDevice") ?? devices[0];

  if (!drumDevice) {
    throw new Error(`Track "${track.raw.name}" does not have any devices.`);
  }

  const { pads } = await getDrumPads(ableton, track.raw.name, drumDevice.raw.name);
  const { notes, parts } = buildStarterDrumPattern(pads);

  await slot.createClip(4);
  const clip = await slot.get("clip", false);
  await clip.set("name", "Starter Drum Groove");
  await clip.setNotes(notes);

  console.log(`Created Starter Drum Groove in track ${trackIndex} slot ${slotIndex}.`);
  console.log(
    `Using kick=${parts.kick.name}, snare=${parts.snare.name}, closedHat=${parts.closedHat.name}, openHat=${parts.openHat.name}.`,
  );
}

async function runCommand(ableton, command, args) {
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "status":
      await printStatus(ableton);
      return;
    case "play": {
      const changed = await ableton.song.safeStartPlaying();
      console.log(changed ? "Playback started." : "Playback was already running.");
      return;
    }
    case "stop": {
      const changed = await ableton.song.safeStopPlaying();
      console.log(changed ? "Playback stopped." : "Playback was already stopped.");
      return;
    }
    case "stop-clips":
      await ableton.song.stopAllClips();
      console.log("Stopped all clips.");
      return;
    case "tempo": {
      const value = args[0];
      if (value === undefined) {
        const tempo = await ableton.song.get("tempo");
        console.log(tempo);
        return;
      }

      const nextTempo = Number(value);
      if (!Number.isFinite(nextTempo)) {
        throw new Error("Tempo must be a valid number.");
      }

      await ableton.song.set("tempo", nextTempo);
      console.log(`Tempo set to ${nextTempo}.`);
      return;
    }
    case "tap":
      await ableton.song.tapTempo();
      console.log("Sent tap tempo.");
      return;
    case "tracks":
      await printTracks(ableton);
      return;
    case "devices":
      await printDevices(ableton, args[0]);
      return;
    case "drum-pads":
      await printDrumPads(ableton, args[0], args[1]);
      return;
    case "params":
      await printParameters(ableton, args[0], args[1]);
      return;
    case "param":
      await printOrSetParameter(ableton, args[0], args[1], args[2], args[3]);
      return;
    case "clip-notes":
      await printClipNotes(ableton, args[0], args[1]);
      return;
    case "make-drum":
      await makeDrumClip(ableton, args[0], args[1]);
      return;
    case "scenes":
      await printScenes(ableton);
      return;
    case "scene": {
      const index = parseSceneIndex(args[0]);
      const scenes = await ableton.song.get("scenes");
      const scene = scenes[index];

      if (!scene) {
        throw new Error(`Scene ${index} does not exist. Found ${scenes.length} scenes.`);
      }

      await scene.fire();
      console.log(`Fired scene ${index}: ${scene.raw.name || `Scene ${index}`}.`);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function main() {
  const [, , command, ...args] = process.argv;
  const ableton = new Ableton({
    logger: process.env.ABLETON_DEBUG ? verboseLogger : undefined,
  });

  try {
    if (!["help", "--help", "-h", undefined].includes(command)) {
      await ableton.start(5000);
    }

    await runCommand(ableton, command, args);
  } finally {
    if (ableton.isConnected()) {
      await ableton.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
