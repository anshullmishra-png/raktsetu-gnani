import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <>
      <h1>RaktSetu</h1>
      <p className="lead">
        A bridge between hospitals, blood banks and donors. Tell us who you are and we will take you to the right
        place. No login needed.
      </p>
      <div className="role-grid">
        <Link to="/hospital" className="role-card">
          <h2>Hospital</h2>
          <p>Find blood for a request, hear back from blood banks, and approve a hold.</p>
          <span className="go">I need blood →</span>
        </Link>
        <Link to="/donate" className="role-card">
          <h2>Donor</h2>
          <p>Register as a donor and see where blood is needed near you.</p>
          <span className="go">I want to donate →</span>
        </Link>
        <Link to="/admin" className="role-card">
          <h2>Admin</h2>
          <p>Pause or resume calls, review the audit log, transcripts and pledges.</p>
          <span className="go">I look after the service →</span>
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        The assistant proposes. A person decides. We never ask for patient details.
      </p>
    </>
  );
}
