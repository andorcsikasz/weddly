import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

describe("test infrastructure smoke", () => {
  it("renders a React element into happy-dom and finds it via queries", () => {
    render(<button type="button">Hello</button>);
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
  });

  it("supports text matching via jest-dom matchers", () => {
    render(<p data-testid="hello">Weddly</p>);
    expect(screen.getByTestId("hello")).toHaveTextContent("Weddly");
  });
});
