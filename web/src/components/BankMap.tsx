import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { BloodBank, Hospital } from "../types";
import { EVENT_LABEL } from "./CallLog";

const EVENT_COLOR: Record<string, string> = {
  found: "#2f5d7c",
  proposed: "#2f5d7c",
  calling: "#c98a00",
  partial: "#c98a00",
  confirmed: "#4a9d7e",
  held: "#2f472f",
  declined: "#9b2c1c",
  refused: "#9b2c1c",
  voice: "#6d3f73",
  no_answer: "#5f5a55",
  cancelled: "#5f5a55",
  system: "#5f5a55",
};

export interface MapBank {
  bank: BloodBank;
  event: string;
}

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 12);
    } else {
      map.fitBounds(points as LatLngBoundsExpression, { padding: [30, 30], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

interface Props {
  hospital: Hospital | null;
  banks: MapBank[];
}

export default function BankMap({ hospital, banks }: Props) {
  const points: [number, number][] = [];
  if (hospital) points.push([hospital.lat, hospital.lng]);
  for (const b of banks) points.push([b.bank.lat, b.bank.lng]);
  const center: [number, number] = points[0] ?? [12.9716, 77.5946];

  return (
    <div>
      <div className="map-box" aria-label="Map of the hospital and the blood banks contacted">
        <MapContainer center={center} zoom={11} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Fit points={points} />
          {hospital && (
            <CircleMarker
              center={[hospital.lat, hospital.lng]}
              radius={11}
              pathOptions={{ color: "#2c3e50", weight: 3, fillColor: "#dc2626", fillOpacity: 1 }}
            >
              <Popup>
                <strong>{hospital.name}</strong>
                <br />
                Requesting hospital
              </Popup>
            </CircleMarker>
          )}
          {banks.map(({ bank, event }) => (
            <CircleMarker
              key={bank.id}
              center={[bank.lat, bank.lng]}
              radius={9}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: EVENT_COLOR[event] ?? "#5f5a55",
                fillOpacity: 0.95,
              }}
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
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: "#dc2626" }} />
          Hospital
        </span>
        <span>
          <i style={{ background: "#2f5d7c" }} />
          Found / proposed
        </span>
        <span>
          <i style={{ background: "#c98a00" }} />
          Calling / partial
        </span>
        <span>
          <i style={{ background: "#4a9d7e" }} />
          Confirmed / held
        </span>
        <span>
          <i style={{ background: "#9b2c1c" }} />
          Declined
        </span>
        <span>
          <i style={{ background: "#5f5a55" }} />
          No answer
        </span>
      </div>
    </div>
  );
}
