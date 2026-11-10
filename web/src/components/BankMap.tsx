import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { BloodBank, Hospital } from "../types";
import { EVENT_LABEL } from "./CallLog";

export interface MapBank {
  bank: BloodBank;
  event: string;
  units?: number;
}

/** A bank the request will be filled from, in collection order. */
export interface RouteStop {
  bank: BloodBank;
  units: number;
  held: boolean;
}

type Kind = "found" | "calling" | "ok" | "no" | "voice";

function kindOf(event: string): Kind {
  if (event === "calling") return "calling";
  if (["confirmed", "partial", "proposed", "held"].includes(event)) return "ok";
  if (["declined", "refused", "no_answer", "cancelled"].includes(event)) return "no";
  if (event === "voice") return "voice";
  return "found";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo(points[0], 13, { duration: 0.8 });
    } else {
      map.flyToBounds(points as LatLngBoundsExpression, { padding: [50, 50], maxZoom: 13, duration: 0.8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

interface Props {
  hospital: Hospital | null;
  banks: MapBank[];
  route?: RouteStop[];
  /** True once the hospital has marked "replacement offered". */
  replacement?: boolean;
}

export default function BankMap({ hospital, banks, route = [], replacement = false }: Props) {
  const points: [number, number][] = [];
  if (hospital) points.push([hospital.lat, hospital.lng]);
  // Frame the banks still in play; dropped ones do not pull the view out.
  for (const b of banks) if (kindOf(b.event) !== "no") points.push([b.bank.lat, b.bank.lng]);
  const center: [number, number] = points[0] ?? [12.9716, 77.5946];

  const stopIndex = useMemo(() => new Map(route.map((s, i) => [s.bank.id, i])), [route]);

  const hospitalIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        iconSize: [0, 0],
        html: hospital
          ? `<div class="mk mk-hospital"><span class="ring"></span><span class="core"></span><span class="tag">${esc(hospital.name)}</span></div>`
          : "",
      }),
    [hospital],
  );

  const routeLine: [number, number][] = hospital
    ? [[hospital.lat, hospital.lng], ...route.map((s) => [s.bank.lat, s.bank.lng] as [number, number])]
    : [];

  return (
    <div>
      <div className="map-box map-big" aria-label="Map of the hospital and the blood banks contacted">
        <MapContainer center={center} zoom={11} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Fit points={points} />

          {/* call lines: hospital to every bank being called right now */}
          {hospital &&
            banks
              .filter((b) => kindOf(b.event) === "calling")
              .map((b) => (
                <Polyline
                  key={`call-${b.bank.id}`}
                  positions={[
                    [hospital.lat, hospital.lng],
                    [b.bank.lat, b.bank.lng],
                  ]}
                  pathOptions={{ color: "#d97706", weight: 2, opacity: 0.8, dashArray: "4 8", className: "call-line" }}
                />
              ))}

          {/* collection route: most units first */}
          {routeLine.length > 1 && (
            <Polyline
              key={`route-${route.map((s) => s.bank.id).join("-")}`}
              positions={routeLine}
              pathOptions={{ color: "#4a9d7e", weight: 5, opacity: 0.9, lineCap: "round", className: "route-line" }}
            />
          )}

          {/* replacement: a separate donor line from each bank on the route */}
          {replacement &&
            hospital &&
            route.map((s) => (
              <Polyline
                key={`don-${s.bank.id}`}
                positions={[
                  [s.bank.lat, s.bank.lng],
                  [s.bank.lat + 0.018, s.bank.lng + 0.022],
                ]}
                pathOptions={{ color: "#5b8fc4", weight: 3, opacity: 0.9, dashArray: "2 8", className: "call-line" }}
              />
            ))}

          {banks.map(({ bank, event, units }) => {
            const kind = kindOf(event);
            const idx = stopIndex.get(bank.id);
            const stop = idx !== undefined ? route[idx] : undefined;
            const label = stop
              ? `<span class="tag tag-ok"><b>${idx! + 1}</b> ${esc(bank.name.split(",")[0])} · ${stop.units} ${stop.units === 1 ? "unit" : "units"}${stop.held ? " held" : ""}</span>`
              : kind === "ok" && units
                ? `<span class="tag tag-ok">${units} ${units === 1 ? "unit" : "units"}</span>`
                : kind === "calling"
                  ? `<span class="tag tag-call">Calling…</span>`
                  : "";
            const donors = replacement && stop ? `<span class="tag tag-donor">Donors requested · donor line open</span>` : "";
            const icon = L.divIcon({
              className: "",
              iconSize: [0, 0],
              html: `<div class="mk mk-${stop ? "ok" : kind}${stop ? " mk-stop" : ""}"><span class="ring"></span><span class="core"></span>${donors}${label}</div>`,
            });
            return (
              <Marker
                key={`${bank.id}-${kind}-${idx ?? "x"}-${replacement && stop ? "r" : ""}`}
                position={[bank.lat, bank.lng]}
                icon={icon}
                zIndexOffset={stop ? 800 : kind === "ok" ? 500 : kind === "calling" ? 300 : 0}
              >
                <Popup>
                  <strong>{bank.name}</strong>
                  {bank.district ? ` · ${bank.district}` : ""}
                  <br />
                  {EVENT_LABEL[event] ?? event}
                  {bank.pickup_hours ? (
                    <>
                      <br />
                      Pickup: {bank.pickup_hours}
                    </>
                  ) : null}
                </Popup>
              </Marker>
            );
          })}

          {hospital && (
            <Marker position={[hospital.lat, hospital.lng]} icon={hospitalIcon} zIndexOffset={1000}>
              <Popup>
                <strong>{hospital.name}</strong>
                <br />
                Requesting hospital
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: "#dc2626" }} />
          Hospital
        </span>
        <span>
          <i style={{ background: "#5b8fc4" }} />
          Listed
        </span>
        <span>
          <i style={{ background: "#d97706" }} />
          Calling
        </span>
        <span>
          <i style={{ background: "#4a9d7e" }} />
          Has blood
        </span>
        <span>
          <i style={{ background: "#9ca3af" }} />
          No blood (dropped)
        </span>
        <span>
          <i style={{ background: "#4a9d7e", borderRadius: 2, width: 18, height: 4 }} />
          Collection route, most units first
        </span>
      </div>
    </div>
  );
}
