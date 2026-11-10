import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import Landing from "./pages/Landing";
import Hospital from "./pages/Hospital";
import Donor from "./pages/Donor";
import Admin from "./pages/Admin";

export default function App() {
  const wide = useLocation().pathname === "/";
  return (
    <>
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
