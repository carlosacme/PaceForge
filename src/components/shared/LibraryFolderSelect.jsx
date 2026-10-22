import React from "react";

const defaultStyle = {
  border: "1px solid #e2e8f0",
  background: "#fff",
  borderRadius: 8,
  padding: "9px 10px",
  fontFamily: "inherit",
  fontSize: ".82em",
  color: "#0f172a",
};

/**
 * Selector de carpeta de biblioteca. value vacío / null = Sin carpeta.
 */
export default function LibraryFolderSelect({
  folders = [],
  value,
  onChange,
  disabled = false,
  allowNone = true,
  noneLabel = "Sin carpeta",
  style,
  "aria-label": ariaLabel = "Carpeta",
}) {
  const current = value == null || value === "" ? "" : String(value);
  return (
    <select
      aria-label={ariaLabel}
      value={current}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        onChange?.(v === "" ? null : v);
      }}
      style={{ ...defaultStyle, ...style }}
    >
      {allowNone ? <option value="">{noneLabel}</option> : null}
      {(folders || []).map((f) => (
        <option key={f.id} value={String(f.id)}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
