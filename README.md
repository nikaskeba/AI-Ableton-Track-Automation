# AI Ableton Track Automation

AI Ableton Track Automation is a local control surface, API, CLI, and React app
for driving Ableton Live with structured commands and LLM-assisted MIDI
generation.

It is built on top of [ableton-js](https://github.com/leolabs/ableton-js), with
additional tooling for:

- selecting tracks and clip slots visually
- reading track, device, clip, and preset context from Live
- generating MIDI for drum racks and melodic instruments
- using one or more reference clips as creative context
- debugging raw LLM responses and parsed execution plans

## What It Does

- Connects to Ableton Live through an `AbletonJS` MIDI Remote Script
- Exposes a local Node API for dashboard state and AI-assisted clip creation
- Provides a React frontend for track browsing, slot targeting, and prompt-based
  generation
- Includes a CLI for transport, tempo, track, scene, device, parameter, and
  clip inspection

## Current Features

- Track list with active instrument labeling
- Plugin preset discovery for supported VST devices like Serum
- Clip-slot selection and highlighting
- Multi-reference clip context for generation
- Automatic LLM plan parsing and execution into a selected slot
- Persistent raw LLM response panel for debugging
- More tolerant JSON parsing for model output with comments or loose formatting

## Project Structure

- `web/`: React frontend
- `web-api.mjs`: local API server for Live state and LLM execution
- `ableton-cli.mjs`: command-line utility for common Ableton actions
- `midi-script/`: Ableton MIDI Remote Script installed as `AbletonJS`
- `example-control.mjs`: minimal connection / control example

## Requirements

- Ableton Live with the `AbletonJS` control surface enabled
- Node.js
- A local `.env` file with your LLM endpoint configuration

## Install And Run

Install dependencies:

```bash
yarn install
```

Start the API:

```bash
npm run api:dev
```

Start the frontend:

```bash
npm run web:dev
```

Then open:

```text
http://127.0.0.1:5173
```

## Ableton Setup

Copy `midi-script/` into your Ableton User Library Remote Scripts folder and
rename it to `AbletonJS`.

Typical macOS path:

```text
~/Music/Ableton/User Library/Remote Scripts/AbletonJS
```

Then in Ableton Live:

1. Open Preferences
2. Go to Link, Tempo & MIDI
3. Choose `AbletonJS` as a Control Surface

If Live does not see the script immediately, restart Live or toggle the control
surface off and back on.

## Environment

Create a `.env` file like:

```bash
ABLETON_LLM_BASE_URL="https://your-endpoint/v1/chat/completions"
ABLETON_LLM_MODEL="your-model"
ABLETON_LLM_API_KEY="your-token"
ABLETON_WEB_API_PORT=3030
```

See `.env.example` for the current shape.

## CLI Examples

```bash
npm run ableton:cli -- status
npm run ableton:cli -- tempo
npm run ableton:cli -- tempo 128
npm run ableton:cli -- tracks
npm run ableton:cli -- devices "1-707 Core Kit"
npm run ableton:cli -- params "1-707 Core Kit" "707 Core Kit"
npm run ableton:cli -- clip-notes "1-707 Core Kit" 1
npm run ableton:cli -- scenes
```

## AI Workflow

In the frontend you can:

1. Select a target track
2. Select a target clip slot
3. Optionally add one or more reference clips
4. Enter a prompt
5. Run AI generation into the selected slot

The app sends:

- selected track and device context
- plugin preset name when available
- clip slot context
- optional reference clip summaries and note events

The raw LLM response remains visible even when parsing or execution fails, which
helps debug prompt and plan issues quickly.

## Notes

- Drum-rack pad serialization is partially implemented, but some Live devices
  still expose limited structure depending on what Ableton returns.
- Plugin preset metadata is only available for device types that expose preset
  information through Live's object model.
- This project currently prioritizes local single-user workflow over packaging
  for npm distribution.

## Attribution

This project started from `ableton-js` and extends it with an app layer for
visual control, prompt-driven generation, and workflow-specific MIDI
automation.
