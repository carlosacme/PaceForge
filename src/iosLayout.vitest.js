import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ current: "web" }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => platform.current,
  },
}));

import { IOS_VIEWPORT_CONTENT, applyIosDocumentShell } from "./lib/platform";

const ORIGINAL_VIEWPORT = "width=device-width, initial-scale=1.0";

function fakeDocument(content = ORIGINAL_VIEWPORT) {
  const classes = new Set();
  const meta = {
    content,
    setAttribute(name, value) {
      if (name === "content") this.content = value;
    },
  };
  return {
    classes,
    meta,
    documentElement: {
      classList: {
        add: (name) => classes.add(name),
      },
    },
    querySelector(sel) {
      return sel === 'meta[name="viewport"]' ? meta : null;
    },
  };
}

describe("applyIosDocumentShell", () => {
  beforeEach(() => {
    platform.current = "web";
  });

  it("con Capacitor en ios añade la clase y la meta viewport", () => {
    platform.current = "ios";
    const doc = fakeDocument();
    expect(applyIosDocumentShell(doc)).toBe(true);
    expect(doc.classes.has("ios-app")).toBe(true);
    expect(doc.meta.content).toBe(IOS_VIEWPORT_CONTENT);
    expect(doc.meta.content).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover");
  });

  it("con Capacitor en android y web no añade la clase ni cambia la meta", () => {
    for (const name of ["android", "web"]) {
      platform.current = name;
      const doc = fakeDocument();
      expect(applyIosDocumentShell(doc)).toBe(false);
      expect(doc.classes.size).toBe(0);
      expect(doc.meta.content).toBe(ORIGINAL_VIEWPORT);
    }
  });
});

describe("css de .ios-app", () => {
  it("las reglas nuevas solo aplican bajo .ios-app y index.html no trae viewport-fit", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
    const section = css.split("/* ios-app */")[1];
    expect(section).toBeTruthy();
    const selectors = section
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .flatMap((rule) => rule.split("{")[0].split(",").map((sel) => sel.trim()).filter(Boolean));
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel.startsWith(".ios-app"), sel).toBe(true);
    expect(selectors.some((sel) => sel.includes("pf-athlete-bottom-nav"))).toBe(true);
    expect(selectors.some((sel) => sel.includes("input"))).toBe(true);

    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1.0"');
    expect(html).not.toContain("viewport-fit");
  });
});
