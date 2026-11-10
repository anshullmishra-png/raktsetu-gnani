import { useEffect, useRef, useState } from "react";
import NARRATION from "../narration.json";

// The screen recording has no audio track. The narration is fifteen short
// Gnani Timbre clips, each tied to the moment its caption appears, and played
// in step with the video (including pause and seek).
type Cue = { t: number; src: string; dur: number };
const CUES = NARRATION as Cue[];

export default function DemoVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const current = useRef(-1);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const v = video.current;
    const a = audio.current;
    if (!v || !a) return;

    const sync = (force: boolean) => {
      const t = v.currentTime;
      let i = -1;
      for (let k = 0; k < CUES.length; k++) if (CUES[k].t <= t) i = k;
      if (i < 0 || t - CUES[i].t >= CUES[i].dur) {
        // between lines
        if (!a.paused) a.pause();
        current.current = i < 0 ? -1 : -2 - i; // remember we are past cue i
        return;
      }
      const offset = t - CUES[i].t;
      if (force || current.current !== i) {
        current.current = i;
        if (!a.src.endsWith(CUES[i].src)) a.src = CUES[i].src;
        try {
          a.currentTime = offset;
        } catch {
          /* metadata not loaded yet; it starts from zero */
        }
        if (!v.paused) void a.play().catch(() => {});
      }
    };

    const onTime = () => sync(false);
    const onSeek = () => sync(true);
    const onPlay = () => sync(true);
    const stop = () => a.pause();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onSeek);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", stop);
    v.addEventListener("ended", stop);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onSeek);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", stop);
      v.removeEventListener("ended", stop);
      a.pause();
    };
  }, []);

  useEffect(() => {
    if (audio.current) audio.current.muted = !sound;
  }, [sound]);

  return (
    <>
      <div className="video-frame">
        <video ref={video} controls preload="metadata" playsInline poster="/demo-poster.png">
          <source src="/demo.webm" type="video/webm" />
          Your browser cannot play this video. <a href="/demo.webm">Download it</a> instead.
        </video>
        <audio ref={audio} preload="auto" />
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" aria-pressed={sound} onClick={() => setSound((s) => !s)}>
          {sound ? "Narration on" : "Narration off"}
        </button>
        <span className="muted small">
          Narrated by Gnani Timbre (text-to-speech). The bank's reply in the recording is a machine-voice test clip.
        </span>
      </div>
    </>
  );
}
