import { useState, useEffect } from "react";
import { DPASubmission } from "@/api/entities";

const STATUS_COLORS = {
  "Likely Eligible": { bg: "#dcfce7", text: "#166534", border: "#86efac", icon: "✅" },
  "Possible Fit - Needs Loan Officer Review": { bg: "#fff7ed", text: "#9a3412", border: "#fed7aa", icon: "🔍" },
  "Not Eligible Based on Initial Answers": { bg: "#fef2f2", text: "#991b1b", border: "#fca5a5", icon: "❌" },
  "Currently Unavailable": { bg: "#f3f4f6", text: "#374151", border: "#d1d5db", icon: "⏸️" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_COLORS[status] || STATUS_COLORS["Currently Unavailable"];
  return (
    <span style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {cfg.icon} {status}
    </span>
  );
}

function Modal({ submission, onClose }) {
  if (!submission) return null;
  let programs = [];
  try { programs = JSON.parse(submission.matched_programs || "[]"); } catch {}

  const fields = [
    ["Phone", submission.phone_number],
    ["Email", submission.email_address],
    ["State", submission.state],
    ["County / Parish", submission.county_or_parish],
    ["City", submission.city],
    ["Occupancy", submission.occupancy],
    ["Owned Home Last 3 Yrs", submission.owned_home_last_3_years],
    ["Veteran / Military", submission.veteran_or_active_military],
    ["First-Gen Buyer", submission.first_generation_homebuyer],
    ["CA Resident", submission.current_california_resident],
    ["Household Size", submission.household_size],
    ["Annual HH Income", submission.annual_household_income ? `$${Number(submission.annual_household_income).toLocaleString()}` : null],
    ["Qualifying Income", submission.borrower_qualifying_income ? `$${Number(submission.borrower_qualifying_income).toLocaleString()}` : null],
    ["Credit Score Range", submission.estimated_middle_credit_score],
    ["Est. DTI", submission.estimated_dti],
    ["Liquid Assets After Closing", submission.liquid_assets_after_closing ? `$${Number(submission.liquid_assets_after_closing).toLocaleString()}` : null],
    ["Purchase Price", submission.purchase_price ? `$${Number(submission.purchase_price).toLocaleString()}` : null],
    ["Loan Type", submission.loan_type],
    ["Property Type", submission.property_type],
    ["Flood Zone", submission.flood_zone],
    ["Homebuyer Education", submission.will_complete_homebuyer_education],
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div style={{ background: "white", borderRadius: 12, width: "100%", maxWidth: 680, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ background: "linear-gradient(135deg,#1e3a5f,#2563eb)", color: "white", padding: "20px 24px", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>🏠 {submission.full_name || "Borrower Record"}</h2>
            <p style={{ margin: "4px 0 0", opacity: 0.8, fontSize: 13 }}>{new Date(submission.created_date).toLocaleString("en-US", { timeZone: "America/Phoenix" })}</p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "white", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Overall Status */}
          <div style={{ marginBottom: 20, padding: 14, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
            <strong style={{ color: "#1e3a5f" }}>Overall Result:</strong>
            <StatusBadge status={submission.overall_result_status} />
          </div>

          {/* Programs */}
          {programs.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#1e3a5f" }}>Program Results</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {programs.map((p, i) => {
                  const cfg = STATUS_COLORS[p.status] || STATUS_COLORS["Currently Unavailable"];
                  return (
                    <div key={i} style={{ borderRadius: 8, border: `1px solid ${cfg.border}`, overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: cfg.bg }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#1e3a5f" }}>{p.name}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      {p.explanation && (
                        <div style={{ padding: "9px 14px", background: "white", fontSize: 13, color: "#374151", lineHeight: 1.5, borderTop: `1px solid ${cfg.border}` }}>
                          {cfg.icon} {p.explanation}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fields */}
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#1e3a5f" }}>Borrower Details</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {fields.filter(([, v]) => v).map(([k, v], i) => (
                <tr key={k} style={{ background: i % 2 === 0 ? "#f8fafc" : "white" }}>
                  <td style={{ padding: "7px 12px", fontWeight: 600, fontSize: 13, color: "#374151", width: "45%" }}>{k}</td>
                  <td style={{ padding: "7px 12px", fontSize: 13 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function DPADashboard() {
  const [submissions, setSubmissions] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    DPASubmission.list({ sort: "-created_date", limit: 200 }).then(data => {
      setSubmissions(data);
      setFiltered(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    let result = submissions;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        (s.full_name || "").toLowerCase().includes(q) ||
        (s.phone_number || "").includes(q) ||
        (s.email_address || "").toLowerCase().includes(q) ||
        (s.state || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "All") {
      result = result.filter(s => s.overall_result_status === statusFilter);
    }
    setFiltered(result);
  }, [search, statusFilter, submissions]);

  const counts = {
    total: submissions.length,
    likely: submissions.filter(s => s.overall_result_status === "Likely Eligible").length,
    review: submissions.filter(s => s.overall_result_status === "Possible Fit - Needs Loan Officer Review").length,
    notEligible: submissions.filter(s => s.overall_result_status === "Not Eligible Based on Initial Answers").length,
  };

  function exportCSV() {
    const headers = ["Name","Phone","Email","State","County","City","Credit Score","DTI","Income","Purchase Price","Loan Type","Overall Status","Date"];
    const rows = filtered.map(s => [
      s.full_name, s.phone_number, s.email_address, s.state, s.county_or_parish, s.city,
      s.estimated_middle_credit_score, s.estimated_dti,
      s.annual_household_income, s.purchase_price, s.loan_type,
      s.overall_result_status,
      new Date(s.created_date).toLocaleDateString()
    ].map(v => `"${(v||"").toString().replace(/"/g,'""')}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dpa_submissions_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f8", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1e3a5f,#2563eb)", color: "white", padding: "20px 28px" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>🏠 DPA Eligibility — Admin Dashboard</h1>
        <p style={{ margin: "4px 0 0", opacity: 0.8, fontSize: 13 }}>Brandyn Livingston · NEXA Lending · All DPA phone submissions</p>
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Total Submissions", value: counts.total, color: "#2563eb", bg: "#eff6ff" },
            { label: "Likely Eligible", value: counts.likely, color: "#16a34a", bg: "#dcfce7" },
            { label: "Needs Review", value: counts.review, color: "#d97706", bg: "#fff7ed" },
            { label: "Not Eligible", value: counts.notEligible, color: "#dc2626", bg: "#fef2f2" },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}30`, borderRadius: 10, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ background: "white", borderRadius: 10, padding: "16px 20px", marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, email, state..."
            style={{ flex: 1, minWidth: 200, padding: "9px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: "9px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, background: "white" }}
          >
            <option value="All">All Statuses</option>
            <option value="Likely Eligible">Likely Eligible</option>
            <option value="Possible Fit - Needs Loan Officer Review">Needs Review</option>
            <option value="Not Eligible Based on Initial Answers">Not Eligible</option>
          </select>
          <button onClick={exportCSV} style={{ padding: "9px 18px", background: "#1e3a5f", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            ⬇ Export CSV
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>Loading submissions...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#6b7280", background: "white", borderRadius: 10 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏠</div>
            <p style={{ fontSize: 18, fontWeight: 600 }}>No submissions yet</p>
            <p style={{ fontSize: 14 }}>DPA check results from phone calls will appear here automatically.</p>
          </div>
        ) : (
          <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#f0f4ff" }}>
                    {["Name","Phone","Email","State / County","Credit","Purchase Price","Overall Status","Date",""].map(h => (
                      <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#1e3a5f", fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr key={s.id} style={{ borderTop: "1px solid #f0f0f0", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                      <td style={{ padding: "11px 14px", fontWeight: 600 }}>{s.full_name || "—"}</td>
                      <td style={{ padding: "11px 14px", color: "#374151" }}>{s.phone_number || "—"}</td>
                      <td style={{ padding: "11px 14px", color: "#2563eb", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{s.email_address || "—"}</td>
                      <td style={{ padding: "11px 14px" }}>{s.state || "—"}{s.county_or_parish ? ` / ${s.county_or_parish}` : ""}</td>
                      <td style={{ padding: "11px 14px" }}>{s.estimated_middle_credit_score || "—"}</td>
                      <td style={{ padding: "11px 14px" }}>{s.purchase_price ? `$${Number(s.purchase_price).toLocaleString()}` : "—"}</td>
                      <td style={{ padding: "11px 14px" }}><StatusBadge status={s.overall_result_status} /></td>
                      <td style={{ padding: "11px 14px", color: "#6b7280", fontSize: 12, whiteSpace: "nowrap" }}>
                        {new Date(s.created_date).toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <button onClick={() => setSelected(s)} style={{ padding: "5px 12px", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 32 }}>
          This tool is for educational and preliminary screening purposes only. It is not a commitment to lend, not a loan approval, and not a guarantee of eligibility. All loan programs are subject to credit approval, underwriting, property review, and current program availability.
        </p>
      </div>

      {selected && <Modal submission={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
