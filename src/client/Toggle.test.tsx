// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./App";

describe("Toggle", () => {
  it("exposes state and emits the next value", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Flood protection" hint="Limit messages" />);
    const checkbox = screen.getByRole("checkbox", { name: /Flood protection/ });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
