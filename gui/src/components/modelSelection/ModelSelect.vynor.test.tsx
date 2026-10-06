import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";

import { getAllTabs } from "../../pages/config/configTabs";
import { createMockStore } from "../../util/test/mockStore";
import ModelSelect from "./ModelSelect";

describe("Vynor-only model UI", () => {
  it("shows VynorAI Auto without exposing provider configuration", () => {
    render(
      <Provider store={createMockStore()}>
        <ModelSelect />
      </Provider>,
    );

    expect(screen.getByTestId("model-select-button")).toHaveTextContent(
      "VynorAI Auto",
    );
    expect(screen.queryByText(/add chat model/i)).not.toBeInTheDocument();
  });

  it("does not expose a Models/BYOK settings tab", () => {
    expect(getAllTabs().map((tab) => tab.id)).not.toContain("models");
  });
});
