#!/usr/bin/env bash
# Post-render QC (measures; flags review candidates). Usage: render_qc.sh <out.mp4> <render.log> <expected_seconds> [t1,t2,...]
# Checks: single video + single audio stream, duration, decoded frame count, renderer blank-frame suspects
# all "accepted as deterministic", black runs >= 0.1 s, silence > 2 s, loudness, and decodes frames at the given times.
set -euo pipefail
OUT="$1"; LOG="$2"; EXP="$3"; TS="${4:-}"
echo "== streams"; ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames:format=duration,size -of compact "$OUT"
echo "== decoded frames: $(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$OUT")  expected ~ $(python3 -c "print(round($EXP*30))") @30fps"
s=$(tr '\r' '\n' < "$LOG" | grep "suspect; re-capturing" | grep -o '"frame":[0-9]*' | sort -u || true)
a=$(tr '\r' '\n' < "$LOG" | grep "deterministic; accepted" | grep -o '"frame":[0-9]*' | sort -u || true)
echo "== blank suspects: $(echo "$s" | grep -c . || true)  accepted: $(echo "$a" | grep -c . || true)  UNRESOLVED: $(comm -23 <(echo "$s") <(echo "$a") | grep -c . || true)"
echo "== black runs >=0.1s: $(ffmpeg -nostats -i "$OUT" -vf 'blackdetect=d=0.1:pix_th=0.10' -an -f null - 2>&1 | grep -c black_start || true)"
echo "== silence >2s: $(ffmpeg -nostats -i "$OUT" -vn -af silencedetect=noise=-50dB:d=2 -f null - 2>&1 | grep -c silence_start || true)"
echo "== loudness"; ffmpeg -nostats -i "$OUT" -vn -af ebur128=peak=true -f null - 2>&1 | grep -A20 Summary | grep -E "I:|LRA:|Peak:" || true
if [ -n "$TS" ]; then D=$(mktemp -d); IFS=',' read -ra T <<< "$TS"; for t in "${T[@]}"; do ffmpeg -v error -y -ss "$t" -i "$OUT" -frames:v 1 -vf scale=640:-1 "$D/at_$t.jpg"; done; echo "== frames in $D (look at them)"; fi
echo "== sha256 $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
