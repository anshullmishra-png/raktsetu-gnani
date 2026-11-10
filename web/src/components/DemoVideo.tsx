// The home page demo: one MP4 with the Gnani Timbre narration in its own
// audio track, so sound works with the player's normal controls.
export default function DemoVideo() {
  return (
    <>
      <div className="video-frame">
        <video controls preload="metadata" playsInline poster="/demo-poster.png">
          <source src="/demo.mp4" type="video/mp4" />
          Your browser cannot play this video. <a href="/demo.mp4">Download it</a> instead.
        </video>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Narrated by Gnani Timbre (text-to-speech). Turn your sound on. The bank's reply in the recording is a
        machine-voice test clip.
      </p>
    </>
  );
}
