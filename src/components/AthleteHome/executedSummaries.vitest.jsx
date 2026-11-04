import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AthleteHomeProgress, AthleteMonthSummary, AthleteWeeklyStrip } from "./AthleteProgressPanel";

const cardStyle = { background: "#fff", padding: 12 };
const strengthStructure = [
  { block_type: "Calentamiento", duration_min: "10", description: "Movilidad" },
  { block_type: "Intervalo", duration_min: "30", description: "Sentadillas, 3 series x 12" },
];
const workouts = [
  {
    id: "run",
    scheduled_date: "2026-02-28",
    done: true,
    type: "easy",
    title: "Rodaje real",
    total_km: 18,
    distance_km: 18,
    duration_min: 80,
    actual_distance_km: 10,
    actual_duration_min: 50,
    actual_avg_pace_s: 300,
    structure: [{ block_type: "Rodaje", duration_min: "50", target_pace: "5:30-5:00" }],
  },
  {
    id: "gym",
    scheduled_date: "2026-02-24",
    done: true,
    type: "recovery",
    title: "Fuerza",
    total_km: 3,
    duration_min: 40,
    actual_distance_km: 2,
    actual_duration_min: 40,
    structure: strengthStructure,
  },
  {
    id: "gym-open",
    scheduled_date: "2026-02-18",
    done: false,
    type: "recovery",
    title: "Fuerza pendiente",
    structure: strengthStructure,
  },
  {
    id: "skip",
    scheduled_date: "2026-02-26",
    done: false,
    type: "easy",
    title: "No corrido",
    total_km: 30,
    distance_km: 30,
    duration_min: 120,
    actual_distance_km: 12,
  },
  {
    id: "march",
    scheduled_date: "2026-03-01",
    done: true,
    type: "easy",
    title: "Marzo temprano",
    total_km: 21,
    duration_min: 100,
    actual_distance_km: 15,
    actual_duration_min: 60,
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T02:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("resúmenes con lo corrido en Bogotá", () => {
  it("la semana incluye el lunes de corte y no los km planeados", () => {
    render(<AthleteHomeProgress cardStyle={cardStyle} workouts={workouts} />);
    expect(screen.getByText("2026-02-23 → 2026-03-01")).toBeTruthy();
    expect(screen.getByText("25.0 km")).toBeTruthy();
    expect(screen.getByText("2 de 3")).toBeTruthy();
    expect(screen.getByText("Sesiones de fuerza realizadas: 1 de 1")).toBeTruthy();
    expect(screen.queryByText("No corrido")).toBeNull();
    expect(screen.queryByText("27.0 km")).toBeNull();
  });

  it("el mes de Bogotá lista lo realizado y deja fuera marzo y lo no corrido", () => {
    render(<AthleteHomeProgress cardStyle={cardStyle} workouts={workouts} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes" }));
    expect(screen.getByText("2026-02-01 → 2026-02-28")).toBeTruthy();
    expect(screen.getByText("Rodaje real")).toBeTruthy();
    expect(screen.getByText("Fuerza")).toBeTruthy();
    expect(screen.getByText("fuerza")).toBeTruthy();
    expect(screen.queryByText("sin distancia")).toBeNull();
    expect(screen.queryByText("2.0 km")).toBeNull();
    expect(screen.getByText("50 min · 5:00/km")).toBeTruthy();
    expect(screen.getByText((_, node) => node.textContent === "1 de 2 · 10.0 km reales")).toBeTruthy();
    expect(screen.getByText("Sesiones de fuerza realizadas: 1 de 2")).toBeTruthy();
    expect(screen.queryByText("No corrido")).toBeNull();
    expect(screen.queryByText("Fuerza pendiente")).toBeNull();
    expect(screen.queryByText("Marzo temprano")).toBeNull();
  });

  it("el año desglosa febrero y marzo por separado", () => {
    render(<AthleteHomeProgress cardStyle={cardStyle} workouts={workouts} />);
    fireEvent.click(screen.getByRole("button", { name: "Año" }));
    expect(screen.getByText("2026-01-01 → 2026-12-31")).toBeTruthy();
    expect(screen.getByText("febrero 2026")).toBeTruthy();
    expect(screen.getByText("marzo 2026")).toBeTruthy();
    expect(screen.getByText((_, node) => node.textContent === "2 de 3 · 25.0 km reales")).toBeTruthy();
    expect(screen.getByText("Sesiones de fuerza realizadas: 1 de 2")).toBeTruthy();
  });

  it("la tira semanal muestra km reales de la semana de Bogotá", () => {
    render(<AthleteWeeklyStrip cardStyle={cardStyle} workouts={workouts} />);
    expect(screen.getByText("2026-02-23 → 2026-03-01")).toBeTruthy();
    expect(screen.getAllByText("25.0").length).toBeGreaterThan(0);
    expect(screen.getByText("2 de 3 carreras")).toBeTruthy();
    expect(screen.getByText("1 de 1 sesiones de fuerza")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.queryByText("48.0")).toBeNull();
  });

  it("la tira separa 1 de 2 carreras y 1 de 1 fuerza, y la adherencia sigue siendo 2 de 3", () => {
    render(
      <AthleteWeeklyStrip
        cardStyle={cardStyle}
        workouts={[
          { id: "r1", scheduled_date: "2026-02-24", done: true, type: "easy", title: "Rodaje", actual_distance_km: 8, structure: [{ block_type: "Rodaje", duration_min: "40", target_pace: "6:00-5:30" }] },
          { id: "r2", scheduled_date: "2026-02-25", done: false, type: "easy", title: "Tempo", structure: [{ block_type: "Rodaje", duration_min: "30", target_pace: "5:00-4:40" }] },
          { id: "f1", scheduled_date: "2026-02-26", done: true, type: "recovery", title: "Fuerza", structure: strengthStructure },
        ]}
      />,
    );
    expect(screen.getByText("1 de 2 carreras")).toBeTruthy();
    expect(screen.getByText("1 de 1 sesiones de fuerza")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
  });

  it("una semana sin fuerza planeada solo muestra carreras", () => {
    render(
      <AthleteWeeklyStrip
        cardStyle={cardStyle}
        workouts={[
          { id: "r1", scheduled_date: "2026-02-24", done: true, type: "easy", title: "Rodaje", actual_distance_km: 8, structure: [{ block_type: "Rodaje", duration_min: "40", target_pace: "6:00-5:30" }] },
          { id: "r2", scheduled_date: "2026-02-25", done: false, type: "easy", title: "Tempo", structure: [{ block_type: "Rodaje", duration_min: "30", target_pace: "5:00-4:40" }] },
        ]}
      />,
    );
    expect(screen.getByText("1 de 2 carreras")).toBeTruthy();
    expect(screen.queryByText(/sesiones de fuerza/)).toBeNull();
  });

  it("una semana sin carreras planeadas solo muestra fuerza", () => {
    render(
      <AthleteWeeklyStrip
        cardStyle={cardStyle}
        workouts={[
          { id: "f1", scheduled_date: "2026-02-26", done: true, type: "recovery", title: "Fuerza", structure: strengthStructure },
        ]}
      />,
    );
    expect(screen.getByText("1 de 1 sesiones de fuerza")).toBeTruthy();
    expect(screen.queryByText(/carreras/)).toBeNull();
  });

  it("el resumen de perfil no usa el km planeado y nota la fuerza sin distancia", () => {
    render(<AthleteMonthSummary cardStyle={cardStyle} workouts={workouts} />);
    expect(screen.getByText(/Resumen · febrero 2026/)).toBeTruthy();
    expect(screen.getAllByText("Rodaje real").length).toBe(2);
    expect(screen.getByText("fuerza")).toBeTruthy();
    expect(screen.getByText((_, node) => node.textContent === "10.0 km · 50 min · 5:00/km")).toBeTruthy();
    expect(screen.getByText((_, node) => node.textContent === "1 de 2 · 10.0 km reales")).toBeTruthy();
    expect(screen.getByText("Sesiones de fuerza realizadas: 1 de 2")).toBeTruthy();
    expect(screen.queryByText("No corrido")).toBeNull();
    expect(screen.queryByText("18.0")).toBeNull();
  });
});
