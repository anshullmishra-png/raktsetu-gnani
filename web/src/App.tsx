import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import Landing from "./pages/Landing";
import Hospital from "./pages/Hospital";
import Donor from "./pages/Donor";
import Admin from "./pages/Admin";

export default function App() {
  const path = useLocation().pathname;
  const wide = path === "/";

  // Pointer glow, scroll progress and the ripple origin on buttons.
  useEffect(() => {
    const root = document.documentElement;
    const move = (e: PointerEvent) => {
      root.style.setProperty("--mx", e.clientX + "px");
      root.style.setProperty("--my", e.clientY + "px");
      const t = e.target as HTMLElement | null;
      const b = t && t.closest ? (t.closest(".btn") as HTMLElement | null) : null;
      if (b) {
        const r = b.getBoundingClientRect();
        b.style.setProperty("--rx", ((e.clientX - r.left) / r.width) * 100 + "%");
        b.style.setProperty("--ry", ((e.clientY - r.top) / r.height) * 100 + "%");
      }
    };
    const scroll = () => {
      const max = root.scrollHeight - window.innerHeight;
      root.style.setProperty("--scroll", String(max > 0 ? window.scrollY / max : 0));
      // Safety net for the scroll reveal: nothing on screen may stay hidden.
      document.querySelectorAll(".reveal:not(.in)").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in");
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true });
    scroll();
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", scroll);
    };
  }, []);

  // Reveal sections as they scroll into view.
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            obs.unobserve(en.target);
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [path]);
  return (
    <>
      <div className="scroll-bar" aria-hidden="true" />
      <div className="cursor-glow" aria-hidden="true" />
      <div className="demo-banner" role="note">
        Demo — all data is synthetic. No real calls are placed.
      </div>
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-drop" aria-hidden="true" />
          RaktSetu
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/hospital">Hospital</NavLink>
          <NavLink to="/donate">Donor</NavLink>
          <NavLink to="/admin">Admin</NavLink>
          <Link to="/hospital" className="nav-cta">
            Find blood
          </Link>
        </nav>
      </header>
      <main className={wide ? "page page-wide" : "page"}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/hospital" element={<Hospital />} />
          <Route path="/donate" element={<Donor />} />
          <Route path="/admin" element={<Admin />} />
          <Route
            path="*"
            element={
              <div className="card">
                <h1>We could not find that page</h1>
                <p>
                  <Link to="/">Go back to the start</Link>
                </p>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <Link to="/" className="brand">
          <span className="brand-drop" aria-hidden="true" />
          RaktSetu
        </Link>
        <span>Demo for the Gnani.ai challenge 2026. All data is synthetic.</span>
        <span className="links">
          <Link to="/hospital">Hospital</Link>
          <Link to="/donate">Donor</Link>
          <Link to="/admin">Admin</Link>
        </span>
      </footer>
    </>
  );
}
