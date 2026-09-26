export const linking = {
  prefixes: ["trickeegps://"],
  config: {
    screens: {
      Main: { screens: { Home: "home" } },
      RouteNudges: "route-nudges",
      DailyPlanner: "daily-planner",
      TripStart: {
        path: "start-trip/:planId/:legIndex",
        parse: { legIndex: Number },
      },
    },
  },
};
