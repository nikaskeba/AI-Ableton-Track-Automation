import { Ableton } from "./index.js";

const withPrefix = (method) => (...args) => method("[ableton-js]", ...args);

const logger = {
  log: withPrefix(console.log),
  info: withPrefix(console.info),
  warn: withPrefix(console.warn),
  debug: withPrefix(console.debug),
  error: withPrefix(console.error),
};

const ableton = new Ableton({ logger });

ableton.on("connect", () => logger.log("Connected to Ableton Live"));
ableton.on("disconnect", () => logger.log("Disconnected from Ableton Live"));
ableton.on("error", (error) => logger.error("Protocol error:", error));

async function main() {
  await ableton.start();

  const tempo = await ableton.song.get("tempo");
  logger.log("Current tempo:", tempo);

  const requestedTempo = process.env.ABLETON_SET_TEMPO;
  if (requestedTempo) {
    const nextTempo = Number(requestedTempo);
    if (!Number.isFinite(nextTempo)) {
      throw new Error("ABLETON_SET_TEMPO must be a valid number");
    }

    await ableton.song.set("tempo", nextTempo);
    logger.log("Updated tempo to:", nextTempo);
  } else {
    logger.log("Set ABLETON_SET_TEMPO=120 to change the tempo.");
  }

  setTimeout(() => process.exit(0), 500);
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
