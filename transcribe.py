"""Local CPU transcription. No OpenAI API, credentials, or remote audio upload."""
import argparse
import json
import os
from pathlib import Path
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument('--audio')
parser.add_argument('--output')
parser.add_argument('--model', default='base')
parser.add_argument('--prepare', action='store_true')
args = parser.parse_args()
if args.model not in ('tiny', 'base', 'small', 'medium'):
    parser.error('Use a multilingual model: tiny, base, small, or medium.')
model = WhisperModel(args.model, device='cpu', compute_type='int8',
                     cpu_threads=max(1, min(8, os.cpu_count() or 4)))
if args.prepare:
    print('Local Whisper model ready: ' + args.model)
else:
    if not args.audio or not args.output:
        parser.error('--audio and --output are required')
    segments, info = model.transcribe(args.audio, beam_size=5, word_timestamps=True,
                                      vad_filter=True, condition_on_previous_text=False)
    text, words = [], []
    for segment in segments:
        text.append(segment.text.strip())
        words.extend({'word': w.word.strip(), 'start': w.start, 'end': w.end}
                     for w in (segment.words or []))
    Path(args.output).write_text(json.dumps({'text': ' '.join(text), 'words': words,
                                           'language': info.language}, ensure_ascii=False), encoding='utf-8')
