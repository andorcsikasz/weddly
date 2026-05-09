import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TextField } from "@/components/ui/TextField";

describe("<TextField>", () => {
  it("associates the label with the input via htmlFor/id", () => {
    render(<TextField id="name" label="Your name" />);
    const input = screen.getByLabelText("Your name");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("renders helper text and wires aria-describedby", () => {
    render(<TextField id="email" label="Email" helperText="We'll never share it." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-describedby", "email-help");
    expect(screen.getByText("We'll never share it.")).toHaveAttribute("id", "email-help");
  });

  it("renders error text and sets aria-invalid + aria-describedby on error", () => {
    render(<TextField id="email" label="Email" errorText="That doesn't look right." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(screen.getByRole("alert")).toHaveTextContent("That doesn't look right.");
  });

  it("hides helper when error is present (error takes precedence)", () => {
    render(<TextField id="email" label="Email" helperText="some help" errorText="bad" />);
    expect(screen.queryByText("some help")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("marks required and shows visual asterisk", () => {
    render(<TextField id="name" label="Name" required />);
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("forwards native input attributes (type, autoComplete, inputMode)", () => {
    render(
      <TextField id="email" label="Email" type="email" autoComplete="email" inputMode="email" />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toHaveAttribute("inputmode", "email");
  });

  it("calls onChange when user types", () => {
    let captured = "";
    render(
      <TextField
        id="name"
        label="Name"
        onChange={(e) => {
          captured = e.target.value;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna" } });
    expect(captured).toBe("Anna");
  });
});
