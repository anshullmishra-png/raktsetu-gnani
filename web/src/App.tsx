import { Link, NavLink, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Hospital from "./pages/Hospital";
import Donor from "./pages/Donor";
import Admin from "./pages/Admin";

export default function App() {
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
        </nav>
      </header>
      <main className="page">
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
    </>
  );
}
