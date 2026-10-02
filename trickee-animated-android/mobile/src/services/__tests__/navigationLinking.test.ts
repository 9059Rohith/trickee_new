const getStateFromPath = require("@react-navigation/core/lib/commonjs/getStateFromPath").default;
import { linking } from "../../navigation/navigationLinking";

it("opens the Home tab from the stationary-stop notification link", () => {
  const state = getStateFromPath("home", linking.config);
  expect(state?.routes[0].name).toBe("Main");
  expect(state?.routes[0].state?.routes[0].name).toBe("Home");
});
