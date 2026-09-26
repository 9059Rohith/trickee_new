const getStateFromPath = require("@react-navigation/core/lib/commonjs/getStateFromPath").default;
import { linking } from "../../navigation/navigationLinking";

it("opens the Home tab from the stationary-stop notification link", () => {
  const state = getStateFromPath("home", linking.config);
  expect(state?.routes[0].name).toBe("Main");
  expect(state?.routes[0].state?.routes[0].name).toBe("Home");
});

it("opens only the bounded plan occurrence start route", () => {
  const state = getStateFromPath("start-trip/plan-1/2", linking.config);
  expect(state?.routes[0]).toMatchObject({
    name: "TripStart",
    params: { planId: "plan-1", legIndex: 2 },
  });
  expect(getStateFromPath("https://attacker.example/start-trip/plan-1/2", linking.config)).toBeUndefined();
});
