# iOS Shortcuts for Runnn

This guide explains how to set up iOS Shortcuts for logging run notes after workouts.

## Overview

Two shortcuts are available:

1. **Log Run (Voice)** - Record a voice memo that gets transcribed
2. **Quick Run Log** - Fill out a quick form

Both shortcuts save data to iCloud Drive, which `runnn sync` then processes.

## Prerequisites

1. iCloud Drive enabled
2. iOS Shortcuts app
3. (For voice notes) Whisper API key in your `.env` or use on-device transcription

## Directory Structure

Create these folders in iCloud Drive:

```
iCloud Drive/
└── Runnn/
    └── run-notes/
        ├── inbox/      # New notes appear here
        ├── audio/      # Raw audio files (voice notes)
        ├── processed/  # Notes being processed
        └── archive/    # Completed notes
```

## Shortcut 1: Log Run (Voice)

### What It Does

1. Records audio immediately when triggered
2. Saves audio to `iCloud/Runnn/run-notes/audio/`
3. Transcribes using Whisper API (or on-device)
4. Creates JSON file in `iCloud/Runnn/run-notes/inbox/`

### Setup Steps

1. **Create New Shortcut**
   - Open Shortcuts app
   - Tap "+" to create new shortcut
   - Name it "Log Run"

2. **Add Actions**

   ```
   1. Set Variable
      - Name: "noteId"
      - Value: Current Date (format: yyyyMMddHHmmss) + Random Number

   2. Record Audio
      - Audio Quality: Normal
      - Start Recording: Immediately
      - Finish Recording: On Tap

   3. Save File
      - Save: Recorded Audio
      - To: iCloud Drive/Runnn/run-notes/audio/
      - Filename: [noteId].m4a
      - Ask Where to Save: OFF

   4. Get Contents of URL (Whisper API)
      - URL: https://api.openai.com/v1/audio/transcriptions
      - Method: POST
      - Headers:
        - Authorization: Bearer [YOUR_API_KEY]
      - Request Body: Form
        - file: [Recorded Audio]
        - model: whisper-1

   5. Get Dictionary Value
      - Get: "text" from [API Response]

   6. Text
      - Create JSON:
      {
        "id": "[noteId]",
        "captured_at_local": "[Current Date ISO]",
        "timezone_offset_min": [Timezone Offset],
        "audio_path": "audio/[noteId].m4a",
        "transcription": "[Transcription]",
        "status": "pending"
      }

   7. Save File
      - Save: [JSON Text]
      - To: iCloud Drive/Runnn/run-notes/inbox/
      - Filename: [noteId].json
      - Ask Where to Save: OFF

   8. Show Notification
      - "Run note saved!"
   ```

3. **Configure Trigger**
   - Settings > Action Button > Shortcut > Log Run
   - Or add to Home Screen widget

### Alternative: On-Device Transcription

Replace the Whisper API call with:

```
1. Transcribe Audio
   - Audio: [Recorded Audio]
   - Language: English
```

This uses Apple's on-device speech recognition (privacy-first).

## Shortcut 2: Quick Run Log

### What It Does

Presents a quick form for when you don't want to talk:

1. How was it? (Great/Good/OK/Tough)
2. RPE (1-10)
3. Any notes?

### Setup Steps

1. **Create New Shortcut**
   - Open Shortcuts app
   - Name it "Quick Run"

2. **Add Actions**

   ```
   1. Set Variable
      - Name: "noteId"
      - Value: Current Date (format: yyyyMMddHHmmss)

   2. Choose from Menu
      - Prompt: "How was it?"
      - Options: Great, Good, OK, Tough, Hard
      - Save result to: "mood"

   3. Ask for Input
      - Prompt: "RPE (1-10)"
      - Input Type: Number
      - Default Answer: 6
      - Save result to: "rpe"

   4. Ask for Input
      - Prompt: "Quick notes?"
      - Input Type: Text
      - Default Answer: ""
      - Save result to: "notes"

   5. Text
      - Create text:
      "[mood] run. RPE [rpe]. [notes]"
      - Save to: "transcription"

   6. Text
      - Create JSON:
      {
        "id": "[noteId]",
        "captured_at_local": "[Current Date ISO]",
        "timezone_offset_min": [Timezone Offset],
        "transcription": "[transcription]",
        "status": "pending"
      }

   7. Save File
      - Save: [JSON Text]
      - To: iCloud Drive/Runnn/run-notes/inbox/
      - Filename: [noteId].json

   8. Show Notification
      - "Run logged!"
   ```

## JSON Format

Notes saved to inbox must follow this format:

```json
{
  "id": "20260109183045",
  "captured_at_local": "2026-01-09T18:30:45",
  "timezone_offset_min": -480,
  "audio_path": "audio/20260109183045.m4a",
  "transcription": "That was solid. Legs felt heavy first two miles but loosened up. Hit all my pace targets. Left calf a little tight. RPE 6.",
  "status": "pending"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier |
| captured_at_local | string | Yes | ISO timestamp in local time |
| timezone_offset_min | number | Yes | Minutes from UTC (e.g., -480 for PST) |
| audio_path | string | No | Path to audio file (voice notes only) |
| transcription | string | Yes | The note text |
| status | string | Yes | Must be "pending" for new notes |

## Processing Flow

1. Shortcut saves note to `inbox/`
2. `runnn sync --notes` finds notes in inbox
3. Note is matched to a workout by:
   - Same local date (strong signal)
   - Time proximity to run end (within 4 hours)
   - No existing notes on workout
4. Fields are extracted:
   - RPE (look for "RPE 6" or "6 out of 10")
   - Mood (great, good, ok, tough, etc.)
   - Discomfort (body part + pain keyword)
5. Workout is updated with note data
6. Note file moved to `archive/`

## Tips

### Voice Note Tips

- Speak naturally after your run
- Mention how you felt, any pain, effort level
- Examples:
  - "That was a solid tempo run. Hit my splits. RPE 7."
  - "Legs were heavy. Left calf tight after mile 3. RPE 8."
  - "Perfect easy run. Felt smooth the whole way. RPE 4."

### Keywords the System Recognizes

**RPE/Effort:**
- "RPE 6", "effort 7", "6 out of 10"

**Mood:**
- great, good, solid, okay, tired, exhausted, rough, tough, hard, easy, smooth

**Body Parts:**
- calf, shin, knee, hamstring, quad, hip, glute, ankle, achilles, foot, back

**Discomfort:**
- tight, sore, pain, ache, hurt, tender, twinge, niggle, stiff

## Troubleshooting

### Notes not syncing?

1. Check iCloud Drive sync is enabled
2. Verify folder structure exists
3. Run `runnn sync --notes --verbose`
4. Check for JSON format errors

### Transcription fails?

1. Verify API key in environment
2. Check audio file was saved
3. Try on-device transcription instead

### Note not matching to workout?

1. Ensure Garmin sync ran first (`runnn sync --garmin`)
2. Check workout exists for that date
3. Note may need manual linking:
   ```bash
   runnn sync --notes --verbose
   # Will show candidates for manual selection
   ```

## Privacy

- Raw audio files stay on your device/iCloud
- Transcription uses Whisper API by default (sent to OpenAI)
- Set `PRIVACY_MODE=strict` to use on-device transcription only
- See PRIVACY.md for full details
