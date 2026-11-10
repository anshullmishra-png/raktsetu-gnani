import { useEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { Link } from "react-router-dom";
import Story from "./Story";
import DemoVideo from "../components/DemoVideo";
import "../story.css";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I = {
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  check: "M5 12l5 5 9-10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  drop: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
};

/** Counts up to a number once, when the page loads. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(to);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return (
    <>
      {n}
      {suffix}
    </>
  );
}

const TICKER: [string, string][] = [
  ["Prisma", "Gnani speech-to-text hears the bank"],
  ["Timbre", "Gnani text-to-speech speaks the disclosure"],
  ["55", "fictional blood banks across five districts"],
  ["7", "guardrails, each with an automated test"],
  ["0", "patient details collected"],
  ["30 min", "hold window, approved by a person"],
];

export default function Landing() {
  // The hero card plays the story in a loop: stale listing, the call, the next bank.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setStage((s) => (s + 1) % 3), 2200);
    return () => window.clearInterval(t);
  }, []);
  const card = useRef<HTMLDivElement>(null);
  const tilt = (e: RPointerEvent<HTMLDivElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ty", ((e.clientX - r.left) / r.width - 0.5) * 10 + "deg");
    el.style.setProperty("--tx", (0.5 - (e.clientY - r.top) / r.height) * 8 + "deg");
  };
  const untilt = () => {
    if (!card.current) return;
    card.current.style.setProperty("--tx", "0deg");
    card.current.style.setProperty("--ty", "0deg");
  };

  return (
    <>
      <section className="hero">
        <div className="hero-grid">
          <div>
            <span className="pill-tag fade-up">
              <Icon d={I.drop} /> For hospital blood requisition desks
            </span>
            <h1 className="fade-up d1">
              The portal says 4 units. <em>The shelf says zero.</em>
            </h1>
            <p className="lead fade-up d2">
              RaktSetu verifies blood bank stock before anyone travels. It checks every nearby listing at once,
              hears the bank's answer by voice, and lines up a hold for a person to approve.
            </p>
            <div className="hero-cta fade-up d3">
              <Link to="/hospital" className="btn btn-primary">
                Find blood
              </Link>
              <a href="#product" className="btn btn-secondary">
                See how it works
              </a>
            </div>
            <div className="stats-row fade-up d4">
              <div>
                <div className="stat-num"><CountUp to={55} /></div>
                <div className="stat-label">demo blood banks</div>
              </div>
              <div>
                <div className="stat-num"><CountUp to={80} suffix=" km" /></div>
                <div className="stat-label">search radius</div>
              </div>
              <div>
                <div className="stat-num"><CountUp to={30} suffix=" min" /></div>
                <div className="stat-label">hold window</div>
              </div>
            </div>
          </div>

          <div className="hero-card fade-up d2" aria-label="Example of a stale listing" ref={card} onPointerMove={tilt} onPointerLeave={untilt}>
            <span className="pill-tag">
              <Icon d={I.clock} /> What the portal shows
            </span>
            <div className={`listing s0 ${stage === 0 ? "on" : ""}`} style={{ marginTop: 12 }}>
              <div className="row">
                <b>Karuna Blood Centre, Jayanagar</b>
                <span>O−</span>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <span>
                  <span className="dot y" />
                  Listed: 4 units · updated 31 hours ago
                </span>
              </div>
            </div>
            <div className={`listing s1 ${stage === 1 ? "on" : ""}`}>
              <div className="row">
                <span>
                  <span className="dot r" />
                  Heard on the call: "we ran out yesterday"
                  {stage === 1 && (
                    <span className="wave" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className={`listing s2 ${stage === 2 ? "on" : ""}`} style={{ marginBottom: 0 }}>
              <div className="row">
                <span>
                  <span className="dot g" />
                  Next bank, 2.4 km: 2 units confirmed, hold proposed
                </span>
              </div>
            </div>
            <div className="benefits">
              <div className="benefit">
                <Icon d={I.mic} /> Heard by Gnani Prisma, spoken by Gnani Timbre
              </div>
              <div className="benefit">
                <Icon d={I.user} /> A person approves every hold
              </div>
              <div className="benefit">
                <Icon d={I.shield} /> No patient details, ever
              </div>
              <div className="benefit">
                <Icon d={I.check} /> Compatibility decided in code
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="tiles">
        <Link to="/hospital" className="tile t1 fade-up d1">
          <span className="tico"><Icon d={I.search} /></span>
          <span>Find blood<small>Search 55 demo banks</small></span>
        </Link>
        <Link to="/hospital" className="tile t2 fade-up d2">
          <span className="tico"><Icon d={I.mic} /></span>
          <span>Hear the bank<small>Gnani Prisma + Timbre</small></span>
        </Link>
        <Link to="/donate" className="tile t3 fade-up d3">
          <span className="tico"><Icon d={I.drop} /></span>
          <span>Donate<small>See where blood is short</small></span>
        </Link>
        <Link to="/admin" className="tile t4 fade-up d4">
          <span className="tico"><Icon d={I.shield} /></span>
          <span>Oversee<small>Kill switch and audit log</small></span>
        </Link>
      </div>

      <section className="section demo-video" id="demo">
        <div className="section-inner">
          <span className="pill-tag">See it work</span>
          <h2>One request, start to finish, in under two minutes</h2>
          <p className="sub">
            A narrated screen recording of this live site: search, verify, approve a hold, hear the bank, and the hold
            being cancelled when the bank says no.
          </p>
          <DemoVideo />
        </div>
      </section>

      <Story />

      <section className="section alt">
        <div className="section-inner">
          <span className="pill-tag">
            <Icon d={I.shield} /> Guardrails
          </span>
          <h2>What the system will not do</h2>
          <p className="sub">Each rule is enforced in code or in the database, and has an automated test.</p>
          <div className="table-wrap trust reveal">
            <table>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>How RaktSetu enforces it</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Demo banks only", "The database only stores obviously fictional numbers and refuses a voice session with any non-demo bank."],
                  ["Disclosure and consent", "No consent tick, no session. No session, no transcription."],
                  ["No patient data", "A request has no patient field. Names and numbers heard in audio are redacted before storage."],
                  ["Human approval", "The model has no tool that places a hold. A hold needs an approved proposal."],
                  ["Kill switch", "One admin switch makes every acting function refuse."],
                  ["Injection refusal", "Audio is data, never instructions. Off-topic clips change nothing."],
                  ["Audit log", "Append-only. Even the database owner cannot edit or delete it."],
                ].map(([a, b]) => (
                  <tr key={a}>
                    <td>
                      <span className="dot g" />
                      <b>{a}</b>
                    </td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="cta-band">
        <h2>See a stale listing get caught</h2>
        <p>Run a request, watch the map light up, and hear the bank's answer.</p>
        <Link to="/hospital" className="btn btn-accent">
          Start a request
        </Link>
      </section>
    </>
  );
}
